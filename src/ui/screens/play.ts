import { h, pct } from '../dom';
import { navigate, type Screen } from '../router';
import { getLang, t } from '../../i18n';
import { engine } from '../../audio/engine';
import { NoteEventTracker } from '../../audio/events';
import { BackingTrack, DemoPlayer } from '../../audio/backing';
import { chartById } from '../../content';
import { effectiveOffsets, openMidis } from '../../chart/tuning';
import { beatLength, sectionAt } from '../../chart/timeline';
import type { JudgeEvent } from '../../chart/scorer';
import { Highway, type HighwayView } from '../../game/highway';
import { Session, CLEAN_ACCURACY, MIN_SPEED, MAX_SPEED } from '../../game/session';
import { saveSettings, settings } from '../../storage/settings';
import { recordRun } from '../../storage/progress';
import { connectInput, displayNote, latencySeconds, strings as stringCountFor } from '../input';

/** Seconds of chart visible ahead at 100% speed. */
const LOOKAHEAD = 2.4;
/** How far ahead (real seconds) backing and demo notes are scheduled. */
const SCHEDULE_AHEAD = 0.2;

export const play: Screen = (root, route) => {
  if (route.name !== 'play') return;
  const chart = chartById(route.chartId);
  if (!chart) {
    navigate({ name: 'riffs' });
    return;
  }
  const lang = getLang();
  const inst = chart.instrument;
  const n = stringCountFor(inst);
  const opens = openMidis(inst, n, effectiveOffsets(chart.tuning, settings.tuning[inst], n));
  const session = new Session({
    chart,
    openMidis: opens,
    mode: route.mode,
    speed: route.mode === 'practice' ? settings.practiceSpeed : 1,
    latency: latencySeconds(),
  });
  session.autoSpeedUp = settings.autoSpeedUp;
  const tracker = new NoteEventTracker({ gate: 10 ** (settings.gateDb / 20) });

  // ── DOM ────────────────────────────────────────
  const canvas = h('canvas', { 'aria-label': chart.title[lang] });
  const scoreEl = h('div', { class: 'v' }, '0');
  const streakEl = h('div', { class: 'v' }, '0');
  const accEl = h('div', { class: 'v' }, '–');
  const multEl = h('div', { class: 'mult' }, '×1');
  const sectionEl = h('div', { class: 'hud-sub' }, '');
  const detectedEl = h('div', { class: 'hud-sub' }, '');
  const toast = h('div', { class: 'toast' });
  const progressFill = h('div', { class: 'fill' });
  const progressLoop = h('div', { class: 'loop', hidden: true });
  const speedLabel = h('span', null, pct(session.speed));
  const speedInput = h('input', {
    type: 'range', min: String(MIN_SPEED * 100), max: String(MAX_SPEED * 100), step: '5', value: String(Math.round(session.speed * 100)),
    'aria-label': t('speed'),
    oninput: () => {
      session.setSpeed(Number(speedInput.value) / 100, engine.now);
      if (route.mode === 'practice') {
        settings.practiceSpeed = session.speed;
        saveSettings();
      }
      resyncAudio();
      speedLabel.textContent = pct(session.speed);
    },
  });

  const hudBox = (k: string, v: HTMLElement) => h('div', { class: 'hud-box' }, h('div', { class: 'k' }, k), v);
  const hud = h('div', { class: 'hud' },
    h('div', { class: 'hud-box' }, h('div', { class: 'hud-title' }, chart.title[lang]), sectionEl, detectedEl),
    h('div', { class: 'spacer' }),
    multEl,
    hudBox(t('score'), scoreEl),
    hudBox(t('streak'), streakEl),
    hudBox(t('accuracy'), accEl),
    h('button', { class: 'btn small ghost', onclick: () => pause(), 'aria-label': t('pause') }, '❚❚'),
  );

  const loopBtns = h('div', { class: 'row' });
  const autoBtn = h('button', {
    class: 'btn small cyan', 'aria-pressed': String(session.autoSpeedUp),
    onclick: () => {
      session.autoSpeedUp = !session.autoSpeedUp;
      settings.autoSpeedUp = session.autoSpeedUp;
      saveSettings();
      autoBtn.setAttribute('aria-pressed', String(session.autoSpeedUp));
    },
  }, t('autoSpeed'));
  let pendingA: number | null = null;
  const renderLoopBtns = () => {
    loopBtns.replaceChildren(
      h('button', { class: 'btn small', onclick: loopSection }, t('loopSection')),
      h('button', { class: 'btn small', onclick: setA, 'aria-pressed': String(pendingA !== null) }, t('loopA')),
      h('button', { class: 'btn small', onclick: setB, disabled: pendingA === null }, t('loopB')),
      h('button', { class: 'btn small ghost', onclick: clearLoop, disabled: !session.loop }, t('loopClear')),
    );
    progressLoop.hidden = !session.loop;
    if (session.loop) {
      progressLoop.style.left = `${(session.loop.a / session.end) * 100}%`;
      progressLoop.style.width = `${((session.loop.b - session.loop.a) / session.end) * 100}%`;
    }
  };
  const controls = h('div', { class: 'controls' },
    h('div', { class: 'speed' }, t('speed'), speedInput, speedLabel),
    loopBtns,
    route.mode === 'practice' ? autoBtn : null,
  );

  const overlay = h('div', { class: 'overlay' });
  const container = h('div', { class: 'play' }, canvas, hud, toast, controls,
    h('div', { class: 'progress' }, progressFill, progressLoop), overlay);
  root.append(container);

  const highway = new Highway(canvas, { perfect: t('perfect'), good: t('good'), miss: t('miss') });
  const ro = new ResizeObserver(() => highway.resize());
  ro.observe(canvas);
  renderLoopBtns();

  // ── audio ──────────────────────────────────────
  let backing: BackingTrack | null = null;
  let demo: DemoPlayer | null = null;
  const demoNotes = chart.notes.map((note) => {
    const next = chart.notes.find((m) => m.t > note.t + 0.005);
    return {
      t: note.t,
      midi: opens[note.string - 1] + note.fret,
      end: Math.max(note.t + note.dur, next ? next.t - 0.01 : note.t + 1),
      soft: !!note.tech?.some((x) => x === 'hammer' || x === 'pull'),
    };
  });

  const resyncAudio = () => {
    const from = session.chartTime(engine.now);
    backing?.reset(from);
    demo?.reset(from);
  };

  const handle = (j: JudgeEvent | null) => {
    if (j) highway.flash(j.group, j.judgment, view(), performance.now() / 1000);
  };
  tracker.onStrum = (e) => handle(session.strumEvent(e.t, e.chroma));
  const unsub = engine.subscribe((msgs) => {
    for (const m of msgs) tracker.push(m, (e) => handle(session.noteEvent(e.t, e.midi)));
  });

  let toastTimer = 0;
  const showToast = (text: string) => {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1600);
  };
  session.onPass = (p) => {
    const before = speedInput.value;
    speedInput.value = String(Math.round(session.speed * 100));
    speedLabel.textContent = pct(session.speed);
    if (speedInput.value !== before) {
      showToast(t('speedUp', { speed: pct(session.speed) }));
      settings.practiceSpeed = session.speed;
      saveSettings();
    } else {
      showToast(p.clean ? t('passClean', { acc: pct(p.accuracy) }) : t('passDirty', { acc: pct(p.accuracy), need: pct(CLEAN_ACCURACY) }));
    }
  };

  // ── loop controls ──────────────────────────────
  const displayTime = () => session.chartTime(engine.now - engine.outputLatency);
  const snapBeat = (x: number) => Math.round(x / beatLength(chart)) * beatLength(chart);
  const restartLoop = () => {
    session.seek(session.loop!.a - session.leadIn, engine.now);
    session.scorer.resetRange(session.loop!.a, session.loop!.b);
    resyncAudio();
  };
  function loopSection(): void {
    const idx = sectionAt(chart!, Math.max(0, displayTime()));
    const a = chart!.sections[idx].start;
    const b = chart!.sections[idx + 1]?.start ?? session.end;
    session.setLoop(a, b);
    pendingA = null;
    restartLoop();
    renderLoopBtns();
  }
  function setA(): void {
    pendingA = Math.max(0, snapBeat(displayTime()));
    renderLoopBtns();
  }
  function setB(): void {
    if (pendingA === null) return;
    const b = snapBeat(displayTime());
    if (b <= pendingA + beatLength(chart!)) return;
    session.setLoop(pendingA, b);
    pendingA = null;
    restartLoop();
    renderLoopBtns();
  }
  function clearLoop(): void {
    session.clearLoop();
    pendingA = null;
    renderLoopBtns();
  }

  // ── start / pause ──────────────────────────────
  const tuningWarning = chart.tuning.some((o) => o !== 0)
    ? h('p', { class: 'hint warn' }, t('wrongTuning', { tuning: chart.tuning.join(' ') }))
    : null;
  const showStart = () => {
    overlay.hidden = false;
    overlay.replaceChildren(
      h('div', { class: 'panel' },
        h('h2', { style: 'text-align:center;font-size:42px' }, chart.title[lang]),
        tuningWarning,
        h('button', { class: 'btn primary', onclick: () => void begin() }, '▶ ' + t('tapToStart')),
        h('button', { class: 'btn ghost', onclick: () => exit() }, t('exit')),
      ),
    );
  };
  const begin = async () => {
    void connectInput();
    const ctx = await engine.ensureContext();
    backing ??= new BackingTrack(ctx, engine.music, chart.bpm, chart.timeSig[0]);
    if (settings.demo) demo ??= new DemoPlayer(ctx, engine.demoBus, demoNotes);
    session.latency = latencySeconds();
    session.start(engine.now + 0.1);
    resyncAudio();
    overlay.hidden = true;
    showToast(t('countIn'));
  };
  const pause = () => {
    if (session.status !== 'running') return;
    session.pause(engine.now);
    backing?.reset(session.chartTime(engine.now));
    demo?.reset(session.chartTime(engine.now));
    overlay.hidden = false;
    overlay.replaceChildren(
      h('div', { class: 'panel' },
        h('h2', { style: 'text-align:center;font-size:42px' }, t('pause')),
        h('button', { class: 'btn primary', onclick: () => { session.resume(engine.now); resyncAudio(); overlay.hidden = true; } }, '▶ ' + t('resume')),
        h('button', { class: 'btn cyan', onclick: () => { navigate({ name: 'play', chartId: chart.id, mode: route.mode }); } }, '⟲ ' + t('restart')),
        route.mode === 'practice' || session.passes.length
          ? h('button', { class: 'btn cyan', onclick: () => void finish() }, t('results'))
          : null,
        h('button', { class: 'btn ghost', onclick: () => void exit(true) }, t('exit')),
      ),
    );
  };

  let done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    const result = session.result();
    const cleanSpeed = session.mode === 'play' ? (result.accuracy >= CLEAN_ACCURACY ? result.speed : 0) : result.bestCleanSpeed;
    const { newBest } = await recordRun(chart.id, { accuracy: result.accuracy, speed: result.speed, cleanSpeed });
    navigate({ name: 'results', chartId: chart.id, mode: route.mode, result, newBest });
  };
  const exit = async (save = false) => {
    if (save && session.passes.length && !done) {
      done = true;
      const r = session.result();
      await recordRun(chart.id, { accuracy: r.accuracy, speed: r.speed, cleanSpeed: r.bestCleanSpeed });
    }
    navigate({ name: 'riffs' });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (session.status === 'running') pause();
      else if (session.status === 'paused') (overlay.querySelector('.btn.primary') as HTMLButtonElement | null)?.click();
    }
  };
  const onHide = () => document.hidden && pause();
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);

  // ── render loop ────────────────────────────────
  const stringLabels = opens.map((m) => displayNote(m, false));
  const view = (): HighwayView => ({
    now: displayTime(),
    lookahead: LOOKAHEAD * session.speed,
    groups: session.groups,
    states: session.scorer.states,
    chart,
    strings: n,
    lowStringOnTop: settings.lowStringOnTop,
    stringLabels,
    loop: session.loop,
  });

  let raf = 0;
  let lastSection = -1;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = engine.now;
    if (session.status === 'running') {
      const { judged, jumped } = session.frame(now, tracker.current);
      const v = view();
      for (const j of judged) highway.flash(j.group, j.judgment, v, performance.now() / 1000);
      if (jumped) resyncAudio();
      const until = session.chartTime(now + SCHEDULE_AHEAD);
      const toCtx = (x: number) => session.ctxTime(x);
      backing?.schedule(until, toCtx, session.speed, { drums: settings.drums, click: settings.click });
      demo?.schedule(until, toCtx, session.speed);
      if ((session.status as string) === 'finished') void finish();
    }
    const v = view();
    highway.render(v, performance.now() / 1000);

    scoreEl.textContent = session.scorer.score.toLocaleString();
    streakEl.textContent = String(session.scorer.streak);
    multEl.textContent = `×${session.scorer.multiplier}`;
    const acc = session.loop ? session.scorer.accuracy(session.loop.a, session.loop.b) : session.scorer.accuracy();
    accEl.textContent = session.scorer.counts().perfect + session.scorer.counts().good + session.scorer.counts().miss ? pct(acc) : '–';
    const sec = sectionAt(chart, Math.max(0, v.now));
    if (sec !== lastSection) {
      lastSection = sec;
      sectionEl.textContent = t('sectionLabel', { name: chart.sections[sec].name });
    }
    detectedEl.textContent = tracker.current !== null ? t('detected', { note: displayNote(tracker.current) }) : '';
    progressFill.style.width = `${Math.max(0, Math.min(1, v.now / session.end)) * 100}%`;
  };
  raf = requestAnimationFrame(frame);
  showStart();

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(toastTimer);
    unsub();
    ro.disconnect();
    backing?.reset(0);
    demo?.reset(Infinity);
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
  };
};
