import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const SURFACES_ROOT = join(OVERLAY_ROOT, "src", "styles", "surfaces")
const BREAKPOINTS = new Map([
  [520, "--ui-breakpoint-sm"],
  [760, "--ui-breakpoint-md"],
  [900, "--ui-breakpoint-lg"],
])

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

function withoutBlockCommentsExceptBreakpoint(text: string): string {
  return text.replace(/\/\*(?!\s*breakpoint:)[\s\S]*?\*\//g, (match) => "\n".repeat(match.split(/\r?\n/).length - 1))
}

function failWithViolations(kind: string, violations: string[], guidance: string): void {
  if (violations.length > 0) {
    throw new Error(`${kind} violations:\n  ${violations.join("\n  ")}\n${guidance}`)
  }
  expect(violations).toHaveLength(0)
}

describe("flat-redesign breakpoint coverage", () => {
  it("surface max-width media queries use the breakpoint token values and inline token comments", () => {
    const violations: string[] = []
    const media = /@media\s*\([^)]*max-width\s*:\s*(\d+)px[^)]*\)/i
    for (const file of walkCssFiles(SURFACES_ROOT).sort()) {
      const lines = withoutBlockCommentsExceptBreakpoint(readFileSync(file, "utf8")).split(/\r?\n/)
      lines.forEach((line, index) => {
        const match = line.match(media)
        if (!match) return
        const px = Number(match[1])
        const token = BREAKPOINTS.get(px)
        const loc = `${relativeOverlayPath(file)}:${index + 1}: ${line.trim()}`
        if (!token) {
          violations.push(`${loc} uses non-token breakpoint ${px}px`)
          return
        }
        if (!line.includes(`/* breakpoint: ${token} */`)) {
          violations.push(`${loc} missing /* breakpoint: ${token} */`)
        }
      })
    }

    failWithViolations(
      "breakpoint",
      violations,
      "Surface max-width px queries must map to --ui-breakpoint-{sm,md,lg} and cite the token inline.",
    )
  })
})
