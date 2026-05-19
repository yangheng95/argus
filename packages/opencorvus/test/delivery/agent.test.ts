import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { DeliveryAgent } from "../../src/delivery/agent"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"
import { EngineProtocol } from "../../src/engine/protocol"

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

test("DeliveryAgent prompt is host-gate blind and budgets large auxiliary evidence", async () => {
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
          startup_verification: { attempted: false, success: false },
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
          acceptance_scenarios: [],
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
          diffs: Array.from({ length: 40 }, (_, i) => ({
            file: `src/file-${i}.ts`,
            before: "",
            after: huge,
            additions: 1,
            deletions: 0,
            status: "added" as const,
          })),
        },
        model: { providerID: "budget-test", modelID: "tiny-delivery" },
      })
    },
  })

  expect(capturedPrompt.length).toBeLessThan(30_000)
  // Fresh-eyes decoupling (specs/delivery-fresh-eyes-decoupling-2026-05-18.md):
  // the agent runs only after the host gate passed, so its prompt must carry
  // NO host-gate conclusions and NO burden-inverting / state-machine language.
  expect(capturedPrompt).not.toContain("# DeliveryEvidenceManifest Gate")
  expect(capturedPrompt).not.toContain("# Host Hard Gate Failures")
  expect(capturedPrompt).not.toContain("# Runtime Evidence Failures")
  expect(capturedPrompt).not.toContain("# Visual Metric Failures")
  expect(capturedPrompt).not.toContain("You must submit verdict='rejected'")
  expect(capturedPrompt).not.toContain("aligning your verdict with the gate")
  expect(capturedPrompt).not.toContain("unless you can prove the probe is invalid")
  // Exploration tooling is still offered, but without host-failure sections.
  expect(capturedPrompt).toContain("inspect_delivery_context")
  expect(capturedPrompt).not.toContain("host failures")
  expect(capturedPrompt).not.toContain("# Executor Reports")
  expect(capturedPrompt).not.toContain("# Code Diffs")
}, 30_000)

test("DeliveryAgent prompt is host-gate blind but carries ownership and changed files", async () => {
  await using tmp = await tmpdir({ git: true, config: { model: "test/mock" } })
  let capturedPrompt = ""
  let acceptedPayloadResult = ""
  spyOn(Provider, "getModel").mockResolvedValue(testDeliveryModel())

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        capturedPrompt = input.buildUserPrompt()
        const kit = input.toolKitFactory()
        acceptedPayloadResult = await kit.tools.submit_verdict.execute!(
          {
            verdict: "accepted",
            summary: "Accepted payload can be collected; service re-runs manifest before final arbitration.",
            deferred_checks: [],
            startup_verification: { attempted: true, success: true, command: "bun run dev" },
            frontend_check: { attempted: true, renders_correctly: true, notes: "preview rendered" },
            tool_call_evidence: [
              { tool: "run_command", passed: true, detail: "build checked" },
              { tool: "start_frontend_preview", passed: true, detail: "managed preview rendered" },
            ],
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
          acceptance_scenarios: [],
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
        model: { providerID: "test", modelID: "mock" },
      })
    },
  })

  // Fresh-eyes decoupling (specs/delivery-fresh-eyes-decoupling-2026-05-18.md):
  // the agent runs blind after the host gate passed — NO host-gate conclusions
  // in the prompt — but ownership and changed-file context are still present.
  expect(capturedPrompt).not.toContain("# DeliveryEvidenceManifest Gate")
  expect(capturedPrompt).not.toContain("# Host Hard Gate Failures")
  expect(capturedPrompt).not.toContain("finalGate.status=failed")
  expect(capturedPrompt).not.toContain("failedCheckIds=check:build")
  expect(capturedPrompt).toContain("owned_paths=src/App.tsx, package.json")
  expect(capturedPrompt).toContain("- src/App.tsx")
  expect(acceptedPayloadResult).toContain("verdict=accepted")
}, 30_000)

test("DeliveryAgent registers submit_verdict without same-session recovery", async () => {
  await using tmp = await tmpdir({ git: true, config: { model: "test/mock" } })
  let terminalToolName = ""
  let satisfiedBefore = true
  let satisfiedAfter = false
  let hasSameSessionRecovery = true
  spyOn(Provider, "getModel").mockResolvedValue(testDeliveryModel())

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        const kit = input.toolKitFactory()
        const collector = kit.getCollector()
        terminalToolName = input.terminalTool.toolName
        satisfiedBefore = input.terminalTool.isSatisfied(collector)
        hasSameSessionRecovery = "recovery" in input.terminalTool
        await kit.tools.submit_verdict.execute!(
          {
            verdict: "rejected",
            summary: "Host gate failed and requires rejection.",
            startup_verification: { attempted: false, success: false },
            frontend_check: { attempted: false },
            deferred_checks: [],
            tool_call_evidence: [{ tool: "DeliveryEvidenceManifest", passed: false, detail: "manifest gate failed" }],
            rejection_details: [{
              category: "test",
              error: "Required check failed.",
              suggestion: "Fix the required check.",
            }],
          },
          {} as any,
        )
        satisfiedAfter = input.terminalTool.isSatisfied(collector)
        return { collector, attempts: 1 }
      }

      await DeliveryAgent.verify({
        task: {
          id: "tsk_delivery_terminal_tool",
          title: "Terminal verdict",
          request: "Verify terminal verdict submission.",
        },
        goals: [],
        delivery: {
          summary: "No accepted delivery.",
          changedFiles: ["src/App.tsx"],
        },
        model: { providerID: "test", modelID: "mock" },
      })
    },
  })

  expect(terminalToolName).toBe("submit_verdict")
  expect(satisfiedBefore).toBe(false)
  expect(satisfiedAfter).toBe(true)
  expect(hasSameSessionRecovery).toBe(false)
}, 30_000)

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
          startup_verification: { attempted: false, success: false },
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
          acceptance_scenarios: [scenarioSpec()],
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
        model: { providerID: "test", modelID: "mock" },
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
  expect(toolNames).toContain("run_integrity_review")
  expect(toolNames).toContain("edit_file")
  expect(toolNames).toContain("write_file")
}, 30_000)

test("DeliveryAgent parses collector verdict before returning to the arbiter", async () => {
  await using tmp = await tmpdir({ git: true, config: { model: "test/mock" } })
  spyOn(Provider, "getModel").mockResolvedValue(testDeliveryModel())

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        const kit = input.toolKitFactory()
        const collector = kit.getCollector()
        collector.verdict = {
          verdict: "rejected",
          summary: "Delivery is missing required behavior.",
          tool_call_evidence: [{ tool: "read_file", passed: true, detail: "inspected delivery evidence" }],
          rejection_details: [{
            category: "quality",
            error: "Required behavior is not implemented in the delivered artifact.",
          }],
        }
        collector.finalized = true
        return { collector, attempts: 1 }
      }

      const verdict = await DeliveryAgent.verify({
        task: {
          id: "tsk_collector_parse",
          title: "Parse collector",
          request: "Verify the delivered artifact.",
        },
        goals: [],
        delivery: {
          summary: "Merged changes.",
          changedFiles: ["src/app.ts"],
        },
        model: { providerID: "test", modelID: "mock" },
      })

      expect(verdict.deferred_checks).toEqual([])
    },
  })
}, 30_000)

test("DeliveryAgent forwards reasoning deltas to the shared review stream", async () => {
  await using tmp = await tmpdir({ git: true, config: { model: "test/mock" } })
  const emitted: Array<{ type: string; payload: any }> = []
  spyOn(Provider, "getModel").mockResolvedValue(testDeliveryModel())
  spyOn(EngineProtocol, "emit").mockImplementation(async (event: any, payload: any) => {
    emitted.push({ type: event.type, payload })
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        const kit = input.toolKitFactory()
        await input.stream.onChunk({ chunk: { type: "reasoning-delta", text: "reviewing " } })
        await input.stream.onChunk({ chunk: { type: "reasoning-delta", text: "runtime" } })
        await input.stream.onFinish({} as never)
        const collector = kit.getCollector()
        collector.verdict = {
          verdict: "accepted",
          summary: "Accepted after review.",
          deferred_checks: [],
          tool_call_evidence: [{ tool: "run_command", passed: true, detail: "build passed" }],
        }
        collector.finalized = true
        return { collector, attempts: 1 }
      }

      await DeliveryAgent.verify({
        task: {
          id: "tsk_delivery_stream",
          title: "Stream review",
          request: "Verify stream forwarding.",
        },
        goals: [],
        delivery: {
          summary: "Merged changes.",
          changedFiles: ["src/app.ts"],
        },
        model: { providerID: "test", modelID: "mock" },
        reviewID: "delivery:tsk_delivery_stream:0",
      })
    },
  })

  expect(emitted).toEqual([
    {
      type: "review.stream.chunk",
      payload: {
        taskID: "tsk_delivery_stream",
        reviewID: "delivery:tsk_delivery_stream:0",
        phase: "delivery",
        kind: "reasoning",
        delta: "reviewing runtime",
        attempt: 1,
      },
    },
  ])
}, 30_000)

function scenarioSpec() {
  return {
    id: "acc-runtime",
    source_requirement_id: "REQ-runtime",
    goal_id: "gol_visual",
    title: "Runtime scenario",
    scenario: {
      given: ["the preview is open"],
      when: ["the user views the page"],
      then: ["the expected UI is visible"],
    },
    scorers: [{
      type: "llm_judge" as const,
      name: "runtime_behavior",
      criteria: "The runtime page satisfies the described scenario.",
    }],
    severity: "essential" as const,
  }
}

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
