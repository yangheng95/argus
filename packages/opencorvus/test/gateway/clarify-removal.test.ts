import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { WorkflowRegistry } from "../../src/engine/workflow"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Phase 4 invariants:
//  - The "clarify" workflow step has been removed from STANDARD (and any
//    other built-in workflow that previously referenced it).
//  - The "clarify" tool has been removed from the orchestrator tool set.
//  - No remaining workflow step references `clarify` via `after: [...]`.
describe("clarify removal (Phase 4)", () => {
  test("no built-in workflow contains a step with id 'clarify'", () => {
    // audit-2026-04-29 W2-V27 — pre-fix this asserted on
    // resolveSync("standard"), but the "standard" workflow ID was
    // renamed/replaced at some point (current builtIns are only
    // "direct" + "pipeline" per workflow.ts:249). The test became
    // a silent failure: `wf` is undefined, the step-IDs check
    // never runs. The phase-4 invariant ("no step is NAMED
    // clarify") is universal across all workflows; iterate every
    // built-in instead of pinning to a single deprecated name.
    const ids = Object.keys(WorkflowRegistry.builtIn)
    expect(ids.length).toBeGreaterThan(0) // sanity — registry must not be empty
    for (const id of ids) {
      const wf = WorkflowRegistry.builtIn[id]
      const stepIDs = wf.steps.map((s) => s.id)
      expect(stepIDs).not.toContain("clarify")
    }
  })

  test("No workflow step lists 'clarify' in its after[] dependencies", () => {
    for (const id of Object.keys(WorkflowRegistry.builtIn)) {
      const wf = WorkflowRegistry.builtIn[id]
      for (const step of wf.steps) {
        expect(step.after ?? []).not.toContain("clarify")
      }
    }
  })

  test("orchestrator tool set does not include 'clarify'", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { tools } = createOrchestratorTools({
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
