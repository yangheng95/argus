import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join, relative } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
/* Single-source guard scope: only surfaces/. cascade/ + primitives/
 * are allowed to share class names with surfaces/ because they are
 * the base/override layering pattern (cascade declares palette
 * tokens, primitives declare default chrome, surfaces add scope-
 * specific overrides). Within surfaces/ itself a class root selector
 * must live in exactly one file — that's where rule 8 single-source
 * applies. */
const STYLE_ROOTS = [join(OVERLAY_ROOT, "src", "styles", "surfaces")]

type RootClassDefinition = {
  file: string
  line: number
  selector: string
}

function walkCssFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry)
    const stat = statSync(file)
    if (stat.isDirectory()) out.push(...walkCssFiles(file))
    else if (entry.endsWith(".css")) out.push(file)
  }
  return out
}

function relativeOverlayPath(file: string): string {
  return relative(OVERLAY_ROOT, file).replace(/\\/g, "/")
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => "\n".repeat(match.split(/\r?\n/).length - 1))
}

function lineAtOffset(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length
}

function splitSelectors(selectorText: string): string[] {
  return selectorText
    .split(",")
    .map((selector) => selector.trim())
    .filter(Boolean)
}

function rootClass(selector: string): string | null {
  const trimmed = selector.trim()
  const match = trimmed.match(/^\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)$/)
  return match?.[1] ?? null
}

function classDefinitions(file: string): RootClassDefinition[] {
  const stripped = withoutComments(readFileSync(file, "utf8"))
  const definitions: RootClassDefinition[] = []
  let cursor = 0

  while (cursor < stripped.length) {
    const open = stripped.indexOf("{", cursor)
    if (open < 0) break
    const selectorText = stripped.slice(cursor, open).trim()
    let depth = 1
    let close = open + 1
    while (close < stripped.length && depth > 0) {
      if (stripped[close] === "{") depth++
      else if (stripped[close] === "}") depth--
      close++
    }
    if (selectorText.startsWith("@")) {
      cursor = close
      continue
    }

    const selectors = splitSelectors(selectorText)
    if (selectors.length > 1 || basename(file) === "typography.css") {
      cursor = close
      continue
    }

    for (const selector of selectors) {
      const className = rootClass(selector)
      if (!className) continue
      definitions.push({
        file,
        line: lineAtOffset(stripped, open),
        selector,
      })
    }
    cursor = close
  }
  return definitions
}

describe("flat-redesign class uniqueness", () => {
  it("each root class selector is defined in only one css file", () => {
    const byClass = new Map<string, RootClassDefinition[]>()
    for (const file of STYLE_ROOTS.flatMap(walkCssFiles).sort()) {
      for (const definition of classDefinitions(file)) {
        const bucket = byClass.get(rootClass(definition.selector)!) ?? []
        bucket.push(definition)
        byClass.set(rootClass(definition.selector)!, bucket)
      }
    }

    const violations: string[] = []
    for (const [className, definitions] of [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const files = new Set(definitions.map((definition) => definition.file))
      if (files.size <= 1) continue
      violations.push(
        `.${className}:\n  ${definitions
          .map((definition) => `${relativeOverlayPath(definition.file)}:${definition.line}: ${definition.selector}`)
          .join("\n  ")}`,
      )
    }

    if (violations.length > 0) {
      throw new Error(
        `root class selector definitions must be single-source:\n  ${violations.join("\n  ")}\n` +
          "Move shared typography into cascade/typography.css multi-class lists or keep the class rooted in one stylesheet.",
      )
    }
    expect(violations).toHaveLength(0)
  })
})
