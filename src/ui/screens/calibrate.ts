import { h } from '../dom';
import { navigate, type Screen } from '../router';
import { t } from '../../i18n';
import { engine } from '../../audio/engine';
import { saveSettings, settings } from '../../storage/settings';
import { connectInput, inputStatus } from '../input';
import { measureLatency } from '../../game/calibration';

const BPM = 90;
const COUNT_IN = 4;
const CLICKS = 8;

export const calibrate: Screen = (root) => {
  const beat = h('div', { class: 'calib-beat' }, '');
  const msg = h('p', { class: 'hint', style: 'text-align:center;font-size:18px' }, t('calibrationHelp', { n: CLICKS }));
  const startBtn = h('button', { class: 'btn primary', onclick: () => void run() }, t('calibrationStart'));
  const actions = h('div', { class: 'row', style: 'justify-content:center' }, startBtn,
    h('button', { class: 'btn ghost', onclick: () => navigate({ name: 'settings', from: 'menu' }) }, t('back')));

  root.append(
    h('div', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'btn ghost small', onclick: () => navigate({ name: 'settings', from: 'menu' }) }, '← ' + t('back')),
        h('h2', null, t('calibrationTitle')),
        h('div', { class: 'spacer' }),
        inputStatus(),
      ),
      h('div', { class: 'panel-box' }, beat, msg, actions),
    ),
  );

  let unsub: (() => void) | null = null;
  const timers: number[] = [];

  async function run(): Promise<void> {
    startBtn.disabled = true;
    await connectInput();
    const ctx = await engine.ensureContext();
    const spb = 60 / BPM;
    const start = ctx.currentTime + 0.4;
    const clicks: number[] = [];
    const onsets: number[] = [];
    for (let i = 0; i < COUNT_IN + CLICKS; i++) {
      const at = start + i * spb;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = i < COUNT_IN ? 880 : 1760;
      g.gain.setValueAtTime(0.18, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
      o.connect(g).connect(engine.music);
      o.start(at);
      o.stop(at + 0.07);
      if (i >= COUNT_IN) clicks.push(at);
      // Visual beat, shown when the click is heard.
      const delay = (at - ctx.currentTime + engine.outputLatency) * 1000;
      timers.push(window.setTimeout(() => {
        beat.textContent = i < COUNT_IN ? String(COUNT_IN - i) : '♪';
        beat.classList.add('flash');
        timers.push(window.setTimeout(() => beat.classList.remove('flash'), 90));
      }, delay));
    }
    unsub = engine.subscribe((msgs) => {
      for (const m of msgs) if (m.type === 'onset' && m.t > start + (COUNT_IN - 0.5) * spb) onsets.push(m.t);
      msg.textContent = t('calibrationListening', { got: Math.min(onsets.length, CLICKS), n: CLICKS });
    });
    const end = start + (COUNT_IN + CLICKS) * spb + 0.5;
    timers.push(window.setTimeout(() => {
      unsub?.();
      unsub = null;
      beat.textContent = '';
      const latency = measureLatency(clicks, onsets);
      startBtn.disabled = false;
      if (latency === null) {
        msg.textContent = t('calibrationFail');
        return;
      }
      settings.latencyMs = Math.round(latency * 1000);
      saveSettings();
      msg.textContent = t('calibrationDone', { ms: settings.latencyMs });
    }, (end - ctx.currentTime) * 1000));
  }

  return () => {
    unsub?.();
    timers.forEach(clearTimeout);
  };
};
