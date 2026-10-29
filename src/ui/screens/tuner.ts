import { h } from '../dom';
import { navigate, type Screen } from '../router';
import { t } from '../../i18n';
import { engine } from '../../audio/engine';
import { freqToMidi } from '../../audio/notes';
import { settings } from '../../storage/settings';
import { displayNote, inputStatus, levelMeter, playerOpenMidis, strings } from '../input';
import { stringColor } from '../../game/highway';

const SMOOTH = 5;
const IN_TUNE_CENTS = 4;

export const tuner: Screen = (root) => {
  const opens = playerOpenMidis();
  const n = strings();
  let mode: 'string' | 'chromatic' = 'string';
  let locked: number | null = null; // string chosen by tapping, else auto-detect
  let target = n; // lowest string
  const tunedStrings = new Set<number>();
  const recent: number[] = [];
  let inTuneSince = 0;
  let lastVoiced = 0;

  const noteEl = h('div', { class: 'tuner-note' }, '–');
  const needle = h('div', { class: 'tuner-needle' });
  const centsEl = h('div', { class: 'tuner-cents' }, '');
  const freqEl = h('div', { class: 'hint' }, '');
  const hint = h('p', { class: 'hint warn', hidden: true }, t('noSignal'));
  const meter = levelMeter();

  const stringBtns = Array.from({ length: n }, (_, i) => {
    const s = n - i; // lowest string first
    return h('button', {
      class: 'string-btn',
      style: `--c:${stringColor(s, n)}`,
      onclick: () => {
        locked = locked === s ? null : s;
        target = s;
        renderButtons();
      },
    }, displayNote(opens[s - 1], false));
  });
  const stringRow = h('div', { class: 'string-buttons' }, ...stringBtns);

  const modeBtn = (m: typeof mode, label: string) =>
    h('button', { class: 'btn small cyan', 'aria-pressed': String(mode === m), onclick: () => { mode = m; renderMode(); } }, label);
  const modeRow = h('div', { class: 'row' });
  const renderMode = () => {
    modeRow.replaceChildren(modeBtn('string', t('stringMode')), modeBtn('chromatic', t('chromatic')));
    stringRow.hidden = mode !== 'string';
  };
  const renderButtons = () => {
    stringBtns.forEach((b, i) => {
      const s = n - i;
      b.setAttribute('aria-pressed', String(s === target));
      b.classList.toggle('ok', tunedStrings.has(s));
    });
  };

  const panel = h('div', { class: 'tuner' }, modeRow, noteEl, h('div', { class: 'tuner-scale' }, h('div', { class: 'ticks' }), needle), centsEl, freqEl, stringRow);

  root.append(
    h('div', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'btn ghost small', onclick: () => navigate({ name: 'menu' }) }, '← ' + t('back')),
        h('h2', null, t('tuner')),
        h('div', { class: 'spacer' }),
        inputStatus(),
      ),
      h('div', { class: 'row' }, meter.el),
      hint,
      panel,
    ),
  );
  renderMode();
  renderButtons();

  const unsub = engine.subscribe((msgs) => {
    for (const m of msgs) {
      if (m.type !== 'pitch') continue;
      meter.update(m.rms);
      const gate = 10 ** (settings.gateDb / 20);
      if (m.freq <= 0 || m.clarity < 0.85 || m.rms < gate) continue;
      lastVoiced = performance.now();
      recent.push(freqToMidi(m.freq));
      if (recent.length > SMOOTH) recent.shift();
    }
    if (performance.now() - lastVoiced > 400) recent.length = 0;
    update();
  });

  function update(): void {
    hint.hidden = performance.now() - lastVoiced < 3000;
    if (!recent.length) {
      panel.dataset.tune = '';
      return;
    }
    const sorted = [...recent].sort((a, b) => a - b);
    const exact = sorted[Math.floor(sorted.length / 2)];
    let ref: number;
    if (mode === 'chromatic') {
      ref = Math.round(exact);
    } else {
      if (locked === null) {
        // Auto-pick the string closest to what is ringing.
        let best = target;
        for (let s = 1; s <= n; s++) if (Math.abs(opens[s - 1] - exact) < Math.abs(opens[best - 1] - exact)) best = s;
        if (best !== target) {
          target = best;
          renderButtons();
        }
      }
      ref = opens[target - 1];
    }
    const cents = (exact - ref) * 100;
    const shown = Math.max(-50, Math.min(50, cents));
    needle.style.left = `${50 + shown}%`;
    noteEl.replaceChildren(displayNote(ref, false), h('sub', null, String(Math.floor(Math.round(ref) / 12) - 1)));
    centsEl.textContent = `${cents > 0 ? '+' : ''}${cents.toFixed(0)} ¢`;
    freqEl.textContent = `${(440 * 2 ** ((exact - 69) / 12)).toFixed(1)} Hz`;
    const ok = Math.abs(cents) < IN_TUNE_CENTS;
    if (ok && !inTuneSince) inTuneSince = performance.now();
    if (!ok) inTuneSince = 0;
    const settled = ok && performance.now() - inTuneSince > 350;
    panel.dataset.tune = settled ? 'ok' : '';
    if (settled && mode === 'string' && !tunedStrings.has(target)) {
      tunedStrings.add(target);
      renderButtons();
    }
  }

  return unsub;
};
