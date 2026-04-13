import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { WorkflowRegistry } from "../../src/orchestrator/workflow"
import { createTaskAgentTools } from "../../src/task-agent/tools"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Phase 4 invariants:
//  - The "clarify" workflow step has been removed from STANDARD (and any
//    other built-in workflow that previously referenced it).
//  - The "clarify" tool has been removed from the task-agent tool set.
//  - No remaining workflow step references `clarify` via `after: [...]`.
describe("clarify removal (Phase 4)", () => {
  test("STANDARD workflow no longer contains a 'clarify' step", () => {
    const wf = WorkflowRegistry.resolveSync("standard")
    expect(wf).toBeDefined()
    const stepIDs = wf!.steps.map((s) => s.id)
    expect(stepIDs).not.toContain("clarify")
  })

  test("No workflow step lists 'clarify' in its after[] dependencies", () => {
    for (const id of Object.keys(WorkflowRegistry.builtIn)) {
      const wf = WorkflowRegistry.builtIn[id]
      for (const step of wf.steps) {
        expect(step.after ?? []).not.toContain("clarify")
      }
    }
  })

  test("task-agent tool set does not include 'clarify'", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { tools } = createTaskAgentTools({
          taskID: "tsk_phase4_test",
          agentSessionID: "ses_phase4_test",
          signal: new AbortController().signal,
          workflow: undefined,
          workflowState: undefined,
        })
        expect(Object.keys(tools)).not.toContain("clarify")
      },
    })
  })
})
