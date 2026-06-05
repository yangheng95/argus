import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ZH = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")) as Record<string, unknown>
const EN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")) as Record<string, unknown>

const REQUIRED_KEYS = [
  "mission.open",
  "mission.title",
  "mission.back",
  "mission.back_title",
  "mission.new",
  "mission.new_title",
  "mission.runtime.disabled",
  "mission.runtime.unavailable",
  "mission.runtime.starting",
  "mission.runtime.running",
  "mission.runtime.stopped",
  "mission.runtime.error",
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
  "mission.launcher.title",
  "mission.launcher.discard",
  "mission.launcher.error",
  "mission.launcher.result_created",
  "mission.launcher.result_resumed",
  "mission.launcher.attachments_unsupported",
  "mission.channels.heading",
  "mission.channels.runtime_heading",
  "mission.channels.restart",
  "mission.channels.bindings_heading",
  "mission.error.channel_runtime_failed",
  "mission.error.channels_failed",
  "mission.error.restart_failed",
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
  const zhKeys = Object.keys(ZH).filter((k) => k.startsWith("mission.")).sort()
  const enKeys = Object.keys(EN).filter((k) => k.startsWith("mission.")).sort()
  expect(zhKeys).toEqual(enKeys)
})

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
