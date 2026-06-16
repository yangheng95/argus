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

  test("GUI interaction requirements cannot pass from source string references", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain("const CalculatorAuditContract")
    expect(source).toContain('historyPanel: "[data-testid=history]"')
    expect(source).toContain('historyItem: "[data-testid=history-item]"')
    expect(source).toContain('historyClear: "[data-testid=history-clear]"')
    expect(source).toContain('keyOne: "[data-testid=key-1]"')
    expect(source).toContain('themeToggle: "[data-testid=theme-toggle]"')
    expect(source).not.toContain("const histRefs")
    expect(source).not.toContain("const pressedFeedback")
    expect(source).not.toContain("const themeRefs")
    expect(source).not.toContain("fallback: largest text block")
    expect(source).toContain("historyBeforeReload.panelVisible && historyBeforeReload.count > 0")
    expect(source).toContain("historyBeforeReload.storageEntryCount > 0 && historyAfterReload.count > 0")
    expect(source).toContain("pressedButtonBox && pressedBefore && pressedDuring && pressedChanged")
    expect(source).toContain("themeBefore.toggleVisible && themeAfter.toggleVisible && !themeToggleError && themeChanged")
    expect(source).toContain("themeAfter.storageEntryCount > 0")
  })

  test("pure frontend audit rejects localhost backend references", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain('"backend or external API source reference found"')
    expect(source).toContain('!reactsHasBackend ? "pass" : "fail"')
    expect(source).not.toContain('!reactsHasBackend || /https?:\\/\\/(localhost|127\\.0\\.0\\.1)/.test(codeBundle)')
  })
})
