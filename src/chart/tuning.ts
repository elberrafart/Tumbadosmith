import type { Instrument } from './types';

/** Open-string MIDI notes in standard tuning, string 1 (highest) first. */
export const STANDARD: Record<Instrument, number[]> = {
  guitar: [64, 59, 55, 50, 45, 40], // E4 B3 G3 D3 A2 E2
  bass: [43, 38, 33, 28], // G2 D2 A1 E1
};
/** Low B string added for 5-string bass. */
export const BASS_LOW_B = 23; // B0

export type TuningPreset = 'standard' | 'halfDown' | 'dropD' | 'custom';

export interface TuningSettings {
  preset: TuningPreset;
  /** Uniform semitone shift used by the 'custom' preset. */
  customOffset: number;
}

export function stringCount(instrument: Instrument, fiveStringBass: boolean): number {
  return instrument === 'guitar' ? 6 : fiveStringBass ? 5 : 4;
}

export function standardOpen(instrument: Instrument, strings: number): number[] {
  const base = STANDARD[instrument].slice();
  if (instrument === 'bass' && strings === 5) base.push(BASS_LOW_B);
  return base;
}

/** The uniform part of a preset (applies to every string). */
export function uniformShift(t: TuningSettings): number {
  if (t.preset === 'halfDown') return -1;
  if (t.preset === 'custom') return t.customOffset;
  return 0;
}

/** Per-string semitone offsets for the player's tuning setting. */
export function presetOffsets(t: TuningSettings, strings: number): number[] {
  const shift = uniformShift(t);
  const offsets = new Array(strings).fill(shift);
  if (t.preset === 'dropD') offsets[strings - 1] = -2;
  return offsets;
}

/**
 * Offsets used to turn a chart's frets into target pitches.
 * Standard-tuned charts follow the player's tuning, so the same frets work
 * whether they tune to standard, half-step down or drop D. A chart that asks
 * for its own tuning keeps it, plus the player's uniform shift (e.g. half-step down).
 */
export function effectiveOffsets(chartTuning: number[], t: TuningSettings, strings: number): number[] {
  const chartIsStandard = chartTuning.every((o) => o === 0);
  if (chartIsStandard) return presetOffsets(t, strings);
  const shift = uniformShift(t);
  return Array.from({ length: strings }, (_, i) => (chartTuning[i] ?? 0) + shift);
}

export function openMidis(instrument: Instrument, strings: number, offsets: number[]): number[] {
  return standardOpen(instrument, strings).map((m, i) => m + (offsets[i] ?? 0));
}
