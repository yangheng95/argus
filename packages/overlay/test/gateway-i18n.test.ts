import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ZH = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")) as Record<string, unknown>
const EN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")) as Record<string, unknown>

const REQUIRED_KEYS = [
  "gateway.open",
  "gateway.title",
  "gateway.subtitle",
  // gateway.back was the in-page "Back to Panel" affordance. The Gateway
  // toggle now lives in the titlebar and toggles the page mode in place,
  // so there is no separate back button to translate.
  "gateway.refresh",
  "gateway.new_requirement",
  "gateway.workspace_label",
  "gateway.health_label",
  "gateway.health.healthy",
  "gateway.health.error",
  "gateway.runtime_label",
  "gateway.runtime.disabled",
  "gateway.runtime.unavailable",
  "gateway.runtime.starting",
  "gateway.runtime.running",
  "gateway.runtime.stopped",
  "gateway.runtime.error",
  "gateway.counts.active",
  "gateway.counts.queued",
  "gateway.counts.waiting",
  "gateway.counts.failed",
  "gateway.counts.completed",
  "gateway.counts.cancelled",
  "gateway.ledger.title",
  "gateway.ledger.search_placeholder",
  "gateway.ledger.empty",
  "gateway.ledger.empty_filtered",
  "gateway.ledger.filter.all",
  "gateway.ledger.filter.active",
  "gateway.ledger.filter.queued",
  "gateway.ledger.filter.waiting",
  "gateway.ledger.filter.failed",
  "gateway.ledger.filter.completed",
  "gateway.ledger.filter.cancelled",
  "gateway.ledger.action.move_up",
  "gateway.ledger.action.move_down",
  "gateway.workbench.no_selection_title",
  "gateway.workbench.no_selection_body",
  "gateway.workbench.actions.cancel",
  "gateway.workbench.actions.retry",
  "gateway.workbench.actions.replan",
  "gateway.workbench.actions.open_in_panel",
  "gateway.workbench.message_send",
  "gateway.master.title",
  "gateway.master.placeholder",
  "gateway.master.start",
  "gateway.master.resume",
  "gateway.master.discard",
  "gateway.master.mission_id_label",
  "gateway.master.submitting",
  "gateway.master.error",
  "gateway.master.result_created",
  "gateway.master.result_resumed",
  "gateway.channels.heading",
  "gateway.channels.runtime_heading",
  "gateway.channels.restart",
  "gateway.channels.bindings_heading",
  "gateway.error.stats_failed",
  "gateway.error.channel_runtime_failed",
  "gateway.error.channels_failed",
  "gateway.error.restart_failed",
] as const

for (const key of REQUIRED_KEYS) {
  test(`zh-CN locale defines ${key}`, () => {
    expect(ZH[key]).toBeDefined()
    expect(typeof ZH[key]).toBe("string")
    expect((ZH[key] as string).length).toBeGreaterThan(0)
  })
  test(`en-US locale defines ${key}`, () => {
    expect(EN[key]).toBeDefined()
    expect(typeof EN[key]).toBe("string")
    expect((EN[key] as string).length).toBeGreaterThan(0)
  })
}

test("zh-CN and en-US gateway.* coverage matches", () => {
  const zhKeys = Object.keys(ZH).filter((k) => k.startsWith("gateway.")).sort()
  const enKeys = Object.keys(EN).filter((k) => k.startsWith("gateway.")).sort()
  expect(zhKeys).toEqual(enKeys)
})
