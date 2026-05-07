import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const STYLE_ROOTS = [join(OVERLAY_ROOT, "src", "styles", "surfaces"), join(OVERLAY_ROOT, "src", "styles", "primitives")]

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
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => "\n".repeat(match.split("\n").length - 1))
}

function grepCss(regex: RegExp): string[] {
  const violations: string[] = []
  const files = STYLE_ROOTS.flatMap(walkCssFiles)
    .filter((file) => !/[\\/]cascade[\\/]/.test(file))
    .filter((file) => !/[\\/]tokens[\\/]/.test(file))
    .sort()

  for (const file of files) {
    const lines = withoutComments(readFileSync(file, "utf8")).split(/\r?\n/)
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

describe("flat-redesign color literal coverage — white/black", () => {
  it("surfaces and primitives contain no named white/black color literals", () => {
    const violations = grepCss(/(?<![\w-])(?:white|black)(?![\w-])/i)
    expectNoViolations(
      "named white/black color literal",
      violations,
      "Use cascade theme tokens instead of named white/black literals.",
    )
  })
})

describe("flat-redesign color literal coverage — hex", () => {
  it("surfaces and primitives contain no hex color literals", () => {
    const violations = grepCss(/#[0-9a-fA-F]{3,8}\b/)
    expectNoViolations("hex color literal", violations, "Use cascade theme tokens instead of hard-coded hex colors.")
  })
})

describe("flat-redesign color literal coverage — rgba", () => {
  it("surfaces and primitives contain no rgb()/rgba() color literals", () => {
    const violations = grepCss(/\brgba?\s*\(/i)
    expectNoViolations(
      "rgb()/rgba() color literal",
      violations,
      "Use cascade theme tokens or color-mix() over tokens instead of rgb()/rgba() literals.",
    )
  })
})
