import { ApiError } from "../services/api"
import { t } from "./i18n"

export type LedgerFilter = "all" | "active" | "queued" | "waiting" | "failed" | "completed" | "cancelled"

/**
 * Hard upper bound on the prompt text the operator can submit to
 * `/gateway/master/wake`. The server caps the payload at 32_000
 * characters; the overlay surfaces the same number so the operator
 * sees a counter approach the limit and the textarea itself refuses
 * extra typing instead of letting them queue up a request that will
 * fail at the network layer. Single source — the server route should
 * keep parity with this constant.
 */
export const GATEWAY_REQUIREMENT_MAX_CHARS = 32_000
export type GatewayStatusIconName =
  | "status-queued"
  | "status-active"
  | "status-completed"
  | "status-failed"
  | "status-cancelled"
  | "status-idle"

export function pendingInteractions(item: any): number {
  const value = Number(item?.pending_interactions ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function filterMatches(status: string, filter: LedgerFilter, item?: any): boolean {
  switch (filter) {
    case "all":
      return true
    case "active":
      return status === "active" && pendingInteractions(item) === 0
    case "queued":
      return status === "queued"
    case "waiting":
      return pendingInteractions(item) > 0
    case "failed":
      return status === "failed"
    case "completed":
      return status === "completed"
    case "cancelled":
      return status === "cancelled"
  }
}

export function statusIconFor(status: string): GatewayStatusIconName {
  switch (status) {
    case "queued":
      return "status-queued"
    case "active":
      return "status-active"
    case "completed":
      return "status-completed"
    case "failed":
      return "status-failed"
    case "cancelled":
      return "status-cancelled"
    default:
      return "status-idle"
  }
}

export function compactDirectory(value: string): string {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalized) return ""
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length <= 3) return normalized
  return `…/${parts.slice(-3).join("/")}`
}

export function runtimeLabel(status: string): string {
  // Template literal: the i18n check reads the static prefix
  // ("gateway.runtime") and considers every nested key referenced.
  const value = t(`gateway.runtime.${status}`)
  return value === `gateway.runtime.${status}` ? status : value
}

/**
 * Translate a raw server error into the operator-facing copy the Gateway
 * should render. The overlay's `ApiError` wraps server responses as
 *
 *   "API <status> <path>: <ErrorClass>: <detail>"
 *
 * so the original class name lives deep inside, not at the start. Round-2
 * shipped a regex anchored to `^` that never matched the wrapped form,
 * which the round-3 visual review caught when the page-level banner kept
 * leaking the raw URL-encoded path + internal class name to the operator.
 * Fix is structural: match every `<ClassName>:` token in the message and
 * pick the **last** one (deepest in the wrap chain), which is always the
 * authoritative server-side class.
 *
 * Lives in helpers (not in the Gateway component) so unit tests can
 * exercise the unwrap behaviour directly with a real `ApiError`, instead
 * of grepping the component source for the function name (rule 28 — the
 * regression we're guarding against is BEHAVIOUR, not structure).
 */
export function humanizeApiError(err: unknown): string {
  let raw: string
  if (err instanceof ApiError) {
    raw = err.message.trim()
  } else if (err instanceof Error) {
    raw = err.message.trim()
  } else {
    raw = String(err).trim()
  }
  const matches = [...raw.matchAll(/([A-Z][a-zA-Z]+(?:Error|Exception))\s*:/g)]
  if (matches.length > 0) {
    // Last match wins — ApiError wraps "API <code> <path>: <Class>: …", so
    // the inner class is always rightmost. If the body itself nests
    // (e.g. "FooError: BarError: …"), the rightmost is still the most
    // specific signal we have.
    const lastClass = matches[matches.length - 1][1]
    const translated = t(`gateway.error.class.${lastClass}`)
    if (translated !== `gateway.error.class.${lastClass}`) return translated
  }
  // No known class — keep the operator informed but cap so a long stack
  // can't blow out the banner; the full message is still logged
  // server-side (decompose route does this explicitly).
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw
}

