// A play-through of one chart: clock, speed, A-B loop, auto speed-up and scoring.
// Pure logic driven by audio-context times, so it can be unit tested and ported.

import type { Chart } from '../chart/types';
import { barLength, buildGroups, chartEnd, type TargetGroup } from '../chart/timeline';
import { Scorer, type JudgeEvent, type SectionStats } from '../chart/scorer';

export type Mode = 'play' | 'practice';
export type Status = 'ready' | 'running' | 'paused' | 'finished';

export interface SessionOptions {
  chart: Chart;
  openMidis: number[];
  mode: Mode;
  speed: number;
  /** Input + output latency to subtract from detected note times, seconds. */
  latency: number;
}

export interface PassResult {
  accuracy: number;
  speed: number;
  clean: boolean;
}

export interface SessionResult {
  accuracy: number;
  score: number;
  bestStreak: number;
  counts: { perfect: number; good: number; miss: number };
  sections: (SectionStats & { name: string })[];
  speed: number;
  passes: PassResult[];
  bestCleanSpeed: number;
}

/** A practice pass at or above this accuracy is "clean". */
export const CLEAN_ACCURACY = 0.9;
/** Clean passes in a row before auto speed-up. */
export const CLEAN_PASSES_TO_SPEED_UP = 3;
export const SPEED_STEP = 0.05;
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 1;
/** Play this long past the loop end so late notes can still be judged. */
const LOOP_TAIL = 0.5;

export class Session {
  readonly chart: Chart;
  readonly groups: TargetGroup[];
  readonly scorer: Scorer;
  readonly end: number;
  readonly leadIn: number;
  readonly mode: Mode;
  status: Status = 'ready';
  speed: number;
  latency: number;
  loop: { a: number; b: number } | null = null;
  autoSpeedUp = true;
  passes: PassResult[] = [];
  cleanStreak = 0;
  bestCleanSpeed = 0;
  /** Called after each completed practice loop. */
  onPass: ((p: PassResult) => void) | null = null;
  private anchorCtx = 0;
  private anchorChart = 0;
  private pausedAt = 0;
  private lastChart = -Infinity;
  private lastPassSections: SectionStats[] | null = null;

  constructor(opts: SessionOptions) {
    this.chart = opts.chart;
    this.mode = opts.mode;
    this.speed = opts.speed;
    this.latency = opts.latency;
    this.groups = buildGroups(opts.chart, opts.openMidis);
    this.scorer = new Scorer(this.groups);
    this.scorer.setSpeed(this.speed);
    this.end = chartEnd(opts.chart);
    this.leadIn = barLength(opts.chart);
    if (this.mode === 'practice') this.setLoop(0, this.end);
  }

  /** Chart time for an audio-context time. */
  chartTime(ctxTime: number): number {
    if (this.status === 'paused' || this.status === 'ready') return this.pausedAt;
    return this.anchorChart + (ctxTime - this.anchorCtx) * this.speed;
  }

  /** Audio-context time at which chart time `t` plays (at the current speed). */
  ctxTime(chartT: number): number {
    return this.anchorCtx + (chartT - this.anchorChart) / this.speed;
  }

  private loopStart(): number {
    return (this.loop ? this.loop.a : 0) - this.leadIn;
  }

  start(ctxNow: number): void {
    this.anchorCtx = ctxNow;
    this.anchorChart = this.loopStart();
    this.lastChart = this.anchorChart;
    this.status = 'running';
  }

  pause(ctxNow: number): void {
    if (this.status !== 'running') return;
    this.pausedAt = this.chartTime(ctxNow);
    this.status = 'paused';
  }

  /** Resume with a one-bar count-in before the paused position. */
  resume(ctxNow: number): void {
    if (this.status !== 'paused') return;
    this.seek(Math.max(this.loopStart(), this.pausedAt - this.leadIn), ctxNow);
    this.status = 'running';
  }

  seek(chartT: number, ctxNow: number): void {
    this.anchorCtx = ctxNow;
    this.anchorChart = chartT;
    this.lastChart = chartT;
    this.pausedAt = chartT;
  }

  setSpeed(speed: number, ctxNow: number): void {
    const now = this.chartTime(ctxNow);
    this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
    this.scorer.setSpeed(this.speed);
    if (this.status === 'running') this.seek(now, ctxNow);
  }

  setLoop(a: number, b: number): void {
    this.loop = { a: Math.max(0, Math.min(a, b)), b: Math.min(this.end, Math.max(a, b)) };
    this.scorer.setRange(this.loop.a, this.loop.b);
    this.cleanStreak = 0;
  }

  clearLoop(): void {
    this.loop = null;
    this.scorer.setRange(-Infinity, Infinity);
  }

  /** A detected note, stamped in context time. */
  noteEvent(ctxT: number, midi: number): JudgeEvent | null {
    if (this.status !== 'running') return null;
    return this.scorer.onEvent(this.chartTime(ctxT - this.latency), midi);
  }

  strumEvent(ctxT: number, chroma: number[]): JudgeEvent | null {
    if (this.status !== 'running') return null;
    return this.scorer.onStrum(this.chartTime(ctxT - this.latency), chroma);
  }

  /**
   * Advance the session. Returns judgments made this frame and whether the clock
   * jumped (loop restart), so callers can reschedule audio.
   */
  frame(ctxNow: number, sounding: number | null): { judged: JudgeEvent[]; jumped: boolean } {
    if (this.status !== 'running') return { judged: [], jumped: false };
    const now = this.chartTime(ctxNow);
    const dt = Math.max(0, now - this.lastChart);
    this.lastChart = now;
    const judged = this.scorer.update(now - this.latency * this.speed, dt, sounding);

    if (this.loop && now >= this.loop.b + LOOP_TAIL) {
      this.completePass(ctxNow);
      return { judged, jumped: true };
    }
    if (!this.loop && now >= this.end + LOOP_TAIL) this.status = 'finished';
    return { judged, jumped: false };
  }

  private completePass(ctxNow: number): void {
    const { a, b } = this.loop!;
    const accuracy = this.scorer.accuracy(a, b);
    const clean = accuracy >= CLEAN_ACCURACY;
    const pass = { accuracy, speed: this.speed, clean };
    this.passes.push(pass);
    if (clean) {
      this.bestCleanSpeed = Math.max(this.bestCleanSpeed, this.speed);
      this.cleanStreak++;
      if (this.autoSpeedUp && this.cleanStreak >= CLEAN_PASSES_TO_SPEED_UP && this.speed < MAX_SPEED) {
        this.setSpeed(this.speed + SPEED_STEP, ctxNow);
        this.cleanStreak = 0;
      }
    } else {
      this.cleanStreak = 0;
    }
    this.onPass?.(pass);
    this.lastPassSections = this.scorer.sectionStats(this.chart.sections.length);
    this.scorer.resetRange(a, b);
    this.seek(a - this.leadIn, ctxNow);
  }

  result(): SessionResult {
    const stats = this.lastPassSections ?? this.scorer.sectionStats(this.chart.sections.length);
    const last = this.passes[this.passes.length - 1];
    return {
      accuracy: this.passes.length ? Math.max(...this.passes.map((p) => p.accuracy)) : this.scorer.accuracy(),
      score: this.scorer.score,
      bestStreak: this.scorer.bestStreak,
      counts: this.scorer.counts(),
      sections: stats.map((s, i) => ({ ...s, name: this.chart.sections[i].name })),
      speed: last ? last.speed : this.speed,
      passes: this.passes,
      bestCleanSpeed: this.bestCleanSpeed,
    };
  }
}
