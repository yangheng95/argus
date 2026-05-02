import { afterEach, expect, mock, test } from "bun:test"
import { DeliveryAgent } from "../../src/delivery/agent"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  runAgentSessionWithRetry: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSessionWithRetry mock not configured")
    return runnerImpl(input)
  },
}))

afterEach(async () => {
  runnerImpl = undefined
  mock.restore()
  await Instance.disposeAll()
})

test("DeliveryAgent prompt includes manifest gate, ownership, and executor changed files", async () => {
  await using tmp = await tmpdir({ git: true, config: { model: "test/mock" } })
  let capturedPrompt = ""
  let acceptedBlocked = ""

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        capturedPrompt = input.buildUserPrompt()
        const kit = input.toolKitFactory()
        acceptedBlocked = await kit.tools.submit_verdict.execute!(
          {
            verdict: "accepted",
            summary: "Should be blocked by the failed manifest gate.",
            deferred_checks: [],
            tool_call_evidence: [{ tool: "run_command", passed: true, detail: "build checked" }],
          },
          {} as any,
        )
        const collector = kit.getCollector()
        collector.verdict = {
          verdict: "rejected",
          summary: "Manifest gate failed and the UI goal owns the broken entrypoint.",
          startup_verification: { attempted: true, success: false, output: "build failed" },
          frontend_check: { attempted: false },
          deferred_checks: [],
          tool_call_evidence: [{ tool: "read_file", passed: true, detail: "inspected src/App.tsx" }],
          rejection_details: [{
            goal_id: "gol_ui",
            category: "build",
            error: "src/App.tsx import path breaks the integrated build",
            suggestion: "Fix the import path owned by the UI goal.",
          }],
        }
        collector.finalized = true
        return { collector, attempts: 1 }
      }

      await DeliveryAgent.verify({
        task: {
          id: "tsk_delivery_agent",
          title: "Fix UI build",
          request: "Make the app build.",
        },
        goals: [{
          id: "gol_ui",
          title: "UI shell",
          description: "Implement the UI shell.",
          criteria: "Build passes.",
          priority: "blocking",
          acceptance_spec_count: 1,
          runtime_scenario_count: 0,
          check_selector: [],
          requirement_ids: [],
          depends_on: [],
          imports: [],
          exports: [],
          owned_paths: ["src/App.tsx", "package.json"],
        }],
        delivery: {
          summary: "Merged UI changes.",
          changedFiles: ["src/App.tsx", "package.json"],
          manifestGate: {
            status: "failed",
            summary: "Delivery evidence gate failed 1 required check(s).",
            failedCheckIds: ["check:build"],
            failedCoverageIds: [],
            failedRuntimeFlowIds: [],
            failedReviewIds: [],
          },
          manifestFailureDetails: [{
            kind: "check",
            id: "check:build",
            name: "Build",
            status: "failed",
            command: "bun run build",
            exitCode: 1,
            evidence: "Cannot find module './missing'",
          }],
          goalReports: [{
            goalTitle: "UI shell",
            report: {
              implementation_approach: "Updated the UI entrypoint.",
              design_decisions: [],
              files_changed: [{ path: "src/App.tsx", summary: "Changed the app shell import." }],
              checks_run: [],
              blockers: [],
            },
          }],
        },
      })
    },
  })

  expect(capturedPrompt).toContain("# DeliveryEvidenceManifest Gate")
  expect(capturedPrompt).toContain("finalGate.status=failed")
  expect(capturedPrompt).toContain("failedCheckIds=check:build")
  expect(capturedPrompt).toContain("Cannot find module './missing'")
  expect(capturedPrompt).toContain("Owned paths: src/App.tsx, package.json")
  expect(capturedPrompt).toContain("`src/App.tsx`")
  expect(acceptedBlocked).toContain("finalGate.status=failed")
})
