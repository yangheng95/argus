import { describe, expect, test } from "bun:test"
import { IntegrityTestHooks } from "../../src/integrity/team-agent"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("integrity browser preview tool surface", () => {
  test("task-backed integrity reviews expose the explicit browser_preview tool", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        const kit = IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector: {},
          taskID: "tsk_integrity_preview",
          goals: [],
        })

        expect(Object.keys(kit.tools)).toContain("browser_preview")
        expect(Object.keys(kit.tools)).toContain("submit_integrity_consensus")
      },
    })
  })

  test("non-task integrity reviews do not expose a task-scoped preview tool", () => {
    const kit = IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector: {},
      goals: [],
    })

    expect(Object.keys(kit.tools)).not.toContain("browser_preview")
    expect(Object.keys(kit.tools)).toContain("submit_integrity_consensus")
  })
})
