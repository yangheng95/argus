import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = readFileSync(join(import.meta.dir, "..", "src", "utils", "dev-error.ts"), "utf8")

function devErrorCss(): string {
  const match = SOURCE.match(/const DEV_ERROR_CSS = `([\s\S]*)`\s*$/)
  if (!match) throw new Error("DEV_ERROR_CSS template not found")
  return match[1]
}

test("dev error overlay injected CSS uses theme tokens instead of raw colors", () => {
  const css = devErrorCss()
  expect(css).toContain("var(--menu-panel-bg)")
  expect(css).toContain("var(--bad)")
  expect(css).toContain("var(--warn)")
  expect(css).toContain("var(--text)")
  expect(css).toContain("var(--text-muted)")

  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  expect(css).not.toMatch(/\brgba?\s*\(/i)
  expect(css).not.toMatch(/\bhsla?\s*\(/i)
  expect(css).not.toMatch(/(?<![\w-])(?:black|white)(?![\w-])/i)
})
