// Color stops: deep blue (low/valley) → cyan → green → yellow → red (high/peak)
const STOPS: [number, number, number, number][] = [
  [0.0, 0.05, 0.15, 0.6],   // deep blue
  [0.2, 0.0, 0.5, 0.8],     // cyan
  [0.4, 0.2, 0.7, 0.3],     // green
  [0.6, 0.8, 0.8, 0.1],     // yellow
  [0.8, 0.9, 0.4, 0.1],     // orange
  [1.0, 0.9, 0.1, 0.1],     // red
]

export function scoreToColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))

  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, r0, g0, b0] = STOPS[i]
    const [t1, r1, g1, b1] = STOPS[i + 1]
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return [
        r0 + (r1 - r0) * f,
        g0 + (g1 - g0) * f,
        b0 + (b1 - b0) * f,
      ]
    }
  }

  const last = STOPS[STOPS.length - 1]
  return [last[1], last[2], last[3]]
}
