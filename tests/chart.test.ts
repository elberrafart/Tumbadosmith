import { describe, expect, it } from 'vitest';
import { CHARTS } from '../src/content';
import { validateChart } from '../src/chart/validate';
import { buildGroups, chartEnd } from '../src/chart/timeline';
import { Scorer } from '../src/chart/scorer';
import { effectiveOffsets, openMidis, presetOffsets } from '../src/chart/tuning';
import { Analyzer, type AnalyzerMessage } from '../src/audio/analyzer';
import { NoteEventTracker, type NoteEvent } from '../src/audio/events';
import { midiToFreq } from '../src/audio/notes';
import { pluck } from '../src/audio/synth';
import type { Chart } from '../src/chart/types';

const SR = 48000;

describe('seed content', () => {
  it('has at least 6 riffs per instrument', () => {
    expect(CHARTS.filter((c) => c.instrument === 'guitar').length).toBeGreaterThanOrEqual(6);
    expect(CHARTS.filter((c) => c.instrument === 'bass').length).toBeGreaterThanOrEqual(6);
  });
  for (const c of CHARTS) {
    it(`${c.id} validates`, () => expect(validateChart(c)).toEqual([]));
  }
});

describe('validateChart', () => {
  it('rejects broken charts', () => {
    const bad = { ...CHARTS[0], notes: [{ t: 1, string: 9, fret: 30, dur: -1 }] };
    expect(validateChart(bad).length).toBeGreaterThanOrEqual(3);
    expect(validateChart(null)).toEqual(['chart is not an object']);
  });
});

describe('tuning', () => {
  const std = { preset: 'standard' as const, customOffset: 0 };
  it('applies presets per string', () => {
    expect(presetOffsets({ preset: 'dropD', customOffset: 0 }, 6)).toEqual([0, 0, 0, 0, 0, -2]);
    expect(presetOffsets({ preset: 'halfDown', customOffset: 0 }, 4)).toEqual([-1, -1, -1, -1]);
    expect(openMidis('guitar', 6, presetOffsets(std, 6))).toEqual([64, 59, 55, 50, 45, 40]);
    expect(openMidis('bass', 5, presetOffsets(std, 5))).toEqual([43, 38, 33, 28, 23]);
  });
  it('keeps a chart-specific tuning plus the uniform shift', () => {
    const chartDropD = [0, 0, 0, 0, 0, -2];
    expect(effectiveOffsets(chartDropD, { preset: 'halfDown', customOffset: 0 }, 6)).toEqual([-1, -1, -1, -1, -1, -3]);
    expect(effectiveOffsets([0, 0, 0, 0, 0, 0], { preset: 'dropD', customOffset: 0 }, 6)).toEqual([0, 0, 0, 0, 0, -2]);
  });
});

describe('Scorer', () => {
  const chart = CHARTS.find((c) => c.id === 'bajo-raiz-quinta')!;
  const groups = buildGroups(chart, openMidis('bass', 4, [0, 0, 0, 0]));

  it('rates hits by timing and misses the rest', () => {
    const s = new Scorer(groups);
    const g0 = groups[0];
    expect(s.onEvent(g0.t + 0.02, g0.midis[0])?.judgment).toBe('perfect');
    const g1 = groups[1];
    expect(s.onEvent(g1.t + 0.12, g1.midis[0])?.judgment).toBe('good');
    // Wrong pitch: no judgment.
    expect(s.onEvent(groups[2].t, groups[2].midis[0] + 1)).toBeNull();
    s.update(groups[3].t + 1, 0.016, null);
    expect(s.counts()).toMatchObject({ perfect: 1, good: 1 });
    expect(s.counts().miss).toBeGreaterThanOrEqual(2);
    expect(s.streak).toBe(0);
  });

  it('accepts octave slips and resets ranges for loops', () => {
    const s = new Scorer(groups);
    expect(s.onEvent(groups[0].t, groups[0].midis[0] + 12)?.judgment).toBe('perfect');
    s.resetRange(0, 1);
    expect(s.states[0].judgment).toBeNull();
  });
});

/** Synthesize a chart as plucked strings, then run the full detection pipeline on it. */
function playThrough(chart: Chart, opens: number[], instrument: 'guitar' | 'bass', target: Chart = chart) {
  const end = chartEnd(chart) + 0.5;
  const audio = new Float32Array(Math.ceil(end * SR));
  chart.notes.forEach((n, k) => {
    const legato = n.tech?.includes('hammer') || n.tech?.includes('pull');
    const f = midiToFreq(opens[n.string - 1] + n.fret);
    // Each note rings until the next one starts on any string (a monophonic line).
    const next = chart.notes.find((m) => m.t > n.t + 0.005);
    const length = Math.max(0.08, (next ? next.t : end) - n.t - 0.01);
    const p = pluck(f, SR, { length, gain: legato ? 0.25 : 0.45, seed: k + 1 });
    const at = Math.floor(n.t * SR);
    for (let i = 0; i < p.length && at + i < audio.length; i++) audio[at + i] += p[i];
  });

  const analyzer = new Analyzer(SR, instrument);
  const tracker = new NoteEventTracker();
  const groups = buildGroups(target, opens);
  const scorer = new Scorer(groups);
  tracker.onStrum = (e) => scorer.onStrum(e.t, e.chroma);
  const msgs: AnalyzerMessage[] = [];
  const events: NoteEvent[] = [];
  for (let i = 0; i < audio.length; i += 128) {
    msgs.length = 0;
    analyzer.process(audio.subarray(i, i + 128), i / SR, msgs);
    for (const m of msgs) tracker.push(m, (e) => { events.push(e); scorer.onEvent(e.t, e.midi); });
    scorer.update((i + 128) / SR, 128 / SR, tracker.current);
  }
  scorer.update(end + 2, 0, null);
  return { scorer, events };
}

const hasChords = (c: Chart) => c.notes.some((n, i) => i > 0 && Math.abs(c.notes[i - 1].t - n.t) < 0.005);

describe('end-to-end detection on synthesized riffs', () => {
  // Single-note lines should be nearly perfect; strummed chords are matched by chroma.
  for (const chart of CHARTS) {
    const min = hasChords(chart) ? 0.8 : 0.9;
    it(`${chart.id} scores >= ${min * 100}%`, () => {
      const strings = chart.instrument === 'guitar' ? 6 : 4;
      const opens = openMidis(chart.instrument, strings, new Array(strings).fill(0));
      const { scorer } = playThrough(chart, opens, chart.instrument);
      expect(scorer.accuracy()).toBeGreaterThanOrEqual(min);
      const c = scorer.counts();
      expect(c.perfect / (c.perfect + c.good + c.miss)).toBeGreaterThanOrEqual(0.75);
    }, 20000);
  }

  it('does not accept the wrong chord', () => {
    const am = CHARTS.find((c) => c.id === 'gtr-armonia-tumbada')!;
    const opens = openMidis('guitar', 6, [0, 0, 0, 0, 0, 0]);
    // Same rhythm, but every chord shifted up a tritone.
    const wrong: Chart = { ...am, notes: am.notes.map((n) => ({ ...n, fret: n.fret + 6 })) };
    const { scorer } = playThrough(wrong, opens, 'guitar', am);
    expect(scorer.accuracy()).toBeLessThan(0.35);
  }, 20000);

  it('scores nothing when the player is silent', () => {
    const chart = CHARTS.find((c) => c.instrument === 'bass')!;
    const scorer = new Scorer(buildGroups(chart, openMidis('bass', 4, [0, 0, 0, 0])));
    scorer.update(chartEnd(chart) + 2, 0, null);
    expect(scorer.accuracy()).toBe(0);
  });
});
