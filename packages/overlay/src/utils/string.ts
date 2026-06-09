// ── String utilities ──
// .

// escapeHtml is already ported in utils/markdown.ts — re-export to avoid
// duplication while providing a single string-utils import point.
export { escapeHtml } from "./markdown"

// ── displayString ──

/**
 * Convert an arbitrary value to a human-readable display string.
 * Returns "" for undefined/null, stringified JSON-like artefacts that
 * carry no useful information ("[object Object]", "[]", "null", "{}"),
 * and non-string primitives are converted via String().
 * Note: the `space` parameter is accepted for signature compatibility with
 * the original definition; the current implementation does not use it
 * because JSON pretty-printing is not needed at this call site.
 */
export function displayString(value: unknown, _space = 0): string {
  if (typeof value === "string") {
    const t = value.trim()
    if (t === "[object Object]" || t === "[]" || t === "null" || t === "{}") {
      return ""
    }
    return value
  }
  if (value === undefined || value === null) return ""
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return ""
}

// ── clipText ──

/**
 * Truncate a value's string representation to at most `limit` characters,
 * collapsing internal whitespace and appending "..." when truncated.
 */
export function clipText(value: unknown, limit = 80): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return ""
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`
}

// ── stripAssistantBrief ──

/**
 * Strip injected <assistant-brief> block and boilerplate from
 * user messages. Extracts only the "Request:" field value as the actual user
 * content.
 */
export function stripAssistantBrief(text: string): string {
  // Remove <assistant-brief>...</assistant-brief> block
  const briefRe = /<assistant-brief>[\s\S]*?<\/assistant-brief>/
  let cleaned = text.replace(briefRe, "")

  // Remove instruction lines that follow the brief
  cleaned = cleaned
    .replace(/Use the brief above to align your work before executing the task\.\s*/g, "")
    .replace(/You are executing a headless coding task[^\n]*\n?/g, "")
    .replace(/^Task:\s*[^\n]*\n?/gm, "")
    .replace(/^Goals:\n(?:- [^\n]*\n?)*/gm, "")
    .replace(/^Request:\s*\n?/gm, "")

  return cleaned.trim()
}

// ── joinBullet ──

/**
 * Join non-empty string values with " / " separator, filtering out falsy
 * entries (
 */
export function joinBullet(values: string[]): string {
  return values.filter(Boolean).join(" / ")
}

// ── delay ──

/**
 * Return a Promise that resolves after `ms` milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── dedupe ──

/**
 * Return a deduplicated copy of `list`, preserving insertion order and
 * filtering out falsy values. Non-array input is treated as an empty list.
 */
export function dedupe<T>(list: T[]): T[] {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean) as T[])]
}

// ── isAbortError ──

/**
 * Return true when `error` is an AbortError thrown by the Fetch/AbortController
 * API or AbortSignal.timeout().
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

// ── shellSplit ──

/**
 * Split a shell-style command string into tokens, respecting single- and
 * double-quoted segments and backslash escapes within quotes.
 * @example
 * shellSplit('foo "bar baz" \'qux\'') // ["foo", "bar baz", "qux"]
 */
export function shellSplit(text: string): string[] {
  const result: string[] = []
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g
  for (const match of text.matchAll(re)) {
    result.push((match[1] ?? match[2] ?? match[0] ?? "").replace(/\\(["'])/g, "$1"))
  }
  return result.filter(Boolean)
}
