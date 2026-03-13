function timeout(name: string, fallback: number, min: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, value)
}

const OWNER = `${process.pid}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`

export const EXECUTOR_LEASE_MS = timeout("OPENCORVUS_EXECUTOR_LEASE_MS", 30_000, 5_000)

export function executorLeaseOwner() {
  return OWNER
}

export function executorLeaseUntil(now = Date.now()) {
  return now + EXECUTOR_LEASE_MS
}
