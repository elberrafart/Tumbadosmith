import { h } from '../dom';
import { navigate, type Screen } from '../router';
import { t, type MessageKey } from '../../i18n';
import { engine } from '../../audio/engine';
import { saveSettings, settings, type Settings } from '../../storage/settings';
import type { TuningPreset } from '../../chart/tuning';
import { applyAudioSettings, autoLatencyMs, connectInput, inputStatus, levelMeter, micMessage } from '../input';
import { langToggle } from './home';

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id ||= id;
  return h('div', { class: 'field' }, h('label', { for: control.id }, label), control, hint ? h('p', { class: 'hint' }, hint) : null);
}

function toggle(key: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings], after?: () => void): HTMLInputElement {
  return h('input', {
    type: 'checkbox', class: 'switch', role: 'switch', checked: settings[key],
    onchange: (e: Event) => {
      settings[key] = (e.target as HTMLInputElement).checked;
      saveSettings();
      after?.();
    },
  });
}

function slider(min: number, max: number, step: number, value: number, onInput: (v: number) => void, format: (v: number) => string): HTMLElement {
  const out = h('span', { style: 'min-width:72px;text-align:right;font-variant-numeric:tabular-nums' }, format(value));
  const input = h('input', {
    type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
    oninput: () => {
      const v = Number(input.value);
      out.textContent = format(v);
      onInput(v);
    },
  });
  return h('div', { class: 'row', style: 'flex-wrap:nowrap' }, input, out);
}

export const settingsScreen: Screen = (root, route) => {
  const from = route.name === 'settings' ? route.from : 'home';
  const inst = settings.instrument;

  // ── input device ───────────────────────────────
  const deviceSelect = h('select', {
    onchange: async () => {
      settings.deviceId = deviceSelect.value || null;
      saveSettings();
      await engine.startMic(settings.deviceId);
      status.textContent = micMessage(engine.micState);
    },
  });
  const status = h('p', { class: 'hint' }, micMessage(engine.micState));
  const loadDevices = async () => {
    const devices = await engine.listInputs();
    const active = engine.activeDeviceId ?? settings.deviceId;
    deviceSelect.replaceChildren(
      h('option', { value: '' }, t('defaultDevice')),
      ...devices.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === active }, d.label || `Input ${i + 1}`)),
    );
  };
  void loadDevices();
  const onDeviceChange = () => void loadDevices();
  navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

  const meter = levelMeter();
  const unsub = engine.subscribe((msgs) => {
    for (const m of msgs) if (m.type === 'pitch') meter.update(m.rms);
  });

  // ── tuning ─────────────────────────────────────
  const tuningRow = h('div', { class: 'seg' });
  const customRow = h('div');
  const presets: [TuningPreset, MessageKey][] = [['standard', 'tuningStandard'], ['halfDown', 'tuningHalfDown'], ['dropD', 'tuningDropD'], ['custom', 'tuningCustom']];
  const renderTuning = () => {
    const tun = settings.tuning[inst];
    tuningRow.replaceChildren(
      ...presets.map(([p, key]) =>
        h('button', { class: 'btn small cyan', 'aria-pressed': String(tun.preset === p), onclick: () => { tun.preset = p; saveSettings(); renderTuning(); } }, t(key))),
    );
    customRow.replaceChildren(
      tun.preset === 'custom'
        ? field(t('customOffset'), h('input', {
            type: 'number', min: '-6', max: '6', step: '1', value: String(tun.customOffset),
            onchange: (e: Event) => {
              tun.customOffset = Math.max(-6, Math.min(6, Math.round(Number((e.target as HTMLInputElement).value) || 0)));
              saveSettings();
            },
          }))
        : '',
    );
  };
  renderTuning();

  // ── latency ────────────────────────────────────
  const latencyText = h('strong');
  const renderLatency = () => {
    latencyText.textContent = settings.latencyMs === null ? t('latencyAuto', { ms: autoLatencyMs() }) : t('latencyValue', { ms: settings.latencyMs });
  };
  renderLatency();

  root.append(
    h('div', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'btn ghost small', onclick: () => navigate({ name: from }) }, '← ' + t('back')),
        h('h2', null, t('settings')),
        h('div', { class: 'spacer' }),
        langToggle(),
      ),
      h('div', { class: 'panel-box' },
        h('h3', null, t('inputDevice')),
        h('div', { class: 'row' }, inputStatus()),
        field(t('inputDevice'), h('div', { class: 'row' }, deviceSelect,
          h('button', { class: 'btn small ghost', onclick: async () => { await connectInput(); await loadDevices(); status.textContent = micMessage(engine.micState); } }, t('refresh')))),
        status,
        field(t('level'), meter.el),
        field(t('noiseGate'), slider(-80, -20, 1, settings.gateDb, (v) => { settings.gateDb = v; saveSettings(); applyAudioSettings(); }, (v) => `${v} dB`)),
        field(t('inputGain'), slider(0.5, 4, 0.1, settings.inputGain, (v) => { settings.inputGain = v; saveSettings(); applyAudioSettings(); }, (v) => `×${v.toFixed(1)}`)),
        field(t('monitor'), toggle('monitor', applyAudioSettings), t('monitorHint')),
        field(t('monitorVolume'), slider(0, 1, 0.05, settings.monitorVolume, (v) => { settings.monitorVolume = v; saveSettings(); applyAudioSettings(); }, (v) => `${Math.round(v * 100)}%`)),
      ),
      h('div', { class: 'panel-box' },
        h('h3', null, `${t('tuning')} · ${t(inst)}`),
        tuningRow,
        customRow,
        inst === 'bass' ? field(t('fiveString'), toggle('fiveStringBass')) : null,
      ),
      h('div', { class: 'panel-box' },
        h('h3', null, t('latency')),
        h('div', { class: 'row' }, latencyText, h('div', { class: 'spacer' }),
          h('button', { class: 'btn small primary', onclick: () => navigate({ name: 'calibrate' }) }, t('calibrate')),
          h('button', { class: 'btn small ghost', onclick: () => { settings.latencyMs = null; saveSettings(); renderLatency(); } }, t('reset'))),
        field(t('manual'), slider(0, 400, 5, settings.latencyMs ?? autoLatencyMs(), (v) => { settings.latencyMs = v; saveSettings(); renderLatency(); }, (v) => `${v} ms`)),
      ),
      h('div', { class: 'panel-box' },
        h('h3', null, t('drums')),
        field(t('drums'), toggle('drums')),
        field(t('click'), toggle('click')),
        field(t('backingVolume'), slider(0, 1, 0.05, settings.backingVolume, (v) => { settings.backingVolume = v; saveSettings(); applyAudioSettings(); }, (v) => `${Math.round(v * 100)}%`)),
      ),
      h('div', { class: 'panel-box' },
        h('h3', null, t('language')),
        field(t('language'), langToggle()),
        field(t('lowOnTop'), toggle('lowStringOnTop')),
        field(t('demo'), toggle('demo'), t('demoHint')),
      ),
    ),
  );

  return () => {
    unsub();
    navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
  };
};
