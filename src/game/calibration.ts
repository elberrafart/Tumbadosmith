// Latency calibration math: the player picks along with clicks; the median
// click-to-attack offset is the round-trip latency (output + input + reaction bias).

const MIN_MATCHES = 5;

/** Median offset of detected attacks from their clicks, or null if too few matched. */
export function measureLatency(clicks: number[], onsets: number[], minMatches = MIN_MATCHES): number | null {
  const offsets: number[] = [];
  for (const c of clicks) {
    let best: number | null = null;
    for (const o of onsets) {
      const d = o - c;
      if (d < -0.1 || d > 0.45) continue;
      if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    }
    if (best !== null) offsets.push(best);
  }
  if (offsets.length < minMatches) return null;
  offsets.sort((a, b) => a - b);
  return Math.max(0, offsets[Math.floor(offsets.length / 2)]);
}
