// Turns analyzer frames into discrete note events (picked or legato) plus a
// "currently sounding" pitch used for sustains and the tuner.

import type { AnalyzerMessage } from './analyzer';
import { freqToMidi } from './notes';

export interface NoteEvent {
  /** Context time the note started. */
  t: number;
  midi: number;
  kind: 'pluck' | 'legato';
}

/** A pick attack with the averaged pitch-class profile right after it (for chords). */
export interface StrumEvent {
  t: number;
  chroma: number[];
}

/** Chroma frames averaged after each onset. */
const STRUM_WINDOW = 0.12;

export interface TrackerOptions {
  minClarity: number;
  /** Linear RMS below which frames count as silence. */
  gate: number;
  /** Frames a pitch must hold before it counts. */
  stableFrames: number;
  /** How long after an onset we wait for a stable pitch, seconds. */
  maxSettle: number;
}

const DEFAULTS: TrackerOptions = { minClarity: 0.82, gate: 10 ** (-50 / 20), stableFrames: 2, maxSettle: 0.25 };

export class NoteEventTracker {
  private opts: TrackerOptions;
  private cand: { midi: number; count: number; t: number } | null = null;
  private pendingOnset: number | null = null;
  private silentFrames = 0;
  private strum: { t: number; chroma: number[]; frames: number } | null = null;
  /** Called with a chroma profile after each attack; only fed by analyzers with chroma. */
  onStrum: ((e: StrumEvent) => void) | null = null;
  /** Rounded MIDI note currently sounding, or null. */
  current: number | null = null;
  /** Unrounded pitch of the last voiced frame (for tuner-style display). */
  exactMidi: number | null = null;

  constructor(opts: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  setGate(linear: number): void {
    this.opts.gate = linear;
  }

  push(msg: AnalyzerMessage, emit: (e: NoteEvent) => void): void {
    if (msg.type === 'onset') {
      this.flushStrum();
      this.pendingOnset = msg.t;
      this.cand = null;
      this.strum = { t: msg.t, chroma: new Array(12).fill(0), frames: 0 };
      return;
    }
    const o = this.opts;
    if (this.strum && msg.t >= this.strum.t) {
      if (msg.chroma) {
        msg.chroma.forEach((v, i) => (this.strum!.chroma[i] += v));
        this.strum.frames++;
      }
      if (msg.t > this.strum.t + STRUM_WINDOW || this.strum.frames >= 4) this.flushStrum();
    }
    const voiced = msg.freq > 0 && msg.clarity >= o.minClarity && msg.rms >= o.gate;
    if (!voiced) {
      this.cand = null;
      if (++this.silentFrames >= 3) {
        this.current = null;
        this.exactMidi = null;
      }
      if (this.pendingOnset !== null && msg.t > this.pendingOnset + o.maxSettle) this.pendingOnset = null;
      return;
    }
    this.silentFrames = 0;

    const exact = freqToMidi(msg.freq);
    const midi = Math.round(exact);
    this.exactMidi = exact;

    // Frames whose window is mostly before the onset still describe the old note.
    if (this.pendingOnset !== null && msg.t < this.pendingOnset) return;

    if (this.cand && this.cand.midi === midi) this.cand.count++;
    else this.cand = { midi, count: 1, t: msg.t };

    if (this.cand.count < o.stableFrames) return;

    if (this.pendingOnset !== null) {
      emit({ t: this.pendingOnset, midi, kind: 'pluck' });
      this.pendingOnset = null;
      this.current = midi;
    } else if (midi !== this.current) {
      emit({ t: this.cand.t, midi, kind: 'legato' });
      this.current = midi;
    }
  }

  private flushStrum(): void {
    const s = this.strum;
    this.strum = null;
    if (s && s.frames > 0 && this.onStrum) this.onStrum({ t: s.t, chroma: s.chroma });
  }
}
