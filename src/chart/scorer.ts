// Judges detected note events against chart targets. Times are chart seconds.

import type { TargetGroup } from './timeline';

export type Judgment = 'perfect' | 'good' | 'miss';

export interface ScorerOptions {
  /** Half-width of the Perfect window, seconds. */
  perfect: number;
  /** Half-width of the Good window, seconds. */
  good: number;
  /** Accept a detection an octave off (common pitch-tracker slip on bass). */
  octaveTolerant: boolean;
  /** Extra wait before calling a miss, covering detection latency. */
  missGrace: number;
  /** Share of chroma energy that must fall on the chord's pitch classes. */
  chordMatch: number;
}

export const DEFAULT_SCORER: ScorerOptions = { perfect: 0.07, good: 0.15, octaveTolerant: true, missGrace: 0.3, chordMatch: 0.5 };

const POINTS = { perfect: 100, good: 60 };
const SUSTAIN_BONUS = 50;

export interface GroupState {
  judgment: Judgment | null;
  /** Detected offset from the target time (positive = late). */
  offset: number;
  held: number;
  sustainDone: boolean;
}

export interface JudgeEvent {
  group: TargetGroup;
  judgment: Judgment;
  offset: number;
}

export interface SectionStats {
  total: number;
  hits: number;
}

export class Scorer {
  readonly states: GroupState[];
  score = 0;
  streak = 0;
  bestStreak = 0;
  private opts: ScorerOptions;
  /** Index of the first group that might still be unjudged. */
  private cursor = 0;
  /** Chart-time per real second; timing windows are defined in real time. */
  private speed = 1;
  /** Only groups starting in this range are judged (practice loops). */
  private range: [number, number] = [-Infinity, Infinity];

  constructor(readonly groups: TargetGroup[], opts: Partial<ScorerOptions> = {}) {
    this.opts = { ...DEFAULT_SCORER, ...opts };
    this.states = groups.map(() => ({ judgment: null, offset: 0, held: 0, sustainDone: false }));
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  setRange(from: number, to: number): void {
    this.range = [from, to];
  }

  private inLoop(g: TargetGroup): boolean {
    return g.t >= this.range[0] && g.t < this.range[1];
  }

  get multiplier(): number {
    return Math.min(4, 1 + Math.floor(this.streak / 10));
  }

  private matches(midi: number, target: number): boolean {
    if (midi === target) return true;
    return this.opts.octaveTolerant && (midi === target - 12 || midi === target + 12);
  }

  /** Handle one detected note start. Returns the judgment it produced, if any. */
  onEvent(t: number, midi: number): JudgeEvent | null {
    return this.judgeNearest(t, (g) => g.midis.some((m) => this.matches(midi, m)));
  }

  /**
   * Handle a strum: a chord counts when most of the attack's pitch-class energy
   * lands on its notes and its strongest pitch class is one of them.
   */
  onStrum(t: number, chroma: number[]): JudgeEvent | null {
    const total = chroma.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let top = 0;
    for (let i = 1; i < 12; i++) if (chroma[i] > chroma[top]) top = i;
    return this.judgeNearest(t, (g) => {
      if (!g.isChord) return false;
      const pcs = new Set(g.midis.map((m) => ((m % 12) + 12) % 12));
      let on = 0;
      pcs.forEach((pc) => (on += chroma[pc]));
      return pcs.has(top) && on / total >= this.opts.chordMatch;
    });
  }

  private judgeNearest(t: number, accepts: (g: TargetGroup) => boolean): JudgeEvent | null {
    const good = this.opts.good * this.speed;
    const perfect = this.opts.perfect * this.speed;
    let best = -1;
    let bestDt = Infinity;
    for (let i = this.cursor; i < this.groups.length; i++) {
      const g = this.groups[i];
      if (g.t - good > t) break;
      if (this.states[i].judgment !== null || !this.inLoop(g)) continue;
      const dt = t - g.t;
      if (Math.abs(dt) > good) continue;
      if (!accepts(g)) continue;
      if (Math.abs(dt) < Math.abs(bestDt)) {
        best = i;
        bestDt = dt;
      }
    }
    if (best < 0) return null;
    const judgment: Judgment = Math.abs(bestDt) <= perfect ? 'perfect' : 'good';
    const st = this.states[best];
    st.judgment = judgment;
    st.offset = bestDt;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.score += POINTS[judgment] * this.multiplier;
    return { group: this.groups[best], judgment, offset: bestDt };
  }

  /**
   * Advance to chart time `now`: accumulate sustains while the right pitch rings
   * and call misses once their window (plus grace) has passed.
   */
  update(now: number, dt: number, sounding: number | null): JudgeEvent[] {
    const out: JudgeEvent[] = [];
    const good = this.opts.good * this.speed;
    const missGrace = this.opts.missGrace * this.speed;
    for (let i = this.cursor; i < this.groups.length; i++) {
      const g = this.groups[i];
      if (g.t > now) break;
      const st = this.states[i];
      if (!this.inLoop(g)) continue;
      if (st.judgment === null && now > g.t + good + missGrace) {
        st.judgment = 'miss';
        this.streak = 0;
        out.push({ group: g, judgment: 'miss', offset: 0 });
      }
      if (st.judgment && st.judgment !== 'miss' && g.dur > 0 && !st.sustainDone) {
        const [lo, hi] = g.sustainRange;
        if (sounding !== null && now <= g.t + g.dur && this.pitchIn(sounding, lo, hi)) st.held += dt;
        if (now > g.t + g.dur) {
          st.sustainDone = true;
          const frac = Math.min(1, st.held / (g.dur * 0.8));
          this.score += Math.round(SUSTAIN_BONUS * frac) * this.multiplier;
        }
      }
    }
    while (this.cursor < this.groups.length) {
      const st = this.states[this.cursor];
      const g = this.groups[this.cursor];
      const done = st.judgment !== null && (g.dur === 0 || st.judgment === 'miss' || st.sustainDone);
      if (done || g.t < this.range[0]) this.cursor++;
      else break;
    }
    return out;
  }

  private pitchIn(m: number, lo: number, hi: number): boolean {
    if (m >= lo && m <= hi) return true;
    return this.opts.octaveTolerant && ((m + 12 >= lo && m + 12 <= hi) || (m - 12 >= lo && m - 12 <= hi));
  }

  /** Clear judgments for groups starting in [from, to) — used when a practice loop restarts. */
  resetRange(from: number, to: number): void {
    let first = -1;
    this.groups.forEach((g, i) => {
      if (g.t >= from && g.t < to) {
        this.states[i] = { judgment: null, offset: 0, held: 0, sustainDone: false };
        if (first < 0) first = i;
      }
    });
    if (first >= 0) this.cursor = Math.min(this.cursor, first);
  }

  /** Accuracy (0..1) over groups starting in [from, to); unjudged groups are ignored. */
  accuracy(from = -Infinity, to = Infinity): number {
    let total = 0;
    let hits = 0;
    this.groups.forEach((g, i) => {
      const j = this.states[i].judgment;
      if (g.t < from || g.t >= to || j === null) return;
      total++;
      if (j !== 'miss') hits++;
    });
    return total ? hits / total : 0;
  }

  sectionStats(sectionCount: number): SectionStats[] {
    const stats = Array.from({ length: sectionCount }, () => ({ total: 0, hits: 0 }));
    this.groups.forEach((g, i) => {
      const j = this.states[i].judgment;
      if (j === null) return;
      stats[g.section].total++;
      if (j !== 'miss') stats[g.section].hits++;
    });
    return stats;
  }

  counts(): Record<Judgment, number> {
    const c = { perfect: 0, good: 0, miss: 0 };
    for (const s of this.states) if (s.judgment) c[s.judgment]++;
    return c;
  }
}
