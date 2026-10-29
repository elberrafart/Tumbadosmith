// Shared glue between settings, the audio engine and screens.

import { engine, type MicState } from '../audio/engine';
import { noteName } from '../audio/notes';
import { openMidis, presetOffsets, stringCount } from '../chart/tuning';
import type { Instrument } from '../chart/types';
import { getLang, t } from '../i18n';
import { settings } from '../storage/settings';
import { h } from './dom';

export function strings(inst: Instrument = settings.instrument): number {
  return stringCount(inst, settings.fiveStringBass);
}

/** Open-string pitches for the player's tuning setting. */
export function playerOpenMidis(inst: Instrument = settings.instrument): number[] {
  const n = strings(inst);
  return openMidis(inst, n, presetOffsets(settings.tuning[inst], n));
}

export function displayNote(midi: number, withOctave = true): string {
  return noteName(midi, getLang() === 'es' ? 'solfege' : 'letter', withOctave);
}

export function autoLatencyMs(): number {
  return Math.round((engine.outputLatency + 0.015) * 1000);
}

export function latencySeconds(): number {
  return (settings.latencyMs ?? autoLatencyMs()) / 1000;
}

export function applyAudioSettings(): void {
  engine.setInstrument(settings.instrument);
  engine.setGateDb(settings.gateDb);
  engine.setInputGain(settings.inputGain);
  engine.setMonitor(settings.monitor, settings.monitorVolume);
  engine.setMusicVolume(settings.backingVolume);
}

/** Start audio and open the cable input. Call from a tap/click handler. */
export async function connectInput(): Promise<MicState> {
  await engine.ensureContext();
  applyAudioSettings();
  if (engine.micState === 'on') return 'on';
  return engine.startMic(settings.deviceId);
}

export function micMessage(state: MicState): string {
  switch (state) {
    case 'on':
      return t('inputOn', { name: engine.deviceLabel || t('defaultDevice') });
    case 'denied':
      return t('inputDenied');
    case 'unsupported':
      return t('inputUnsupported');
    case 'error':
      return t('inputError');
    default:
      return t('inputOff');
  }
}

/** Input status pill with a connect button when needed. */
export function inputStatus(): HTMLElement {
  const label = h('span', { class: 'status-text' });
  const btn = h('button', { class: 'btn small', onclick: () => void connectInput().then(render) }, t('connectInput'));
  const el = h('div', { class: 'input-status' }, h('span', { class: 'dot' }), label, btn);
  const render = () => {
    el.dataset.state = engine.micState;
    label.textContent = micMessage(engine.micState);
    btn.hidden = engine.micState === 'on';
  };
  render();
  const onMic = () => (el.isConnected ? render() : engine.events.removeEventListener('mic', onMic));
  engine.events.addEventListener('mic', onMic);
  return el;
}

/** Horizontal input-level meter in dBFS, with the noise gate marked. */
export function levelMeter(): { el: HTMLElement; update: (rms: number) => void } {
  const bar = h('div', { class: 'meter-bar' });
  const gate = h('div', { class: 'meter-gate' });
  const el = h('div', { class: 'meter', title: t('level') }, bar, gate);
  const toPct = (db: number) => Math.max(0, Math.min(100, ((db + 70) / 70) * 100));
  let peak = 0;
  return {
    el,
    update(rms: number) {
      const db = 20 * Math.log10(Math.max(rms, 1e-6));
      peak = Math.max(toPct(db), peak - 1.5);
      bar.style.width = `${peak}%`;
      bar.classList.toggle('hot', db > -6);
      gate.style.left = `${toPct(settings.gateDb)}%`;
    },
  };
}
