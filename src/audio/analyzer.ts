// Real-time input analyzer: filtering, decimation, YIN pitch frames and onset detection.
// Runs inside the AudioWorklet, and offline in tests. No DOM or Web Audio dependencies.

import { yin } from './yin';
import type { Instrument } from '../chart/types';

export interface PitchFrame {
  type: 'pitch';
  /** Audio-context time at the centre of the analysis window. */
  t: number;
  freq: number;
  clarity: number;
  /** RMS level of the window (linear, 0..1). */
  rms: number;
  /** Energy per pitch class C..B (guitar only), for chord recognition. */
  chroma?: number[];
}

export interface OnsetFrame {
  type: 'onset';
  t: number;
  strength: number;
}

export type AnalyzerMessage = PitchFrame | OnsetFrame;

export interface AnalyzerConfig {
  minFreq: number;
  maxFreq: number;
  /** Rate the signal is decimated to before pitch analysis. */
  targetRate: number;
  /** YIN integration window, in decimated samples. */
  window: number;
  /** Pitch frame hop, in decimated samples. */
  hop: number;
  yinThreshold: number;
  /** Short/long HF-energy ratio that counts as a pick attack. */
  onsetRatio: number;
  /** Minimum time between onsets, seconds. */
  onsetRefractory: number;
  /** MIDI range of the chroma filter bank, or null to skip it. */
  chroma: [number, number] | null;
}

// Guitar: down to C2 (drop/half-step tunings), up past fret 22 on the high E.
// Bass: down to A0 so a 5-string tuned half-step down still tracks.
export const PRESETS: Record<Instrument, AnalyzerConfig> = {
  guitar: { minFreq: 62, maxFreq: 1500, targetRate: 24000, window: 1024, hop: 256, yinThreshold: 0.15, onsetRatio: 2.6, onsetRefractory: 0.06, chroma: [48, 100] },
  bass: { minFreq: 27, maxFreq: 450, targetRate: 12000, window: 1024, hop: 128, yinThreshold: 0.15, onsetRatio: 2.6, onsetRefractory: 0.07, chroma: null },
};

/** RBJ biquad low-pass, direct form I. */
class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(sampleRate: number, cutoff: number, q: number) {
    const w0 = (2 * Math.PI * cutoff) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = (1 - cos) / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const ONSET_BLOCK = 64; // decimated samples per onset energy block
const ONSET_LONG = 10; // blocks of history for the long-term average

export class Analyzer {
  readonly config: AnalyzerConfig;
  readonly rate: number;
  private readonly decim: number;
  private readonly lp: Biquad[] = [];
  private readonly ring: Float32Array;
  private readonly frame: Float32Array;
  private readonly scratch: Float32Array;
  private ringPos = 0;
  private filled = 0;
  private sinceHop = 0;
  private decimCount = 0;
  // DC blocker state
  private dcX = 0;
  private dcY = 0;
  private readonly dcR: number;
  // Onset state
  private prevSample = 0;
  private blockHf = 0;
  private blockBroad = 0;
  private blockFill = 0;
  private readonly hfHist: number[] = [];
  private lastOnset = -Infinity;
  private gate = 10 ** (-50 / 20);
  // Chroma: Goertzel coefficient per semitone, Hann window
  private readonly chromaCoef: Float32Array | null = null;
  private readonly chromaPc: Uint8Array | null = null;
  private readonly hann: Float32Array | null = null;

  constructor(readonly sampleRate: number, instrument: Instrument) {
    this.config = PRESETS[instrument];
    this.decim = Math.max(1, Math.round(sampleRate / this.config.targetRate));
    this.rate = sampleRate / this.decim;
    if (this.decim > 1) {
      const cutoff = this.rate * 0.42;
      this.lp.push(new Biquad(sampleRate, cutoff, 0.5412), new Biquad(sampleRate, cutoff, 1.3066));
    }
    const tauMax = Math.ceil(this.rate / this.config.minFreq);
    this.ring = new Float32Array(this.config.window + tauMax + 2);
    this.frame = new Float32Array(this.ring.length);
    this.scratch = new Float32Array(tauMax + 4);
    this.dcR = 1 - (2 * Math.PI * 12) / sampleRate;
    const range = this.config.chroma;
    if (range) {
      const [lo, hi] = range;
      const bins = hi - lo + 1;
      this.chromaCoef = new Float32Array(bins);
      this.chromaPc = new Uint8Array(bins);
      for (let k = 0; k < bins; k++) {
        const f = 440 * 2 ** ((lo + k - 69) / 12);
        this.chromaCoef[k] = 2 * Math.cos((2 * Math.PI * f) / this.rate);
        this.chromaPc[k] = (lo + k) % 12;
      }
      const n = this.ring.length;
      this.hann = new Float32Array(n);
      for (let i = 0; i < n; i++) this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    }
  }

  /** Noise gate in dBFS; quieter input is reported but treated as silence downstream. */
  setGateDb(db: number): void {
    this.gate = 10 ** (db / 20);
  }

  get gateLinear(): number {
    return this.gate;
  }

  /** Feed one block of mono input. `startTime` is the context time of input[0]. */
  process(input: Float32Array, startTime: number, out: AnalyzerMessage[]): void {
    const sr = this.sampleRate;
    for (let i = 0; i < input.length; i++) {
      // DC blocker
      const x = input[i];
      const y = x - this.dcX + this.dcR * this.dcY;
      this.dcX = x;
      this.dcY = y;
      let s = y;
      for (const f of this.lp) s = f.run(s);
      if (++this.decimCount < this.decim) continue;
      this.decimCount = 0;

      this.ring[this.ringPos] = s;
      this.ringPos = (this.ringPos + 1) % this.ring.length;
      if (this.filled < this.ring.length) this.filled++;
      const now = startTime + (i + 1) / sr;

      this.onsetSample(s, now, out);

      if (++this.sinceHop >= this.config.hop && this.filled === this.ring.length) {
        this.sinceHop = 0;
        this.pitchFrame(now, out);
      }
    }
  }

  private onsetSample(s: number, now: number, out: AnalyzerMessage[]): void {
    const hf = s - this.prevSample;
    this.prevSample = s;
    this.blockHf += hf * hf;
    this.blockBroad += s * s;
    if (++this.blockFill < ONSET_BLOCK) return;

    const hfE = this.blockHf / ONSET_BLOCK;
    const broadRms = Math.sqrt(this.blockBroad / ONSET_BLOCK);
    this.blockHf = 0;
    this.blockBroad = 0;
    this.blockFill = 0;

    const hist = this.hfHist;
    const prev = hist.length ? hist[hist.length - 1] : 0;
    let long = 0;
    for (let k = 0; k < hist.length - 1; k++) long += hist[k];
    long = hist.length > 1 ? long / (hist.length - 1) : 0;
    hist.push(hfE);
    if (hist.length > ONSET_LONG) hist.shift();

    const short = (hfE + prev) / 2;
    const blockDur = ONSET_BLOCK / this.rate;
    const ratio = short / (long + 1e-12);
    if (
      ratio > this.config.onsetRatio &&
      hfE > prev * 0.5 &&
      broadRms > this.gate &&
      now - this.lastOnset > this.config.onsetRefractory
    ) {
      // The attack started at the beginning of the rising block.
      const t = now - (hfE > prev * this.config.onsetRatio ? blockDur : 2 * blockDur);
      this.lastOnset = now;
      out.push({ type: 'onset', t, strength: Math.min(ratio, 1000) });
    }
  }

  private pitchFrame(now: number, out: AnalyzerMessage[]): void {
    const n = this.ring.length;
    // Unroll the ring so the oldest sample is first.
    const tail = n - this.ringPos;
    this.frame.set(this.ring.subarray(this.ringPos), 0);
    this.frame.set(this.ring.subarray(0, this.ringPos), tail);

    let sq = 0;
    for (let j = n - this.config.window; j < n; j++) sq += this.frame[j] * this.frame[j];
    const rms = Math.sqrt(sq / this.config.window);

    const c = this.config;
    const res = rms > this.gate * 0.5
      ? yin(this.frame, c.window, this.rate, c.minFreq, c.maxFreq, c.yinThreshold, this.scratch)
      : { freq: 0, clarity: 0 };
    const frame: PitchFrame = { type: 'pitch', t: now - n / (2 * this.rate), freq: res.freq, clarity: res.clarity, rms };
    if (this.chromaCoef && rms > this.gate) frame.chroma = this.computeChroma();
    out.push(frame);
  }

  private computeChroma(): number[] {
    const coef = this.chromaCoef!;
    const pcs = this.chromaPc!;
    const w = this.hann!;
    const x = this.frame;
    const chroma = new Array(12).fill(0);
    for (let k = 0; k < coef.length; k++) {
      const c = coef[k];
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < x.length; i++) {
        const s0 = x[i] * w[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      chroma[pcs[k]] += s1 * s1 + s2 * s2 - c * s1 * s2;
    }
    return chroma;
  }
}
