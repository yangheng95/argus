// Regression for executor-selector panel restructure (2026-05-11):
//
// User intent: "Opencorvus 的模型永远显示，外部执行器则是可选显示的".
//   1. The OpenCorvus model picker section is always rendered inside the
//      menu — clicking a row writes appStore.config.model via patchConfig.
//   2. The external-executor section is collapsed by default; users opt in
//      by clicking the section toggle.
//
// Source-level grep: Bun's JSX runtime can't render Solid, so we verify
// the contract on the .tsx source itself plus i18n key presence.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "components", "ExecutorSelector.tsx"),
  "utf8",
)

describe("ExecutorSelector menu layout — OpenCorvus always shown, external optional", () => {
  test("OpenCorvus model section is rendered unconditionally inside the open menu", () => {
    expect(SRC).toMatch(/class="executor-menu-project"/)
    expect(SRC).toMatch(/executor\.opencorvus_section_label/)
    // The project section is not wrapped in a Show that hides it when no
    // models exist — instead we render a localized empty-state fallback.
    expect(SRC).toMatch(/executor\.opencorvus_no_providers/)
  })

  test("OpenCorvus picker writes via patchConfig (same source of truth as AgentModelsPanel)", () => {
    expect(SRC).toMatch(/import \{ patchConfig \} from "\.\.\/services\/config"/)
    expect(SRC).toMatch(/patchConfig\(\{ model: value \? value : null \}\)/)
  })

  test("External executor section starts collapsed by default", () => {
    expect(SRC).toMatch(/const \[externalOpen, setExternalOpen\] = createSignal\(false\)/)
    expect(SRC).toMatch(/class="executor-menu-external"/)
    expect(SRC).toMatch(/<Show when=\{externalOpen\(\)\}>/)
  })

  test("External section header carries a toggle button with current-selection summary", () => {
    expect(SRC).toMatch(/class="executor-menu-section-toggle"/)
    expect(SRC).toMatch(/aria-expanded=\{externalOpen\(\) \? "true" : "false"\}/)
    expect(SRC).toMatch(/externalSelectionLabel/)
    expect(SRC).toMatch(/executor\.external_section_label/)
    expect(SRC).toMatch(/executor\.external_disabled/)
  })

  test("Project model picker reuses model row classes for visual continuity", () => {
    // Same row primitive as executor model rows so styling, hover, active
    // states stay in one source — no parallel implementation.
    const projectSection = SRC.split('class="executor-menu-project"')[1] ?? ""
    expect(projectSection).toContain('class="executor-menu-model"')
    expect(projectSection).toContain("executor-menu-model-provider")
    expect(projectSection).toContain("executor-menu-model-name")
  })
})

describe("i18n keys for the panel restructure exist in both locales", () => {
  const EN = JSON.parse(
    readFileSync(path.resolve(import.meta.dir, "..", "src", "i18n", "en-US.json"), "utf8"),
  )
  const ZH = JSON.parse(
    readFileSync(path.resolve(import.meta.dir, "..", "src", "i18n", "zh-CN.json"), "utf8"),
  )
  for (const key of [
    "executor.opencorvus_section_label",
    "executor.opencorvus_no_providers",
    "executor.external_section_label",
    "executor.external_disabled",
  ]) {
    test(`${key} present in en-US.json`, () => {
      expect(typeof EN[key]).toBe("string")
      expect((EN[key] as string).length).toBeGreaterThan(0)
    })
    test(`${key} present in zh-CN.json`, () => {
      expect(typeof ZH[key]).toBe("string")
      expect((ZH[key] as string).length).toBeGreaterThan(0)
    })
  }
})
