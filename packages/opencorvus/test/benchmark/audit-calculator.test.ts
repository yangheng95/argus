import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

const AUDIT_CALCULATOR = path.resolve(import.meta.dir, "../../script/benchmark/audit-calculator.ts")

describe("audit calculator benchmark verdict", () => {
  test("required checks cannot pass as warn or skip", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain('status: "pass" | "fail"')
    expect(source).not.toContain('"warn"')
    expect(source).not.toContain('"skip"')
    expect(source).not.toContain("WARN")
    expect(source).not.toContain("SKIP")
    expect(source).not.toContain("best-effort")
    expect(source).not.toContain("warned")
    expect(source).not.toContain("skipped")
  })

  test("visual-only and test uncertainty are blocking failures", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain("rendered live expression evidence found")
    expect(source).toContain("source references found but no rendered live expression evidence")
    expect(source).not.toContain("code refs found")
    expect(source).not.toContain("visual-only check pending")
    expect(source).toContain('record("TESTS", "unit tests", r.code === 0 ? "pass" : "fail"')
    expect(source).toContain('record("TESTS", "unit tests", "fail", "no test script in package.json")')
  })
})
