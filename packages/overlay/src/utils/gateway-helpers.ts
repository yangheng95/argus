import type { GatewayTaskCandidate } from "../services/gateway"
import { t } from "./i18n"

export type LedgerFilter = "all" | "active" | "queued" | "waiting" | "failed" | "completed" | "cancelled"
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

export function composeTaskText(candidate: GatewayTaskCandidate): string {
  const lines: string[] = []
  if (candidate.title) lines.push(`# ${candidate.title}`)
  if (candidate.description) {
    lines.push("")
    lines.push(candidate.description.trim())
  }
  if (candidate.acceptance.length > 0) {
    lines.push("")
    lines.push("## Acceptance")
    for (const a of candidate.acceptance) lines.push(`- ${a}`)
  }
  if (candidate.dependencies.length > 0) {
    lines.push("")
    lines.push(`## Depends on candidates: ${candidate.dependencies.join(", ")}`)
  }
  if (candidate.risks.length > 0) {
    lines.push("")
    lines.push("## Risks")
    for (const r of candidate.risks) lines.push(`- ${r}`)
  }
  return lines.join("\n").trim()
}
