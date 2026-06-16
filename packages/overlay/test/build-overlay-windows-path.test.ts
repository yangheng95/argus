import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "../script/build-overlay.ts"), "utf8")

describe("build-overlay Windows PowerShell fallback", () => {
  test("passes the locked binary path as an argument and uses LiteralPath", () => {
    expect(source).toContain('Remove-Item -Force -LiteralPath $args[0] -ErrorAction SilentlyContinue')
    expect(source).toContain('" ${builtOverlay}`')
    expect(source).not.toContain("-Path '${builtOverlay}'")
    expect(source).not.toContain("Remove-Item -Force -Path")
  })
})
