const CHANNEL_PERMISSION_REPLY_ENV = "OPENCORVUS_CHANNEL_PERMISSION_ASK_REPLY"
const PERMISSION_REPLY_ENV = "OPENCORVUS_PERMISSION_ASK_REPLY"
const CHANNEL_QUEUE_LIMIT_ENV = "OPENCORVUS_CHANNEL_SESSION_QUEUE_LIMIT"
const CHANNEL_QUEUE_LIMIT_DEFAULT = 20

export type PermissionReply = "once" | "always" | "reject"
type Env = Record<string, string | undefined>

export function queueLimit(env: Env = process.env): number {
  const raw = env[CHANNEL_QUEUE_LIMIT_ENV]
  if (!raw) return CHANNEL_QUEUE_LIMIT_DEFAULT
  const value = Number(raw)
  if (!Number.isFinite(value)) return CHANNEL_QUEUE_LIMIT_DEFAULT
  if (value < 1) return CHANNEL_QUEUE_LIMIT_DEFAULT
  return Math.floor(value)
}

export function permissionReply(env: Env = process.env): PermissionReply {
  const raw = (env[CHANNEL_PERMISSION_REPLY_ENV] ?? env[PERMISSION_REPLY_ENV])?.trim().toLowerCase()
  if (raw === "once") return "once"
  if (raw === "always") return "always"
  if (raw === "reject") return "reject"
  return "always"
}
