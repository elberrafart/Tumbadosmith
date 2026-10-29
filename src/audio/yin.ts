// YIN pitch detector (de Cheveigné & Kawahara, 2002).
// Pure function over a Float32Array; no allocation when a scratch buffer is passed.

export interface PitchResult {
  /** Detected fundamental in Hz, or 0 when no periodicity was found. */
  freq: number;
  /** 1 - normalized difference at the chosen lag; ~1 for a clean tone. */
  clarity: number;
}

/**
 * Analyzes `buf[0 .. window + ceil(sampleRate / minFreq))`.
 * `scratch` must hold at least `ceil(sampleRate / minFreq) + 2` floats.
 */
export function yin(
  buf: Float32Array,
  window: number,
  sampleRate: number,
  minFreq: number,
  maxFreq: number,
  threshold = 0.15,
  scratch?: Float32Array,
): PitchResult {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq), buf.length - window - 1);
  if (tauMax <= tauMin + 2) return { freq: 0, clarity: 0 };
  const d = scratch && scratch.length >= tauMax + 2 ? scratch : new Float32Array(tauMax + 2);

  // Difference function, then cumulative-mean normalization in place.
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < window; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    running += sum;
    d[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  // First dip under the threshold, walked down to its local minimum.
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (d[tau] < threshold) {
      while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    // No confident dip: fall back to the global minimum, reported with low clarity.
    let min = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < min) {
        min = d[tau];
        best = tau;
      }
    }
  }
  if (best <= 0) return { freq: 0, clarity: 0 };

  // Parabolic interpolation for sub-sample lag precision.
  let lag = best;
  if (best > 1 && best < tauMax) {
    const a = d[best - 1];
    const b = d[best];
    const c = d[best + 1];
    const denom = a - 2 * b + c;
    if (denom > 0) lag = best + (a - c) / (2 * denom);
  }
  const clarity = Math.max(0, 1 - d[best]);
  return { freq: sampleRate / lag, clarity };
}
