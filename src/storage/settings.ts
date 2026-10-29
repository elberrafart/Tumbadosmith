import type { Instrument } from '../chart/types';
import type { TuningSettings } from '../chart/tuning';
import { detectLang, type Lang } from '../i18n';

export interface Settings {
  lang: Lang;
  instrument: Instrument;
  deviceId: string | null;
  tuning: Record<Instrument, TuningSettings>;
  fiveStringBass: boolean;
  /** Calibrated total latency in ms, or null to estimate from the audio context. */
  latencyMs: number | null;
  gateDb: number;
  inputGain: number;
  monitor: boolean;
  monitorVolume: number;
  lowStringOnTop: boolean;
  backingVolume: number;
  drums: boolean;
  click: boolean;
  demo: boolean;
  autoSpeedUp: boolean;
  practiceSpeed: number;
}

const KEY = 'tumbadosmith.settings.v1';

function defaults(): Settings {
  return {
    lang: detectLang(),
    instrument: 'guitar',
    deviceId: null,
    tuning: { guitar: { preset: 'standard', customOffset: 0 }, bass: { preset: 'standard', customOffset: 0 } },
    fiveStringBass: false,
    latencyMs: null,
    gateDb: -52,
    inputGain: 1,
    monitor: false,
    monitorVolume: 0.8,
    lowStringOnTop: true,
    backingVolume: 0.7,
    drums: true,
    click: false,
    demo: false,
    autoSpeedUp: true,
    practiceSpeed: 0.7,
  };
}

function load(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return { ...base, ...saved, tuning: { ...base.tuning, ...saved.tuning } };
  } catch {
    return base;
  }
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode): settings last for this session only */
  }
}
