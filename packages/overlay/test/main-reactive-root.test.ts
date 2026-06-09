import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SOURCE = readFileSync(path.resolve(import.meta.dir, "..", "src", "main.tsx"), "utf8")

describe("main reactive controllers", () => {
  test("follow-up effect lives inside a managed root", () => {
    const managedRoot =
      /disposers\.push\(\s*createRoot\(\(dispose\) => \{[\s\S]*const busyNow = !!messageStore\.chatRequest \|\| isTaskInterruptable\(\)[\s\S]*return dispose[\s\S]*\}\),\s*\)/m
    expect(SOURCE).toMatch(managedRoot)
  })
})
