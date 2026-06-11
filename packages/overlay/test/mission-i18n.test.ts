import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ZH = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")) as Record<string, unknown>
const EN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")) as Record<string, unknown>

const REQUIRED_KEYS = [
  "activity.tooltip.mission",
  "mission.title",
  "mission.new",
  "mission.new_title",
  "mission.ledger.title",
  "mission.ledger.search_placeholder",
  "mission.ledger.search_clear",
  "mission.ledger.empty",
  "mission.ledger.empty_filtered",
  "mission.ledger.updated_unknown",
  "mission.ledger.error_load_failed",
  "mission.ledger.error_retry",
  "mission.ledger.abort_title",
  "mission.ledger.delete_title",
  "mission.ledger.rename_title",
  "mission.ledger.rename_placeholder",
  "mission.ledger.tasks_label",
  "mission.workbench.error_action_failed",
  "mission.launcher.title",
  "mission.launcher.discard_title",
  "mission.launcher.error",
  "mission.launcher.result_created",
  "mission.launcher.result_resumed",
  "mission.launcher.attachments_unsupported",
  "mission.error.action.abort",
  "mission.error.action.delete",
  "mission.error.action.mission",
  "mission.error.action.rename",
  "mission.error.class.AbortError",
  "mission.error.class.DirectoryRequiredError",
  "mission.error.class.HTTPException",
  "mission.error.class.InvalidDirectoryError",
  "mission.error.class.TypeError",
  "mission.error.class.WorktreeNotGitError",
] as const

const RETIRED_KEYS = [
  "mission.open",
  "mission.open_title",
  "mission.back",
  "mission.back_title",
  "mission.refresh_title",
  "mission.tasks.stats_heading",
  "mission.tasks.total",
  "mission.tasks.queued",
  "mission.tasks.active",
  "mission.tasks.completed",
  "mission.tasks.failed",
  "mission.tasks.cancelled",
  "mission.channels.heading",
  "mission.channels.empty",
  "mission.channels.runtime_heading",
  "mission.channels.restart",
  "mission.error.channel_runtime_failed",
  "mission.error.channels_failed",
  "mission.error.restart_failed",
  "mission.launcher.discard",
  "mission.launcher.conversation_title",
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

test("zh-CN and en-US mission.* coverage matches", () => {
  const zhKeys = Object.keys(ZH)
    .filter((k) => k.startsWith("mission."))
    .sort()
  const enKeys = Object.keys(EN)
    .filter((k) => k.startsWith("mission."))
    .sort()
  expect(zhKeys).toEqual(enKeys)
})

for (const key of RETIRED_KEYS) {
  test(`retired Mission panel key ${key} is absent`, () => {
    expect(ZH[key]).toBeUndefined()
    expect(EN[key]).toBeUndefined()
  })
}

test("no legacy gateway.* product control keys leak through", () => {
  // The Gateway operator page was renamed to Mission; only infra gateway
  // concepts (provider, the kept gateway/stats endpoint URL) survive, none
  // of which are i18n keys. There must be NO `gateway.*` / `gateway.master.*`
  // keys left in either locale.
  for (const map of [ZH, EN]) {
    const stragglers = Object.keys(map).filter((k) => k.startsWith("gateway."))
    expect(stragglers).toEqual([])
  }
})

test("mission delete action label does not use task wording", () => {
  expect(EN["mission.error.action.delete"]).toBe("Delete mission")
  expect(ZH["mission.error.action.delete"]).toBe("删除 Mission")
})

test("mission select action label is localized", () => {
  expect(EN["mission.error.action.mission"]).toBe("Open mission")
  expect(ZH["mission.error.action.mission"]).toBe("打开 Mission")
})
