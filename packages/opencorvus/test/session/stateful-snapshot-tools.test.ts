import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Message } from "../../src/session/message"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

/**
 * Guard against silent drift: Message.STATEFUL_SNAPSHOT_TOOLS is a
 * string-keyed set used by toModelMessages to project older stateful
 * snapshot tool_results into "[superseded]" notes. If a tool is renamed
 * without updating the set, projection silently stops firing and token
 * usage regresses. These tests make that class of bug loud.
 */
describe("STATEFUL_SNAPSHOT_TOOLS registry consistency", () => {
  test("every name in STATEFUL_SNAPSHOT_TOOLS is a real orchestrator tool", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { tools } = createOrchestratorTools({
          taskID: "tsk_stateful_test",
          agentSessionID: "ses_stateful_test",
          signal: new AbortController().signal,
          workflow: undefined,
          workflowState: undefined,
        })
        const registered = new Set(Object.keys(tools))
        const missing: string[] = []
        for (const name of Message.STATEFUL_SNAPSHOT_TOOLS) {
          if (!registered.has(name)) missing.push(name)
        }
        expect(missing).toEqual([])
      },
    })
  })

  test("STATEFUL_SNAPSHOT_TOOLS is non-empty (regression guard)", () => {
    // If the set becomes empty, projection is a no-op and the token savings
    // this module exists for vanish silently. An empty set is almost
    // certainly a mistake — fail loudly.
    expect(Message.STATEFUL_SNAPSHOT_TOOLS.size).toBeGreaterThan(0)
  })
})
