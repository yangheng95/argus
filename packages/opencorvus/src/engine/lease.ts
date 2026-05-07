function timeout(name: string, fallback: number, min: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, value)
}

type Lease = {
  lease_owner?: string | null
  lease_until?: number | null
}

const OWNER = `${process.pid}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`

const EXECUTOR_LEASE_MS = timeout("OPENCORVUS_EXECUTOR_LEASE_MS", 30_000, 5_000)

export function executorLeaseOwner() {
  return OWNER
}

export function executorLeaseUntil(now = Date.now()) {
  return now + EXECUTOR_LEASE_MS
}

export function executorLeaseAvailable(input: Lease | null | undefined, now = Date.now()) {
  if (!input?.lease_owner) return true
  return (input.lease_until ?? 0) <= now
}

export function executorLeaseHeldByOther(input: Lease | null | undefined, now = Date.now()) {
  if (!input?.lease_owner) return false
  if (input.lease_owner === OWNER) return false
  return (input.lease_until ?? 0) > now
}
