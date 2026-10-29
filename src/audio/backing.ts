// Generated backing: a synthesized drum groove and metronome, scheduled ahead
// on the audio clock. Also schedules demo (autoplay) notes.

import { pluck } from './synth';
import { midiToFreq } from './notes';

type Voice = 'kick' | 'snare' | 'hat' | 'click' | 'accent';
interface Hit { beat: number; voice: Voice; gain: number }

/** One bar of groove per time signature (beats are the denominator note). */
function groove(beatsPerBar: number): Hit[] {
  const hits: Hit[] = [];
  const hats = (n: number) => {
    for (let b = 0; b < n; b += 0.5) hits.push({ beat: b, voice: 'hat', gain: b % 1 === 0 ? 0.35 : 0.22 });
  };
  if (beatsPerBar === 2) {
    // Corrido / polka: bass drum on the beat, chick on the off-beat.
    hits.push({ beat: 0, voice: 'kick', gain: 1 }, { beat: 0.5, voice: 'snare', gain: 0.55 }, { beat: 1, voice: 'kick', gain: 0.85 }, { beat: 1.5, voice: 'snare', gain: 0.6 });
    hats(2);
  } else if (beatsPerBar === 3) {
    // Tumbado / vals feel: kick on one, snare on two and three.
    hits.push({ beat: 0, voice: 'kick', gain: 1 }, { beat: 1, voice: 'snare', gain: 0.5 }, { beat: 2, voice: 'snare', gain: 0.6 }, { beat: 2.5, voice: 'kick', gain: 0.45 });
    hats(3);
  } else {
    for (let b = 0; b < beatsPerBar; b++) hits.push({ beat: b, voice: b % 2 === 0 ? 'kick' : 'snare', gain: b % 2 === 0 ? 1 : 0.6 });
    hits.push({ beat: beatsPerBar - 1.5, voice: 'kick', gain: 0.5 });
    hats(beatsPerBar);
  }
  return hits;
}

export interface BackingOptions {
  drums: boolean;
  click: boolean;
}

export class BackingTrack {
  private noise: AudioBuffer;
  private scheduled: { node: AudioScheduledSourceNode; end: number }[] = [];
  /** Next beat index (relative to chart start) not yet scheduled. */
  private nextBeat = 0;
  private hits: Hit[];

  constructor(
    private ctx: AudioContext,
    private dest: AudioNode,
    private bpm: number,
    private beatsPerBar: number,
  ) {
    this.hits = groove(beatsPerBar);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Forget the schedule (after a seek, speed change or pause). */
  reset(fromChart: number): void {
    const now = this.ctx.currentTime;
    for (const { node } of this.scheduled) {
      try {
        node.stop(now);
      } catch {
        /* already stopped */
      }
    }
    this.scheduled = [];
    this.nextBeat = Math.ceil((fromChart * this.bpm) / 60 - 1e-6);
  }

  /**
   * Schedule everything up to `untilChart`. Before chart time 0 only a count-in
   * click plays.
   */
  schedule(untilChart: number, toCtx: (chartT: number) => number, speed: number, opts: BackingOptions): void {
    const spb = 60 / this.bpm;
    const now = this.ctx.currentTime;
    this.scheduled = this.scheduled.filter((s) => s.end > now);
    while (this.nextBeat * spb < untilChart) {
      const beat = this.nextBeat++;
      const inBar = ((beat % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
      const countIn = beat < 0;
      if (countIn || opts.click) this.play(inBar === 0 ? 'accent' : 'click', toCtx(beat * spb), countIn ? 0.7 : 0.45, speed);
      if (!countIn && opts.drums) {
        for (const h of this.hits) {
          if (h.beat >= inBar && h.beat < inBar + 1) this.play(h.voice, toCtx((beat + h.beat - inBar) * spb), h.gain, speed);
        }
      }
    }
  }

  private track(node: AudioScheduledSourceNode, end: number): void {
    this.scheduled.push({ node, end });
  }

  private play(voice: Voice, at: number, gain: number, speed: number): void {
    const ctx = this.ctx;
    if (at < ctx.currentTime - 0.01) return;
    const g = ctx.createGain();
    g.connect(this.dest);
    if (voice === 'kick') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(130, at);
      o.frequency.exponentialRampToValueAtTime(42, at + 0.14);
      g.gain.setValueAtTime(gain * 0.9, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.36);
      this.track(o, at + 0.36);
    } else if (voice === 'snare' || voice === 'hat') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = voice === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = voice === 'hat' ? 7000 : 1800;
      const len = voice === 'hat' ? 0.04 : 0.16 / Math.max(0.6, speed);
      g.gain.setValueAtTime(gain * (voice === 'hat' ? 0.25 : 0.5), at);
      g.gain.exponentialRampToValueAtTime(0.001, at + len);
      src.connect(f).connect(g);
      src.start(at, Math.random() * 0.5);
      src.stop(at + len + 0.01);
      this.track(src, at + len);
    } else {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = voice === 'accent' ? 1760 : 1320;
      g.gain.setValueAtTime(gain * 0.12, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.06);
      this.track(o, at + 0.06);
    }
  }
}

/** Schedules plucked notes for the demo/autoplay mode. */
export class DemoPlayer {
  private scheduled: AudioBufferSourceNode[] = [];
  private next = 0;

  constructor(
    private ctx: AudioContext,
    private dest: AudioNode,
    private notes: { t: number; midi: number; end: number; soft: boolean }[],
  ) {}

  reset(fromChart: number): void {
    for (const s of this.scheduled) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.scheduled = [];
    this.next = this.notes.findIndex((n) => n.t >= fromChart - 1e-6);
    if (this.next < 0) this.next = this.notes.length;
  }

  schedule(untilChart: number, toCtx: (chartT: number) => number, speed: number): void {
    while (this.next < this.notes.length && this.notes[this.next].t < untilChart) {
      const n = this.notes[this.next++];
      const at = toCtx(n.t);
      if (at < this.ctx.currentTime) continue;
      const length = Math.max(0.08, (n.end - n.t) / speed);
      const data = pluck(midiToFreq(n.midi), this.ctx.sampleRate, { length, gain: n.soft ? 0.18 : 0.3, seed: this.next });
      const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      buf.copyToChannel(data, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.dest);
      src.start(at);
      this.scheduled.push(src);
      src.onended = () => (this.scheduled = this.scheduled.filter((s) => s !== src));
    }
  }
}
