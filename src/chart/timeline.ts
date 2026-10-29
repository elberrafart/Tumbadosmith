import type { Chart, ChartNote } from './types';

/** Notes struck together (a single note or a chord) with their target pitches. */
export interface TargetGroup {
  index: number;
  t: number;
  dur: number;
  notes: ChartNote[];
  /** Acceptable MIDI pitches at the attack. */
  midis: number[];
  /** Pitch range accepted while sustaining (covers slides). */
  sustainRange: [number, number];
  section: number;
  isChord: boolean;
}

const CHORD_EPS = 0.005;

export function beatLength(chart: Chart): number {
  return 60 / chart.bpm;
}

export function barLength(chart: Chart): number {
  return beatLength(chart) * chart.timeSig[0];
}

export function chartEnd(chart: Chart): number {
  let end = 0;
  for (const n of chart.notes) end = Math.max(end, n.t + n.dur);
  return end + beatLength(chart);
}

export function sectionAt(chart: Chart, t: number): number {
  let idx = 0;
  chart.sections.forEach((s, i) => {
    if (t >= s.start - CHORD_EPS) idx = i;
  });
  return idx;
}

export function buildGroups(chart: Chart, openMidis: number[]): TargetGroup[] {
  const groups: TargetGroup[] = [];
  for (const n of chart.notes) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.t - n.t) < CHORD_EPS) {
      last.notes.push(n);
    } else {
      groups.push({ index: groups.length, t: n.t, dur: 0, notes: [n], midis: [], sustainRange: [0, 0], section: sectionAt(chart, n.t), isChord: false });
    }
  }
  for (const g of groups) {
    g.isChord = g.notes.length > 1;
    g.dur = Math.max(...g.notes.map((n) => n.dur));
    g.midis = g.notes.map((n) => openMidis[n.string - 1] + n.fret);
    const ends = g.notes.flatMap((n) => {
      const open = openMidis[n.string - 1];
      return [open + n.fret, open + (n.slideTo ?? n.fret)];
    });
    g.sustainRange = [Math.min(...ends), Math.max(...ends)];
  }
  return groups;
}
