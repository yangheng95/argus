import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { DeliveryAgent } from "../../src/delivery/agent"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
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

test("DeliveryAgent budgets large auxiliary evidence while preserving hard gates", async () => {
  await using tmp = await tmpdir({ git: true, config: { model: "test/mock" } })
  let capturedPrompt = ""
  const model = testDeliveryModel({ id: "tiny-delivery", providerID: "budget-test", context: 30_000 })
  spyOn(Provider, "getModel").mockResolvedValue(model)

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        capturedPrompt = input.buildUserPrompt()
        const kit = input.toolKitFactory()
        const collector = kit.getCollector()
        collector.verdict = {
          verdict: "rejected",
          summary: "Manifest gate failed.",
          startup_verification: { attempted: false },
          frontend_check: { attempted: false },
          deferred_checks: [],
          tool_call_evidence: [{ tool: "read_file", passed: true, detail: "inspected manifest evidence" }],
          rejection_details: [{
            category: "build",
            error: "Build failed",
            suggestion: "Fix the build failure.",
          }],
        }
        collector.finalized = true
        return { collector, attempts: 1 }
      }

      const huge = "x".repeat(8_000)
      await DeliveryAgent.verify({
        task: {
          id: "tsk_delivery_budget",
          title: "Budget prompt",
          request: "Verify a large delivery prompt.",
        },
        goals: [{
          id: "gol_budget",
          title: "Budget goal",
          description: huge,
          criteria: huge,
          priority: "blocking",
          acceptance_spec_count: 1,
          runtime_scenario_count: 0,
          check_selector: [],
          requirement_ids: [],
          depends_on: [],
          imports: [],
          exports: [],
          owned_paths: ["src/App.tsx"],
        }],
        delivery: {
          summary: "Merged many files.",
          changedFiles: Array.from({ length: 300 }, (_, i) => `src/file-${i}.ts`),
          manifestGate: {
            status: "failed",
            summary: "Delivery evidence gate failed 1 required check(s).",
            failedCheckIds: ["build#1"],
            failedCoverageIds: [],
            failedRuntimeFlowIds: [],
            failedReviewIds: [],
          },
          manifestFailureDetails: [{
            kind: "check",
            id: "build#1",
            name: "Build",
            status: "failed",
            command: "bun run build",
            exitCode: 1,
            evidence: "TypeScript failed in src/App.tsx",
          }],
          hostGateFailures: [{
            kind: "manifest",
            id: "artifact_manifest_budget",
            summary: "Delivery evidence gate failed 1 required check(s).",
            evidence: ["[check] build#1 Build status=failed exit=1 command=bun run build: TypeScript failed in src/App.tsx"],
          }],
          goalReports: Array.from({ length: 20 }, (_, i) => ({
            goalTitle: `Goal ${i}`,
            report: {
              implementation_approach: huge,
              design_decisions: [{ choice: huge, alternatives: [huge], reason: huge }],
              files_changed: Array.from({ length: 60 }, (_, j) => ({ path: `src/g${i}-${j}.ts`, summary: huge })),
              checks_run: Array.from({ length: 30 }, (_, j) => ({ name: `check ${j}`, command: `echo ${huge}`, exit_code: 0 })),
              blockers: [huge],
            },
          })),
          diffs: Array.from({ length: 40 }, (_, i) => ({ file: `src/file-${i}.ts`, diff: huge })),
        },
        model: { providerID: "budget-test", modelID: "tiny-delivery" },
      })
    },
  })

  expect(capturedPrompt.length).toBeLessThan(30_000)
  expect(capturedPrompt).toContain("finalGate.status=failed")
  expect(capturedPrompt).toContain("failedCheckIds=build#1")
  expect(capturedPrompt).toContain("TypeScript failed in src/App.tsx")
  expect(capturedPrompt).toContain("inspect_delivery_context")
  expect(capturedPrompt).not.toContain("# Executor Reports")
  expect(capturedPrompt).not.toContain("# Code Diffs")
})

test("DeliveryAgent prompt includes manifest gate, ownership, and executor changed files", async () => {
  await using tmp = await tmpdir({ git: true, config: { model: "test/mock" } })
  let capturedPrompt = ""
  let acceptedBlocked = ""
  spyOn(Provider, "getModel").mockResolvedValue(testDeliveryModel())

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
          hostGateFailures: [{
            kind: "manifest",
            id: "artifact_manifest_test",
            summary: "Delivery evidence gate failed 1 required check(s).",
            evidence: ["[check] check:build Build status=failed exit=1 command=bun run build: Cannot find module './missing'"],
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
  expect(capturedPrompt).toContain("# Host Hard Gate Failures")
  expect(capturedPrompt).toContain("finalGate.status=failed")
  expect(capturedPrompt).toContain("failedCheckIds=check:build")
  expect(capturedPrompt).toContain("Cannot find module './missing'")
  expect(capturedPrompt).toContain("owned_paths=src/App.tsx, package.json")
  expect(capturedPrompt).toContain("- src/App.tsx")
  expect(acceptedBlocked).toContain("host hard gate")
})

test("DeliveryAgent keeps visual images out of startup prompt and exposes exploration tools", async () => {
  await using tmp = await tmpdir({ git: true, config: { model: "test/mock" } })
  let capturedPrompt = ""
  let capturedParts: any[] = []
  let toolNames: string[] = []
  spyOn(Provider, "getModel").mockResolvedValue(testDeliveryModel())

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        capturedPrompt = input.buildUserPrompt()
        capturedParts = await input.buildUserParts()
        const kit = input.toolKitFactory()
        toolNames = Object.keys(kit.tools)
        const collector = kit.getCollector()
        collector.verdict = {
          verdict: "rejected",
          summary: "Visual review pending.",
          startup_verification: { attempted: false },
          frontend_check: { attempted: false },
          deferred_checks: [],
          tool_call_evidence: [{ tool: "compare_visual_artifacts", passed: false, detail: "visual pair not inspected in test" }],
          rejection_details: [{
            category: "visual",
            error: "Visual comparison was not executed in this mocked run.",
            suggestion: "Run visual comparison during real delivery.",
          }],
        }
        collector.finalized = true
        return { collector, attempts: 1 }
      }

      await DeliveryAgent.verify({
        task: {
          id: "tsk_visual_prompt",
          title: "Visual prompt",
          request: "Verify the UI against the screenshot.",
        },
        goals: [{
          id: "gol_visual",
          title: "Visual UI",
          description: "Match the screenshot.",
          criteria: "Rendered UI matches the reference.",
          priority: "blocking",
          acceptance_spec_count: 1,
          runtime_scenario_count: 1,
          check_selector: [],
          requirement_ids: [],
          depends_on: [],
          imports: [],
          exports: [],
          owned_paths: ["src/App.tsx"],
        }],
        delivery: {
          summary: "Merged UI changes.",
          changedFiles: ["src/App.tsx"],
        },
        attachments: [{
          sha: "renderedsha",
          url: "/attachment/project/rendered.png",
          mime: "image/png",
          size: 500_000,
          filename: "rendered.png",
          intent: "rendered_output",
        }, {
          sha: "referencesha",
          url: "/attachment/project/reference.png",
          mime: "image/png",
          size: 500_000,
          filename: "reference.png",
          intent: "visual_reference",
        }],
      })
    },
  })

  expect(capturedPrompt).toContain("# Visual Materials")
  expect(capturedPrompt).toContain("compare_visual_artifacts")
  expect(capturedPrompt).not.toContain("# Visual Comparison")
  expect(capturedPrompt).not.toContain("data:image")
  expect(capturedParts.every((part) => part.type === "text")).toBe(true)
  expect(toolNames).toContain("compare_visual_artifacts")
  expect(toolNames).toContain("inspect_delivery_context")
})

function testDeliveryModel(input?: { id?: string; providerID?: string; context?: number }) {
  const id = input?.id ?? "mock"
  const providerID = input?.providerID ?? "test"
  return Provider.Model.parse({
    id,
    providerID,
    api: { id, url: `mock://${providerID}`, npm: "@ai-sdk/openai-compatible" },
    name: "Test Delivery",
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: input?.context ?? 128_000, output: 4_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-05-02",
    variants: {},
  })
}
