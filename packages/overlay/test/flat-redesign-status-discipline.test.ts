import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const COMPONENTS_ROOT = join(OVERLAY_ROOT, "src", "components")

function walkTsxFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry)
    const stat = statSync(file)
    if (stat.isDirectory()) out.push(...walkTsxFiles(file))
    else if (entry.endsWith(".tsx")) out.push(file)
  }
  return out
}

function relativeOverlayPath(file: string): string {
  return relative(OVERLAY_ROOT, file).replace(/\\/g, "/")
}

function grepComponents(regex: RegExp): string[] {
  const violations: string[] = []
  for (const file of walkTsxFiles(COMPONENTS_ROOT).sort()) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/)
    lines.forEach((line, index) => {
      if (regex.test(line)) violations.push(`${relativeOverlayPath(file)}:${index + 1}: ${line.trim()}`)
    })
  }
  return violations
}

function expectNoViolations(kind: string, violations: string[], guidance: string): void {
  if (violations.length > 0) {
    throw new Error(`${kind} violations:\n  ${violations.join("\n  ")}\n${guidance}`)
  }
  expect(violations).toHaveLength(0)
}

describe("flat-redesign status discipline", () => {
  it("components do not map status values through status class functions", () => {
    const violations = grepComponents(/function\s+.*[Ss]tatus.*Class\s*\(.*\)\s*:\s*string/)
    expectNoViolations(
      "status class function",
      violations,
      "Use data attributes and shared status mapping instead of modifier-class functions.",
    )
  })

  it("components do not contain unicode geometric status glyph literals", () => {
    const violations = grepComponents(/[✔◐✕○✓✗−]/u)
    expectNoViolations(
      "unicode geometric status glyph literal",
      violations,
      "Render status with the shared Icon component instead of unicode glyph literals.",
    )
  })
})
