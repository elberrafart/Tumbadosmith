// Karplus-Strong plucked string. Used for the demo/autoplay input and in tests.

export interface PluckOptions {
  /** 0..1, higher keeps more high-frequency content. */
  brightness?: number;
  /** Peak amplitude. */
  gain?: number;
  /** Seconds before a short fade-out (string muted). */
  length?: number;
  /** Seeded noise for repeatable output. */
  seed?: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

export function pluck(freq: number, sampleRate: number, opts: PluckOptions = {}): Float32Array<ArrayBuffer> {
  const { brightness = 0.6, gain = 0.5, length = 1.2, seed = 1 } = opts;
  const total = Math.ceil(sampleRate * (length + 0.05));
  const out = new Float32Array(total);
  // The two-point average adds half a sample of delay.
  const period = sampleRate / freq - 0.5;
  const n = Math.max(2, Math.floor(period));
  const frac = period - n; // fractional delay via a first-order allpass
  const c = (1 - frac) / (1 + frac);
  const line = new Float32Array(n);
  const rand = rng(seed);
  // Pre-filtered noise burst: darker for lower brightness.
  let lpState = 0;
  for (let i = 0; i < n; i++) {
    lpState += brightness * (rand() - lpState);
    line[i] = lpState;
  }
  let idx = 0;
  let prev = 0;
  let apX = 0;
  let apY = 0;
  const damp = 0.996;
  const fadeStart = Math.floor(sampleRate * length);
  const fadeLen = total - fadeStart;
  for (let i = 0; i < total; i++) {
    const cur = line[idx];
    const avg = damp * 0.5 * (cur + prev);
    prev = cur;
    const ap = c * avg + apX - c * apY;
    apX = avg;
    apY = ap;
    line[idx] = ap;
    idx = (idx + 1) % n;
    let env = 1;
    if (i >= fadeStart) env = 1 - (i - fadeStart) / fadeLen;
    out[i] = cur * gain * env;
  }
  return out;
}
