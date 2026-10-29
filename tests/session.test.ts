import { describe, expect, it } from 'vitest';
import { Session, CLEAN_PASSES_TO_SPEED_UP, SPEED_STEP } from '../src/game/session';
import { CHARTS } from '../src/content';
import { openMidis } from '../src/chart/tuning';

const chart = CHARTS.find((c) => c.id === 'bajo-raiz-quinta')!;
const opens = openMidis('bass', 4, [0, 0, 0, 0]);
const FRAME = 1 / 60;

/** Drive a session in fixed frames, playing every target note on time (+ latency). */
function perform(s: Session, from: number, until: number, latency = 0, play = true) {
  const played = new Set<number>();
  for (let ctx = from; ctx < until && s.status === 'running'; ctx += FRAME) {
    const chartNow = s.chartTime(ctx);
    if (play) {
      for (const g of s.groups) {
        const key = g.index * 1000 + s.passes.length;
        if (!played.has(key) && g.t <= chartNow && g.t > chartNow - 0.2) {
          played.add(key);
          s.noteEvent(s.ctxTime(g.t) + latency, g.midis[0]);
        }
      }
    }
    s.frame(ctx, null);
  }
}

describe('Session', () => {
  it('counts in, plays to the end and finishes with full accuracy', () => {
    const s = new Session({ chart, openMidis: opens, mode: 'play', speed: 1, latency: 0 });
    s.start(10);
    expect(s.chartTime(10)).toBeCloseTo(-s.leadIn);
    perform(s, 10, 10 + s.leadIn + s.end + 2);
    expect(s.status).toBe('finished');
    expect(s.result().accuracy).toBe(1);
    expect(s.result().sections.every((x) => x.hits === x.total)).toBe(true);
  });

  it('compensates for input latency', () => {
    const s = new Session({ chart, openMidis: opens, mode: 'play', speed: 1, latency: 0.12 });
    s.start(0);
    perform(s, 0, s.leadIn + s.end + 2, 0.12);
    expect(s.result().counts.perfect).toBe(s.groups.length);
  });

  it('keeps the chart position when the speed changes', () => {
    const s = new Session({ chart, openMidis: opens, mode: 'play', speed: 1, latency: 0 });
    s.start(0);
    const before = s.chartTime(3);
    s.setSpeed(0.5, 3);
    expect(s.chartTime(3)).toBeCloseTo(before);
    expect(s.chartTime(5)).toBeCloseTo(before + 1);
  });

  it('speeds up after clean practice loops and records the best clean speed', () => {
    const s = new Session({ chart, openMidis: opens, mode: 'practice', speed: 0.7, latency: 0 });
    s.start(0);
    let t = 0;
    for (let pass = 0; pass < CLEAN_PASSES_TO_SPEED_UP; pass++) {
      const startPasses = s.passes.length;
      const until = t + (s.leadIn + s.end + 1) / s.speed;
      for (; t < until && s.passes.length === startPasses; t += FRAME) {
        perform(s, t, t + FRAME);
      }
    }
    expect(s.passes.length).toBe(CLEAN_PASSES_TO_SPEED_UP);
    expect(s.passes.every((p) => p.clean)).toBe(true);
    expect(s.speed).toBeCloseTo(0.7 + SPEED_STEP);
    expect(s.bestCleanSpeed).toBeCloseTo(0.7);
  });

  it('does not speed up on sloppy passes, and only judges notes inside the loop', () => {
    const s = new Session({ chart, openMidis: opens, mode: 'practice', speed: 0.8, latency: 0 });
    const a = chart.sections[1].start;
    s.setLoop(a, s.end);
    s.start(0);
    perform(s, 0, 60, 0, false);
    expect(s.passes.length).toBeGreaterThan(2);
    expect(s.speed).toBe(0.8);
    s.groups.forEach((g, i) => {
      if (g.t < a) expect(s.scorer.states[i].judgment).toBeNull();
    });
  });

  it('pauses and resumes with a count-in', () => {
    const s = new Session({ chart, openMidis: opens, mode: 'play', speed: 1, latency: 0 });
    s.start(0);
    s.frame(5, null);
    s.pause(5);
    const at = s.chartTime(5);
    expect(s.chartTime(9)).toBe(at);
    s.resume(9);
    expect(s.chartTime(9)).toBeCloseTo(at - s.leadIn);
  });
});
