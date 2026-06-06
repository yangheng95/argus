import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../../../..")
const TUI_APP_SRC = path.join(ROOT, "packages/tui-app/src")

function sourceFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir)) {
    const current = path.join(dir, entry)
    const stat = statSync(current)
    if (stat.isDirectory()) {
      result.push(...sourceFiles(current))
    } else if (/\.[cm]?[tj]sx?$/.test(entry)) {
      result.push(current)
    }
  }
  return result
}

describe("tui-app package boundary", () => {
  test("does not import private opencorvus source aliases", () => {
    for (const file of sourceFiles(TUI_APP_SRC)) {
      const text = readFileSync(file, "utf8")
      expect(text).not.toContain('from "@/')
      expect(text).not.toContain("from '@/")
      expect(text).not.toContain('import("@/')
      expect(text).not.toContain("import('@/")
      expect(text).not.toContain("packages/opencorvus/src")
    }
  })
})
