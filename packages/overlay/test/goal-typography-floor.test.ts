import { expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const MIN_FONT_PX = 10

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

// Concatenate all surface + cascade + primitive CSS files (styles.css was
// dissolved 2026-05-04 into this decomposed architecture).
const STYLES_ROOT = resolve(import.meta.dir, "../src/styles")
const stylesCss = walkCss(STYLES_ROOT)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")

const tokenValues = new Map<string, string>()
for (const match of stylesCss.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  tokenValues.set(match[1], match[2].trim())
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let current = ""
  let depth = 0
  for (const ch of value) {
    if (ch === "(") depth += 1
    if (ch === ")") depth = Math.max(0, depth - 1)
    if (ch === "," && depth === 0) {
      parts.push(current.trim())
      current = ""
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function numericPx(value: string): number | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/)
  return match ? Number(match[1]) : null
}

function resolveFontFloor(value: string, seen = new Set<string>()): number {
  const directPx = numericPx(value)
  if (directPx !== null) return directPx

  const varMatch = value.trim().match(/^var\((--[\w-]+)\)$/)
  if (varMatch) {
    const token = varMatch[1]
    if (seen.has(token)) throw new Error(`Circular font token: ${token}`)
    const tokenValue = tokenValues.get(token)
    if (!tokenValue) throw new Error(`Missing token: ${token}`)
    const nextSeen = new Set(seen)
    nextSeen.add(token)
    return resolveFontFloor(tokenValue, nextSeen)
  }

  const clampMatch = value.trim().match(/^clamp\((.+)\)$/)
  if (clampMatch) {
    const [minValue] = splitTopLevel(clampMatch[1])
    return resolveFontFloor(minValue, seen)
  }

  const calcMatch = value.trim().match(/^calc\((.+)\)$/)
  if (calcMatch) {
    const expr = calcMatch[1].trim()
    const varOffsetMatch = expr.match(/^(var\(--[\w-]+\))\s*([+-])\s*(\d+(?:\.\d+)?)px$/)
    if (varOffsetMatch) {
      const base = resolveFontFloor(varOffsetMatch[1], seen)
      const delta = Number(varOffsetMatch[3])
      return varOffsetMatch[2] === "+" ? base + delta : base - delta
    }
    const scaledPxMatch = expr.match(/^(\d+(?:\.\d+)?)px\s*\*\s*var\(--ui-scale\)$/)
    if (scaledPxMatch) {
      return Number(scaledPxMatch[1])
    }
  }

  throw new Error(`Unsupported font-size expression: ${value}`)
}

function selectorFontSize(selector: string): string {
  const blockPattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "g")
  let fontSize: string | undefined
  for (const match of stylesCss.matchAll(blockPattern)) {
    const sizeMatch = match[1].match(/font-size\s*:\s*([^;]+);/)
    if (sizeMatch) fontSize = sizeMatch[1].trim()
  }
  if (!fontSize) throw new Error(`No font-size found for selector: ${selector}`)
  return fontSize
}

test("goal workflow typography never drops below 10px", () => {
  expect(resolveFontFloor(tokenValues.get("--ui-font-tiny")!)).toBeGreaterThanOrEqual(MIN_FONT_PX)
  expect(resolveFontFloor(tokenValues.get("--ui-font-small")!)).toBeGreaterThanOrEqual(MIN_FONT_PX)

  const selectors = [
    ".gwg-status-icon",
    ".gwg-priority-badge",
    ".gwg-revision",
    ".gwg-objective-label",
    ".gwg-objective-text",
    ".gwg-done-definition-label",
    ".gwg-done-definition-text",
    ".gwg-plan-node-brief",
    ".gwg-verdict",
    ".gwg-eval-summary",
    ".gwg-check-icon",
    ".gwg-check-evidence",
  ]

  for (const selector of selectors) {
    expect(resolveFontFloor(selectorFontSize(selector))).toBeGreaterThanOrEqual(MIN_FONT_PX)
  }
})
