import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const TITLEBAR_SOURCE = readFileSync(join(import.meta.dir, "../src/components/titlebar/TitlebarMenubar.tsx"), "utf8")
const GENERAL_PANEL_SOURCE = readFileSync(join(import.meta.dir, "../src/components/settings/GeneralPanel.tsx"), "utf8")
const EN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8"))
const ZH = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8"))

// Pins the live-update contract for the compaction.threshold slider on
// the titlebar Run menu. Regression target: if anyone removes the
// patchConfig wiring or moves the control off the Run menu without a
// replacement, the operator loses a top-level way to retune compaction
// without restarting the server.

test("Run-menu compaction threshold slider routes through patchConfig", () => {
  expect(TITLEBAR_SOURCE).toContain("titlebar.compaction_threshold")
  expect(TITLEBAR_SOURCE).toContain("titlebar.compaction_threshold_hint")
  expect(TITLEBAR_SOURCE).toContain("handlePatchCompactionThreshold")
  expect(TITLEBAR_SOURCE).toContain("patchConfig({ compaction: { threshold:")
  expect(TITLEBAR_SOURCE).toContain("compactionThresholdPercent")
  expect(TITLEBAR_SOURCE).toContain("data-testid={`titlebar-menu-${menu.id}`}")
})

test("Run-menu range values render beside the slider, not under the label", () => {
  expect(TITLEBAR_SOURCE).toContain('class="titlebar-menubar-range-control"')
  expect(TITLEBAR_SOURCE).toContain('class="titlebar-menubar-range-value"')
  expect(TITLEBAR_SOURCE).toContain('class="titlebar-menubar-item-meta">{props.description}</span>')
})

test("Run-menu proposed-task confirmation toggle routes through patchConfig", () => {
  expect(TITLEBAR_SOURCE).toContain("titlebar.confirm_proposed_tasks")
  expect(TITLEBAR_SOURCE).toContain("handlePatchProposedTaskConfirmation")
  expect(TITLEBAR_SOURCE).toContain("confirm_proposed_tasks: enabled")
  expect(TITLEBAR_SOURCE).toContain('data-testid="titlebar-confirm-proposed-tasks"')
})

test("GeneralPanel no longer owns the compaction threshold control", () => {
  expect(GENERAL_PANEL_SOURCE).not.toContain("compaction_threshold")
  expect(GENERAL_PANEL_SOURCE).not.toContain("compaction: { threshold:")
})

test("compaction threshold i18n key exists in both locales (titlebar-scoped)", () => {
  expect(typeof EN["titlebar.compaction_threshold"]).toBe("string")
  expect(typeof EN["titlebar.compaction_threshold_hint"]).toBe("string")
  expect(typeof ZH["titlebar.compaction_threshold"]).toBe("string")
  expect(typeof ZH["titlebar.compaction_threshold_hint"]).toBe("string")
  expect(EN["titlebar.compaction_threshold"]).not.toBe("")
  expect(EN["titlebar.compaction_threshold_hint"]).not.toBe("")
  expect(ZH["titlebar.compaction_threshold"]).not.toBe("")
  expect(ZH["titlebar.compaction_threshold_hint"]).not.toBe("")
  // legacy GeneralPanel keys must be gone (rule 8: single source for the label)
  expect(EN["settings.compaction_threshold_label"]).toBeUndefined()
  expect(ZH["settings.compaction_threshold_label"]).toBeUndefined()
})

test("proposed-task confirmation i18n keys exist in both locales", () => {
  expect(typeof EN["titlebar.confirm_proposed_tasks"]).toBe("string")
  expect(typeof ZH["titlebar.confirm_proposed_tasks"]).toBe("string")
  expect(typeof EN["titlebar.confirm_proposed_tasks_hint"]).toBe("string")
  expect(typeof ZH["titlebar.confirm_proposed_tasks_hint"]).toBe("string")
  expect(EN["titlebar.confirm_proposed_tasks"]).not.toBe("")
  expect(ZH["titlebar.confirm_proposed_tasks"]).not.toBe("")
})
