import { describe, expect, it } from 'vitest';
import { yin } from '../src/audio/yin';
import { Analyzer, type AnalyzerMessage, type PitchFrame } from '../src/audio/analyzer';
import { midiToFreq, freqToMidi, noteName, centsOff } from '../src/audio/notes';
import { pluck } from '../src/audio/synth';

const SR = 48000;

function sine(freq: number, seconds: number, sr = SR, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

/** Sawtooth: rich harmonics, a harder case for octave errors. */
function saw(freq: number, seconds: number, sr = SR, amp = 0.4): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sr));
  for (let i = 0; i < out.length; i++) {
    const ph = (freq * i) / sr;
    out[i] = amp * 2 * (ph - Math.floor(ph + 0.5));
  }
  return out;
}

function runAnalyzer(signal: Float32Array, instrument: 'guitar' | 'bass', sr = SR): AnalyzerMessage[] {
  const a = new Analyzer(sr, instrument);
  const out: AnalyzerMessage[] = [];
  for (let i = 0; i < signal.length; i += 128) {
    a.process(signal.subarray(i, Math.min(i + 128, signal.length)), i / sr, out);
  }
  return out;
}

function medianPitch(msgs: AnalyzerMessage[], from = 0.2): number {
  const f = msgs
    .filter((m): m is PitchFrame => m.type === 'pitch' && m.t > from && m.clarity > 0.85)
    .map((m) => m.freq)
    .sort((a, b) => a - b);
  return f[Math.floor(f.length / 2)];
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('notes', () => {
  it('converts between MIDI and Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(freqToMidi(41.2034)).toBeCloseTo(28, 2);
    expect(noteName(40)).toBe('E2');
    expect(noteName(57, 'solfege')).toBe('La3');
    expect(centsOff(445).cents).toBeCloseTo(19.56, 1);
  });
});

describe('yin', () => {
  it('detects a pure tone', () => {
    const sr = 24000;
    const buf = sine(220, 0.1, sr);
    const r = yin(buf, 1024, sr, 60, 1500);
    expect(Math.abs(cents(r.freq, 220))).toBeLessThan(3);
    expect(r.clarity).toBeGreaterThan(0.95);
  });

  it('reports low clarity on noise', () => {
    const buf = new Float32Array(2048).map(() => Math.random() * 2 - 1);
    expect(yin(buf, 1024, 24000, 60, 1500).clarity).toBeLessThan(0.6);
  });
});

describe('Analyzer — full instrument ranges', () => {
  // Bass: low B (5-string), low E, open G, and G string fret 20.
  const bassNotes = [23, 28, 33, 43, 63];
  for (const midi of bassNotes) {
    it(`bass tracks ${noteName(midi)} (sine + saw)`, () => {
      const f = midiToFreq(midi);
      for (const sig of [sine(f, 0.8), saw(f, 0.8)]) {
        const got = medianPitch(runAnalyzer(sig, 'bass'));
        expect(Math.abs(cents(got, f))).toBeLessThan(15);
      }
    });
  }

  // Guitar: drop-D low D, low E, open strings, and high E fret 22.
  const guitarNotes = [38, 40, 45, 55, 64, 76, 86];
  for (const midi of guitarNotes) {
    it(`guitar tracks ${noteName(midi)} (sine + saw)`, () => {
      const f = midiToFreq(midi);
      for (const sig of [sine(f, 0.6), saw(f, 0.6)]) {
        const got = medianPitch(runAnalyzer(sig, 'guitar'));
        expect(Math.abs(cents(got, f))).toBeLessThan(15);
      }
    });
  }

  it('works at 44.1 kHz too', () => {
    const f = midiToFreq(28);
    const got = medianPitch(runAnalyzer(saw(f, 0.8, 44100), 'bass', 44100));
    expect(Math.abs(cents(got, f))).toBeLessThan(15);
  });

  it('tracks plucked (Karplus-Strong) strings', () => {
    for (const [midi, inst] of [[28, 'bass'], [40, 'guitar'], [69, 'guitar']] as const) {
      const f = midiToFreq(midi);
      const got = medianPitch(runAnalyzer(pluck(f, SR, { length: 1 }), inst), 0.15);
      expect(Math.abs(cents(got, f))).toBeLessThan(20);
    }
  });
});

describe('Analyzer — onsets', () => {
  it('finds each pick attack, including repeated notes', () => {
    const f = midiToFreq(45);
    const times = [0.3, 0.8, 1.3, 1.6];
    const sig = new Float32Array(SR * 2.2);
    times.forEach((t, k) => {
      const p = pluck(f, SR, { length: 0.6, seed: k + 1 });
      sig.set(p.subarray(0, Math.min(p.length, sig.length - Math.floor(t * SR))), Math.floor(t * SR));
    });
    const onsets = runAnalyzer(sig, 'guitar').filter((m) => m.type === 'onset');
    expect(onsets.length).toBe(times.length);
    onsets.forEach((o, k) => expect(Math.abs(o.t - times[k])).toBeLessThan(0.012));
  });

  it('stays quiet on silence', () => {
    const msgs = runAnalyzer(new Float32Array(SR), 'bass');
    expect(msgs.filter((m) => m.type === 'onset')).toHaveLength(0);
  });
});
