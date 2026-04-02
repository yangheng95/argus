function numericTimestamps(values: Array<number | null | undefined>) {
  return values.filter((value): value is number => Number.isFinite(value) && Number(value) > 0)
}

export function latestActivityAt(...values: Array<number | null | undefined>) {
  const timestamps = numericTimestamps(values)
  if (timestamps.length < 1) return 0
  return Math.max(...timestamps)
}

export function inactivityAgeMs(now: number, ...values: Array<number | null | undefined>) {
  const latest = latestActivityAt(...values)
  if (latest < 1) return Number.POSITIVE_INFINITY
  return Math.max(0, now - latest)
}

export function exceededInactivityTimeout(
  now: number,
  timeoutMs: number,
  ...values: Array<number | null | undefined>
) {
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) return false
  return inactivityAgeMs(now, ...values) >= timeoutMs
}
