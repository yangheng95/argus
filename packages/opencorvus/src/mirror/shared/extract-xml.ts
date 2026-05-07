/**
 * XML tag extraction and code-block parsing.
 * Ported from mirror/src/infra/parser/extract.ts.
 *
 * SAX-based tag extraction (htmlparser2) for robust handling of:
 *   - Tags with attributes (e.g. `<source-code lang="tsx">`)
 *   - Nested same-name tags (depth tracking)
 *   - Truncated output (missing close tags — `parser.end()` auto-closes)
 *   - Hyphenated tag names (`source-code`, `project-framework`, `file-audit`)
 *
 * Content is extracted via position-based slicing (startIndex/endIndex) to
 * preserve original text verbatim (JSX, markdown, etc.).
 */

import { Parser } from "htmlparser2"
import JSON5 from "json5"
import { Log } from "@/util/log"

const log = Log.create({ service: "mirror.extract-xml" })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtractFailReason = "no_open_tag" | "no_close_tag" | "empty_content" | "no_fence"

export type ExtractResult = { ok: true; content: string } | { ok: false; reason: ExtractFailReason }

export interface TagMatch {
  content: string
  attrs: Record<string, string>
}

// ---------------------------------------------------------------------------
// Internal: SAX-based tag extraction
// ---------------------------------------------------------------------------

/**
 * Neutralise XML closing tags inside fenced code blocks so the SAX parser
 * does not prematurely close outer tags. Uses a same-length sentinel (`<~`)
 * so character positions remain identical to the original text, letting us
 * slice content from the original using SAX-reported indices.
 */
function shieldCodeFences(text: string): string {
  return text.replace(/`{3,}[\s\S]*?`{3,}/g, (fence) => fence.replace(/<\//g, "<~"))
}

function saxExtractAll(text: string, tagName: string): TagMatch[] {
  const results: TagMatch[] = []
  let depth = 0
  let contentStart = -1
  let currentAttrs: Record<string, string> = {}

  const shielded = shieldCodeFences(text)

  const parser = new Parser(
    {
      onopentag(name: string, attrs: Record<string, string>) {
        if (name === tagName) {
          if (depth === 0) {
            contentStart = (parser as any).endIndex + 1
            currentAttrs = { ...attrs }
          }
          depth++
        }
      },
      onclosetag(name: string) {
        if (name === tagName) {
          depth--
          if (depth === 0 && contentStart !== -1) {
            const contentEnd = (parser as any).startIndex
            const raw = text.slice(contentStart, contentEnd)
            results.push({ content: raw.trim(), attrs: currentAttrs })
            contentStart = -1
          }
        }
      },
    },
    { decodeEntities: false, xmlMode: true },
  )

  parser.write(shielded)
  parser.end()

  return results
}

// ---------------------------------------------------------------------------
// extractTag / extractAllTags
// ---------------------------------------------------------------------------

export function extractTag(text: string, tagName: string): string | undefined {
  const matches = saxExtractAll(text, tagName)
  return matches.length > 0 ? matches[0].content : undefined
}

export function extractAllTags(text: string, tagName: string): string[] {
  return saxExtractAll(text, tagName).map((m) => m.content)
}

export function extractTagWithAttrs(text: string, tagName: string): TagMatch | undefined {
  const matches = saxExtractAll(text, tagName)
  return matches.length > 0 ? matches[0] : undefined
}

export function extractAllTagsWithAttrs(text: string, tagName: string): TagMatch[] {
  return saxExtractAll(text, tagName)
}

// ---------------------------------------------------------------------------
// extractFencedCode — take LAST match, support \r\n
// ---------------------------------------------------------------------------

export function extractFencedCode(text: string): string | undefined {
  const normalised = text.replace(/\r\n/g, "\n")
  const matches = [...normalised.matchAll(/`{3,}(?:\w+)?\s*\n([\s\S]*?)\n\s*`{3,}/g)]
  if (matches.length === 0) return undefined
  // LLMs typically put the final code last.
  const last = matches[matches.length - 1]
  return last[1].trim() || undefined
}

// ---------------------------------------------------------------------------
// Code-likeness heuristic + extractCode
// ---------------------------------------------------------------------------

const CODE_KEYWORDS =
  /\b(?:import|export|function|const|let|var|return|class|interface|type|enum|if|for|while|switch|from|require|module|default)\b/

function looksLikeCode(text: string): boolean {
  return CODE_KEYWORDS.test(text) || text.length > 20
}

export function extractCodeWithReason(text: string): ExtractResult {
  // Defensive: strip reasoning model <think> blocks (client should already do this).
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim() || text

  const hasOpenTag = /<source-code[\s>]/.test(cleaned)
  const tagged = extractTag(cleaned, "source-code")

  if (tagged) {
    const code = extractFencedCode(tagged) ?? tagged
    if (code.trim().length === 0) return { ok: false, reason: "empty_content" }
    return { ok: true, content: code }
  }

  if (hasOpenTag) return { ok: false, reason: "empty_content" }

  const fenced = extractFencedCode(cleaned)
  if (fenced && looksLikeCode(fenced)) return { ok: true, content: fenced }

  if (!fenced) return { ok: false, reason: "no_fence" }
  return { ok: false, reason: "empty_content" }
}

export function extractCode(text: string): string | undefined {
  const result = extractCodeWithReason(text)
  return result.ok ? result.content : undefined
}

// ---------------------------------------------------------------------------
// extractPlan / extractProject
// ---------------------------------------------------------------------------

export function extractPlan(text: string): unknown | undefined {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim() || text

  const tagged = extractTag(cleaned, "project-framework")
  if (tagged) {
    const json = extractFencedCode(tagged) ?? tagged
    const result = parseJSON(json)
    if (result) return result
    log.warn("extractPlan primary path failed", {
      taggedChars: tagged.length,
      fenced: extractFencedCode(tagged) !== undefined,
      jsonStart: json.slice(0, 80),
    })
  }

  // Fallback 1: truncated close tag — slice after opener.
  const openTag = "<project-framework>"
  const openIdx = cleaned.indexOf(openTag)
  if (openIdx !== -1) {
    const after = cleaned.slice(openIdx + openTag.length)
    const fenced = extractFencedCode(after)
    if (fenced) {
      const result = parseJSON(fenced)
      if (result) return result
    }
  }

  // Fallback 2: scan last JSON array.
  const result = extractLastJsonArray(cleaned)
  if (result) return result

  return undefined
}

export function extractProject(text: string): unknown | undefined {
  const tagged = extractTag(text, "project")
  if (!tagged) return undefined
  const json = extractFencedCode(tagged) ?? tagged
  return parseJSON(json)
}

// ---------------------------------------------------------------------------
// JSON-array scanning
// ---------------------------------------------------------------------------

function extractLastJsonArray(text: string): unknown | undefined {
  const normalised = text.replace(/\r\n/g, "\n")
  const fencedMatches = [...normalised.matchAll(/`{3,}(?:json)?\s*\n([\s\S]*?)\n\s*`{3,}/g)]
  for (let i = fencedMatches.length - 1; i >= 0; i--) {
    const extracted = extractJsonArray(fencedMatches[i][1])
    if (extracted) {
      const result = parseJSON(extracted)
      if (Array.isArray(result) && result.length > 0 && (result[0] as any)?.file_path) {
        return result
      }
    }
  }

  const extracted = extractJsonArray(text)
  if (extracted) {
    const result = parseJSON(extracted)
    if (Array.isArray(result) && result.length > 0 && (result[0] as any)?.file_path) {
      return result
    }
  }

  return undefined
}

function extractJsonArray(text: string): string | undefined {
  let lastArrayStr: string | undefined

  for (let searchFrom = 0; ; ) {
    const bracketStart = text.indexOf("[", searchFrom)
    if (bracketStart === -1) break

    let depth = 0
    let inString = false
    let escape = false
    let end = -1

    for (let i = bracketStart; i < text.length; i++) {
      const ch = text[i]
      if (escape) {
        escape = false
        continue
      }
      if (ch === "\\") {
        if (inString) escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue

      if (ch === "[") depth++
      else if (ch === "]") {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }

    if (end !== -1) {
      lastArrayStr = text.slice(bracketStart, end + 1)
      searchFrom = end + 1
    } else {
      searchFrom = bracketStart + 1
    }
  }

  return lastArrayStr
}

// ---------------------------------------------------------------------------
// JSON sanitizer / salvager
// ---------------------------------------------------------------------------

/** Escape raw control characters (newline, tab, …) inside JSON string literals. */
function sanitizeJsonStrings(text: string): string {
  let result = ""
  let inString = false
  let escape = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (escape) {
      result += ch
      escape = false
      continue
    }

    if (ch === "\\" && inString) {
      result += ch
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }

    if (inString) {
      const code = ch.charCodeAt(0)
      if (code < 0x20) {
        if (ch === "\n") {
          result += "\\n"
          continue
        }
        if (ch === "\r") {
          result += "\\r"
          continue
        }
        if (ch === "\t") {
          result += "\\t"
          continue
        }
        result += "\\u" + code.toString(16).padStart(4, "0")
        continue
      }
    }

    result += ch
  }

  return result
}

/** Salvage complete array entries when the last entry is broken. */
function stripLastIncompleteEntry(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith("[")) return undefined

  let depth = 0
  let inString = false
  let escape = false
  let lastCompleteObjectEnd = -1

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\" && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === "[" || ch === "{") depth++
    else if (ch === "]" || ch === "}") {
      depth--
      if (depth === 1 && ch === "}") lastCompleteObjectEnd = i
      if (depth === 0 && ch === "]") return trimmed.slice(0, i + 1)
    }
  }

  if (lastCompleteObjectEnd > 0) {
    return trimmed.slice(0, lastCompleteObjectEnd + 1) + "\n]"
  }

  return undefined
}

// ---------------------------------------------------------------------------
// parseJSON — multi-strategy tolerant parser
// ---------------------------------------------------------------------------

export function parseJSON(text: string): unknown | undefined {
  // Strategy 1: strict JSON
  try {
    return JSON.parse(text)
  } catch {
    // continue
  }

  // Strategy 2: JSON5 (comments / trailing commas / single quotes / unquoted keys)
  try {
    return JSON5.parse(text)
  } catch {
    // continue
  }

  // Strategy 3: trim surrounding prose + JSON5
  try {
    const trimmed = text.trim()
    const firstChar = trimmed[0]
    if (firstChar === "[" || firstChar === "{") {
      const extracted =
        firstChar === "["
          ? extractBalancedBrackets(trimmed, "[", "]")
          : extractBalancedBrackets(trimmed, "{", "}")
      if (extracted) return JSON5.parse(extracted)
    }
  } catch {
    // continue
  }

  // Strategy 4: repair truncation by closing open brackets
  try {
    return repairTruncatedJson(text)
  } catch {
    // continue
  }

  // Strategy 5: sanitize control chars, retry
  const sanitized = sanitizeJsonStrings(text)
  if (sanitized !== text) {
    try {
      return JSON.parse(sanitized)
    } catch {
      // continue
    }
    try {
      return JSON5.parse(sanitized)
    } catch {
      // continue
    }
    try {
      return repairTruncatedJson(sanitized)
    } catch {
      // continue
    }
  }

  // Strategy 6: strip broken final entry, parse remainder
  try {
    const stripped = stripLastIncompleteEntry(sanitized || text)
    if (stripped) return JSON.parse(stripped)
  } catch {
    // continue
  }

  return undefined
}

function extractBalancedBrackets(text: string, open: string, close: string): string | undefined {
  if (text[0] !== open) return undefined

  let depth = 0
  let inString = false
  let escape = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\") {
      if (inString) escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(0, i + 1)
    }
  }

  return undefined
}

function repairTruncatedJson(text: string): unknown | undefined {
  let trimmed = text.trim()
  trimmed = trimmed.replace(/,\s*$/, "")

  let inString = false
  let escape = false
  const stack: string[] = []

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\") {
      if (inString) escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === "[") stack.push("]")
    else if (ch === "{") stack.push("}")
    else if (ch === "]" || ch === "}") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop()
    }
  }

  if (inString) trimmed += '"'
  while (stack.length > 0) {
    trimmed += stack.pop()
  }

  return JSON.parse(trimmed)
}
