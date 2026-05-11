export interface AgentReport {
  summary: string
  detail: string
}

export interface AgentReportContext {
  structured?: unknown
  finalText?: string
  error?: string
}

export function limitSummary(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) throw new Error("agent report summary is empty")
  return normalized.length <= 280 ? normalized : normalized.slice(0, 277).trimEnd() + "..."
}

export function requireReportString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`agent report ${label} is missing`)
  }
  return value.trim()
}

export function markdownList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n")
}

export function markdownJson(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```"
}

export function paragraphSummary(text: string): string {
  const firstParagraph = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean)
  return limitSummary(firstParagraph ?? text)
}
