import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "../")

function source(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

function expectStatusContract(tsx: string, className: string): void {
  const pattern = new RegExp(
    `<div class="${className}"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"`,
  )
  expect(tsx).toMatch(pattern)
}

describe("workflow generating status live regions", () => {
  test("RequirementsPanel generating indicator owns a live busy status", () => {
    const tsx = source("src/components/RequirementsPanel.tsx")
    expectStatusContract(tsx, "req-streaming-indicator")
    expect(tsx).toContain('t("workflow.requirements_generating")')
  })

  test("FrontendResearchPanel generating indicator owns a live busy status", () => {
    const tsx = source("src/components/FrontendResearchPanel.tsx")
    expectStatusContract(tsx, "req-streaming-indicator")
    expect(tsx).toContain('t("workflow.frontend_research_generating")')
  })

  test("ArchitectPanel generating indicator owns a live busy status", () => {
    const tsx = source("src/components/ArchitectPanel.tsx")
    expectStatusContract(tsx, "arch-generating")
    expect(tsx).toContain('t("workflow.architect_generating")')
  })
})
