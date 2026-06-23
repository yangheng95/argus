import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const INSPECTOR_CSS = path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "inspector.css")

function readText(p: string): string {
  return readFileSync(p, "utf8")
}

function stripCssComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "")
}

function extractRule(css: string, selector: string): string {
  const stripped = stripCssComments(css)
  for (const chunk of stripped.split("}")) {
    const openIdx = chunk.indexOf("{")
    if (openIdx < 0) continue
    const head = chunk.slice(0, openIdx).trim()
    if (!head) continue
    const selectors = head.split(",").map((item) => item.trim())
    if (selectors.includes(selector)) return chunk.slice(openIdx + 1).trim()
  }
  throw new Error(`missing CSS rule ${selector}`)
}

describe("Integrity panel token source", () => {
  const inspectorCss = readText(INSPECTOR_CSS)
  const strippedInspectorCss = stripCssComments(inspectorCss)

  test("Integrity styles do not reference undefined local token aliases", () => {
    expect(strippedInspectorCss).not.toContain("var(--border-muted)")
    expect(strippedInspectorCss).not.toContain("var(--radius-sm)")
    expect(strippedInspectorCss).not.toContain("var(--surface-muted)")
    expect(strippedInspectorCss).not.toContain("var(--oc-radius-sm)")
  })

  test("Integrity report chrome uses canonical overlay tokens", () => {
    const report = extractRule(inspectorCss, ".integrity__report")
    expect(report).toContain("border: var(--oc-border-width) solid color-mix(in srgb, var(--border) 72%, transparent)")
    expect(report).toContain("border-radius: var(--oc-radius-soft)")
    expect(report).toContain("background: color-mix(in srgb, var(--surface-inset) 88%, transparent)")
  })

  test("Integrity detail, reviewer, and manifest surfaces use canonical overlay tokens", () => {
    const detail = extractRule(inspectorCss, ".integrity__report-detail")
    expect(detail).toContain("border: var(--oc-border-width) solid color-mix(in srgb, var(--border) 72%, transparent)")
    expect(detail).toContain("border-radius: var(--oc-radius-soft)")
    expect(detail).toContain("background: color-mix(in srgb, var(--surface-inset) 88%, transparent)")

    const reviewer = extractRule(inspectorCss, ".integrity__reviewer")
    expect(reviewer).toContain(
      "border: var(--oc-border-width) solid color-mix(in srgb, var(--border) 72%, transparent)",
    )
    expect(reviewer).toContain("border-radius: var(--oc-radius-soft)")

    const manifestMeta = extractRule(inspectorCss, ".integrity__manifest-meta span")
    expect(manifestMeta).toContain("border-radius: var(--oc-radius-soft)")
    expect(manifestMeta).toContain("background: color-mix(in srgb, var(--surface-inset) 88%, transparent)")
  })
})
