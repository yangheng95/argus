const CHANNEL_QUEUE_LIMIT_ENV = "OPENCORVUS_CHANNEL_SESSION_QUEUE_LIMIT"
const CHANNEL_QUEUE_LIMIT_DEFAULT = 20

type Env = Record<string, string | undefined>

export function queueLimit(env: Env = process.env): number {
  const raw = env[CHANNEL_QUEUE_LIMIT_ENV]
  if (!raw) return CHANNEL_QUEUE_LIMIT_DEFAULT
  const value = Number(raw)
  if (!Number.isFinite(value)) return CHANNEL_QUEUE_LIMIT_DEFAULT
  if (value < 1) return CHANNEL_QUEUE_LIMIT_DEFAULT
  return Math.floor(value)
}
