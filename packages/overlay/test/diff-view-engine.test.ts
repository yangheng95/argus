import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const DIFF_VIEW_SOURCE = join(import.meta.dir, "../src/components/DiffView.tsx")

describe("DiffView diff engine", () => {
  test("delegates line diffing to jsdiff", () => {
    const source = readFileSync(DIFF_VIEW_SOURCE, "utf8")

    expect(source).toContain('import { diffLines } from "diff";')
    expect(source).toContain('diffLines(String(before || ""), String(after || ""))')
    expect(source).not.toContain("function diffMiddle")
    expect(source).not.toContain("Uint32Array")
    expect(source).not.toContain("left.length * right.length")
  })
})
