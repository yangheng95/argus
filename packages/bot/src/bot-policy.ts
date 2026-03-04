export const BOT_PERMISSION_REPLY_ENV = "OPENCORVUS_BOT_PERMISSION_ASK_REPLY"
export const PERMISSION_REPLY_ENV = "OPENCORVUS_PERMISSION_ASK_REPLY"
export const BOT_QUEUE_LIMIT_ENV = "OPENCORVUS_BOT_SESSION_QUEUE_LIMIT"
export const BOT_QUEUE_LIMIT_DEFAULT = 20

export type PermissionReply = "once" | "always" | "reject"
type Env = Record<string, string | undefined>

export function queueLimit(env: Env = process.env): number {
  const raw = env[BOT_QUEUE_LIMIT_ENV]
  if (!raw) return BOT_QUEUE_LIMIT_DEFAULT
  const value = Number(raw)
  if (!Number.isFinite(value)) return BOT_QUEUE_LIMIT_DEFAULT
  if (value < 1) return BOT_QUEUE_LIMIT_DEFAULT
  return Math.floor(value)
}

export function permissionReply(env: Env = process.env): PermissionReply {
  const raw = (env[BOT_PERMISSION_REPLY_ENV] ?? env[PERMISSION_REPLY_ENV])?.trim().toLowerCase()
  if (raw === "once") return "once"
  if (raw === "always") return "always"
  if (raw === "reject") return "reject"
  return "always"
}
