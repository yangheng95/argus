import { describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { IntegrityTestHooks } from "../../src/integrity/team-agent"
import { INTEGRITY_PREVIEW_TOOL_IDS, INTEGRITY_PREVIEW_TOOL_INFOS } from "../../src/integrity/static-tools"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

describe("integrity browser preview tool surface", () => {
  test("registry whitelist and runtime preview tools use the same definitions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("integrity")
        expect(agent).toBeDefined()
        expect(agent?.tools?.include).toEqual([...INTEGRITY_PREVIEW_TOOL_IDS])

        const registryTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, agent)
        expect(registryTools.map((item) => item.id).sort()).toEqual([...INTEGRITY_PREVIEW_TOOL_IDS].sort())

        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector: {},
          taskID: "tsk_integrity_preview_consistency",
          goals: [],
        })

        for (const info of INTEGRITY_PREVIEW_TOOL_INFOS) {
          const initialized = await info.init()
          const runtimeTool = kit.tools[info.id] as unknown as {
            description?: string
            inputSchema?: unknown
            execute?: (args: unknown, options?: unknown) => Promise<unknown>
          }
          expect(runtimeTool.description).toBe(initialized.description)
          expect(runtimeTool.inputSchema).toBe(initialized.parameters)
        }
      },
    })
  }, 30_000)

  test("task-backed integrity reviews expose the preview repair toolchain", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector: {},
          taskID: "tsk_integrity_preview",
          goals: [],
        })

        for (const toolID of INTEGRITY_PREVIEW_TOOL_IDS) {
          expect(Object.keys(kit.tools)).toContain(toolID)
        }
        expect(Object.keys(kit.tools)).toContain("submit_integrity_consensus")
      },
    })
  })

  test("non-task integrity reviews do not expose task-scoped preview tools", async () => {
    const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector: {},
      goals: [],
    })

    for (const toolID of INTEGRITY_PREVIEW_TOOL_IDS) {
      expect(Object.keys(kit.tools)).not.toContain(toolID)
    }
    expect(Object.keys(kit.tools)).toContain("submit_integrity_consensus")
  })

  test("preview runtime tools require persisted session execution identity", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector: {},
          taskID: "tsk_integrity_preview_identity",
          goals: [],
        })
        const browserPreview = kit.tools.browser_preview as unknown as {
          execute: (args: unknown, options?: unknown) => Promise<unknown>
        }
        await expect(browserPreview.execute({ command: "npm run dev" }, {})).rejects.toThrow(
          "missing real tool execution identity",
        )
      },
    })
  })
})
