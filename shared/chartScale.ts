/** Axis end for count bar charts. Values 1–4 use 0–5 so a single order does not fill the plot. */
export function countAxisEnd(max: number) {
  const value = Math.max(0, Math.ceil(Number.isFinite(max) ? max : 0))
  if (value <= 4) return 5
  const steps = [10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000]
  for (const step of steps) {
    if (value <= step) return step
  }
  const magnitude = 10 ** Math.ceil(Math.log10(value))
  return magnitude
}

export function countAxisTicks(end: number) {
  const limit = Math.max(0, Math.floor(end))
  if (limit <= 5) return Array.from({ length: limit + 1 }, (_, index) => index)
  const step = limit <= 10 ? 5 : limit <= 20 ? 5 : limit <= 50 ? 10 : limit <= 100 ? 25 : Math.max(1, Math.round(limit / 4))
  const ticks: number[] = []
  for (let value = 0; value < limit; value += step) ticks.push(value)
  if (ticks[ticks.length - 1] !== limit) ticks.push(limit)
  return ticks
}
