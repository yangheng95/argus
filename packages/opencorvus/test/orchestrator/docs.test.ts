import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { Glob } from "../../src/util/glob"
import { DeliveryService } from "../../src/orchestrator/delivery"
import { OrchestratorService } from "../../src/orchestrator/service"
import { CheckRunner } from "../../src/evaluator/service"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Identifier } from "../../src/id/id"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { SpecService } from "../../src/spec/service"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function stubPipeline() {
  spyOn(SpecService, "initial").mockResolvedValue({
    summary: "Task spec",
    content: "# Scope\n\nUpdate src/app.ts to apply the requested change.",
    scope: "Update src/app.ts",
    requirements: [
      {
        id: "req_build",
        title: "Keep build green",
        description: "Build check passes after updating src/app.ts.",
        priority: "blocking",
        acceptance: ["Build check passes after updating src/app.ts."],
        evidence_refs: ["src/app.ts"],
      },
    ],
    assumptions: [],
    risks: [],
    evidence_sources: ["src/app.ts"],
    unresolved_questions: [],
  } as any)
  spyOn(PlannerService, "initial").mockResolvedValue({
    summary: "Compiled plan",
    prompt: "Implement the requested change in src/app.ts and verify the build.",
    metadata: {
      strategy: "initial",
      steps: [
        "Inspect src/app.ts and apply the requested change.",
        "Run the build check and confirm it passes.",
      ],
      waves: [
        {
          title: "Wave 1",
          objective: "Keep build green",
          goal_indices: [0],
          owned_paths: ["src/app.ts"],
        },
      ],
      milestones: [
        {
          title: "Wave 1",
          description: "Keep build green",
          goal_indices: [0],
        },
      ],
      spec: {
        summary: "Task spec",
      },
      spec_analysis: {
        expanded_spec: "# PRD\n\n- Modify `src/app.ts`\n- Preserve the existing module shape\n- Verify the build check passes",
        ambiguities: [],
        questions: [],
        goals: [
          {
            description: "Keep build green",
            criteria: "Build check passes after updating src/app.ts.",
            priority: "blocking",
          },
        ],
        risk_areas: ["Avoid changing unrelated modules."],
        assumptions: [],
        confidence: 0.9,
      },
    },
  } as any)
  spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
    sessionID,
    queueTaskID: Identifier.ascending("task"),
  }))
  spyOn(OpencodeExecutor, "status").mockResolvedValue({
    queueTaskID: Identifier.ascending("task"),
    status: "completed",
    error: null,
  })
  spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
    summary: "Updated src/app.ts and verified the build.",
    diffs: [
      {
        file: "src/app.ts",
        before: "export const value = 1\n",
        after: "export const value = 2\n",
        additions: 1,
        deletions: 1,
      },
    ],
  })
  spyOn(CheckRunner, "evaluate").mockResolvedValue({
    status: "passed",
    verdict: "accepted",
    summary: "All checks passed.",
    checks: [
      {
        name: "build",
        status: "passed",
        evidence: "build ok",
        label: "Build",
        family: "build",
      },
    ],
    artifacts: [],
  } as any)
  spyOn(CheckRunner, "analyzeDelivery").mockResolvedValue({
    verdict: "accepted",
    classification: "unknown",
    summary: "Delivery accepted.",
    goal_statuses: [
      {
        goal_index: 0,
        status: "passed",
        evidence: "build ok",
        reasoning: "The build selector passed.",
      },
    ],
    replan_guidance: null,
  })
  spyOn(DeliveryService, "deliver").mockResolvedValue({
    status: "delivered",
    summary: "Delivery finalized.",
    artifacts: [],
    publish: {
      mode: "manual",
      adapters: [],
    },
  } as any)
}

async function files(dir: string) {
  return (await Glob.scan("*.md", {
    cwd: dir,
    absolute: true,
  })).toSorted()
}

describe("orchestrator docs", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test(
    "persists PRD, plan, goals, and evaluation snapshots with timestamped filenames",
    async () => {
      await using tmp = await tmpdir({ git: true })
      stubPipeline()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const taskID = await OrchestratorService.createTask({
            request: "update the landing page hero section copy",
          })
          const progress = await OrchestratorService.getProgress(taskID)
          expect(progress.task.status).toBe("completed")

          const prds = await files(path.join(tmp.path, ".opencorvus", "prds"))
          const plans = await files(path.join(tmp.path, ".opencorvus", "plans"))
          const goals = await files(path.join(tmp.path, ".opencorvus", "goals"))
          const evaluations = await files(path.join(tmp.path, ".opencorvus", "evaluations"))

          expect(prds).toHaveLength(1)
          expect(plans).toHaveLength(1)
          expect(goals.length).toBeGreaterThanOrEqual(2)
          expect(evaluations.length).toBeGreaterThanOrEqual(1)

          for (const file of [prds[0], plans[0], goals[0], goals.at(-1), evaluations[0]]) {
            expect(path.dirname(file!)).toContain(path.join(tmp.path, ".opencorvus"))
            expect(path.basename(file!)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/)
          }

          expect(readFileSync(prds[0]!, "utf-8")).toContain("# PRD")
          expect(readFileSync(prds[0]!, "utf-8")).toContain("Modify `src/app.ts`")
          expect(readFileSync(plans[0]!, "utf-8")).toContain("# Plan Graph Snapshot")
          expect(readFileSync(plans[0]!, "utf-8")).toContain("Compiled plan")
          expect(readFileSync(goals[0]!, "utf-8")).toContain("# Goal Snapshot")
          // Last goals snapshot should reflect the passed status from evaluation
          expect(readFileSync(goals.at(-1)!, "utf-8")).toContain("[passed] [blocking] Keep build green")
          expect(readFileSync(evaluations[0]!, "utf-8")).toMatch(/# (Coordinator|Goal Run) Evaluation Snapshot/)
          expect(readFileSync(evaluations[0]!, "utf-8")).toContain("build ok")
        },
      })
    },
    { timeout: 30_000 },
  )

  test("document detail level: each snapshot meets minimum length thresholds", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPipeline()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
        })
        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("completed")

        const prds = await files(path.join(tmp.path, ".opencorvus", "prds"))
        const plans = await files(path.join(tmp.path, ".opencorvus", "plans"))
        const goals = await files(path.join(tmp.path, ".opencorvus", "goals"))
        const evaluations = await files(path.join(tmp.path, ".opencorvus", "evaluations"))

        // ── PRD detail level ──────────────────────────────────────────────
        const prdContent = readFileSync(prds[0]!, "utf-8")
        expect(prdContent.length).toBeGreaterThan(200)
        // Must have required structural sections
        const prdSections = ["# PRD", "## Request", "## Summary", "## Content"]
        for (const section of prdSections) {
          expect(prdContent).toContain(section)
        }
        // Goal draft and risk areas should be present (mock provides both)
        expect(prdContent).toContain("## Goal Draft")
        expect(prdContent).toContain("## Risk Areas")
        // Each section should have non-trivial content (not just the header)
        expect(prdContent.split("## Request")[1]!.split("##")[0]!.trim().length).toBeGreaterThan(10)
        expect(prdContent.split("## Summary")[1]!.split("##")[0]!.trim().length).toBeGreaterThan(5)
        expect(prdContent.split("## Content")[1]!.split("##")[0]!.trim().length).toBeGreaterThan(20)

        // ── Plan detail level ─────────────────────────────────────────────
        const planContent = readFileSync(plans[0]!, "utf-8")
        expect(planContent.length).toBeGreaterThan(300)
        const planSections = ["# Plan Graph Snapshot", "## Request", "## Summary", "## Steps", "## Execution Prompt"]
        for (const section of planSections) {
          expect(planContent).toContain(section)
        }
        // Steps section should list numbered items
        expect(planContent).toMatch(/1\. Inspect src\/app\.ts/)
        expect(planContent).toMatch(/2\. Run the build check/)
        // Execution prompt must contain the prompt in a code fence
        expect(planContent).toContain("````text")
        expect(planContent.split("````text")[1]!.split("````")[0]!.trim().length).toBeGreaterThan(20)

        // ── Goals detail level (initial = pending, post-eval = passed) ────
        const goalInitial = readFileSync(goals[0]!, "utf-8")
        const goalFinal = readFileSync(goals.at(-1)!, "utf-8")
        expect(goalInitial.length).toBeGreaterThan(100)
        expect(goalFinal.length).toBeGreaterThan(100)
        for (const content of [goalInitial, goalFinal]) {
          expect(content).toContain("# Goal Snapshot")
          expect(content).toContain("## Goals")
          expect(content).toContain("## Plan Summary")
          // Each goal listing should include criteria
          expect(content).toContain("- Criteria:")
        }
        // Initial goals should show pending, final should show passed
        expect(goalInitial).toContain("Pending: 1")
        expect(goalFinal).toContain("Passed: 1")

        // ── Evaluation detail level ───────────────────────────────────────
        const evalContent = readFileSync(evaluations[0]!, "utf-8")
        expect(evalContent.length).toBeGreaterThan(200)
        // Evaluation can be Coordinator or Goal Run type
        expect(evalContent).toMatch(/# (Coordinator|Goal Run) Evaluation Snapshot/)
        const evalRequiredSections = ["## Request", "## Summary", "## QA Groups", "## Checks"]
        for (const section of evalRequiredSections) {
          expect(evalContent).toContain(section)
        }
        // Analysis and Goal Assessment should be present (mock provides both)
        expect(evalContent).toContain("## Analysis")
        expect(evalContent).toContain("## Goal Assessment")
        // Delivery section should be present
        expect(evalContent).toContain("## Delivery")
        // Checks section should list at least one check with status
        expect(evalContent).toMatch(/\[passed\] Build/)
      },
    })
  },
  { timeout: 30_000 },
  )

  test("session-to-document consistency: document content matches pipeline data", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPipeline()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const REQUEST = "update the landing page hero section copy"
        const taskID = await OrchestratorService.createTask({ request: REQUEST })
        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("completed")

        const prds = await files(path.join(tmp.path, ".opencorvus", "prds"))
        const plans = await files(path.join(tmp.path, ".opencorvus", "plans"))
        const goals = await files(path.join(tmp.path, ".opencorvus", "goals"))
        const evaluations = await files(path.join(tmp.path, ".opencorvus", "evaluations"))

        // ── PRD ↔ session consistency ─────────────────────────────────────
        const prdContent = readFileSync(prds[0]!, "utf-8")
        // Filename contains task ID
        expect(path.basename(prds[0]!)).toContain(taskID)
        // Document body contains task ID
        expect(prdContent).toContain(`Task ID: ${taskID}`)
        // Request section matches the original request verbatim
        expect(prdContent).toContain(REQUEST)
        // Summary matches spec summary from mock
        expect(prdContent).toContain("Task spec")
        // Expanded spec content matches mock
        expect(prdContent).toContain("Modify `src/app.ts`")
        expect(prdContent).toContain("Preserve the existing module shape")
        expect(prdContent).toContain("Verify the build check passes")
        // Goal draft from spec_analysis
        expect(prdContent).toContain("Keep build green")
        expect(prdContent).toContain("Build check passes after updating src/app.ts.")
        // Risk areas from spec_analysis
        expect(prdContent).toContain("Avoid changing unrelated modules.")

        // ── Plan ↔ session consistency ────────────────────────────────────
        const planContent = readFileSync(plans[0]!, "utf-8")
        expect(path.basename(plans[0]!)).toContain(taskID)
        expect(planContent).toContain(`Task ID: ${taskID}`)
        // Request is echoed in plan
        expect(planContent).toContain(REQUEST)
        // Plan summary from mock
        expect(planContent).toContain("Compiled plan")
        // Strategy from metadata
        expect(planContent).toContain("Strategy: initial")
        // Steps from metadata
        expect(planContent).toContain("Inspect src/app.ts and apply the requested change.")
        expect(planContent).toContain("Run the build check and confirm it passes.")
        // PRD summary reference
        expect(planContent).toContain("Summary: Task spec")
        // Execution prompt matches mock verbatim
        expect(planContent).toContain("Implement the requested change in src/app.ts and verify the build.")

        // ── Goals ↔ session consistency ───────────────────────────────────
        const goalInitial = readFileSync(goals[0]!, "utf-8")
        const goalFinal = readFileSync(goals.at(-1)!, "utf-8")
        for (const content of [goalInitial, goalFinal]) {
          expect(content).toContain(`Task ID: ${taskID}`)
          // Plan summary in goals doc
          expect(content).toContain("Compiled plan")
          // Goal description and criteria match mock
          expect(content).toContain("Keep build green")
          expect(content).toContain("Build check passes after updating src/app.ts.")
          // Check selectors
          expect(content).toContain("Checks: build")
        }
        // Status transition: pending → passed
        expect(goalInitial).toContain("[pending] [blocking] Keep build green")
        expect(goalFinal).toContain("[passed] [blocking] Keep build green")
        // Counts are consistent
        expect(goalInitial).toContain("Total Goals: 1")
        expect(goalFinal).toContain("Total Goals: 1")

        // ── Evaluation ↔ session consistency ──────────────────────────────
        const evalContent = readFileSync(evaluations[0]!, "utf-8")
        expect(path.basename(evaluations[0]!)).toContain(taskID)
        expect(evalContent).toContain(`Task ID: ${taskID}`)
        // Request echoed
        expect(evalContent).toContain(REQUEST)
        // Verdict and status match evaluator mock
        expect(evalContent).toContain("Verdict: accepted")
        expect(evalContent).toContain("Status: passed")
        // Evaluation type: Coordinator or Goal Run
        expect(evalContent).toMatch(/# (Coordinator|Goal Run) Evaluation Snapshot/)
        // Summary matches one of the evaluator mocks (evaluate or analyzeDelivery)
        const hasCoordinatorSummary = evalContent.includes("All checks passed.")
        const hasGoalRunSummary = evalContent.includes("Delivery accepted.")
        expect(hasCoordinatorSummary || hasGoalRunSummary).toBe(true)
        // Individual check details
        expect(evalContent).toContain("[passed] Build (build)")
        expect(evalContent).toContain("Evidence: build ok")
        // Analysis classification from analyzeDelivery mock
        expect(evalContent).toContain("Classification: unknown")
        // Goal assessment from analyzeDelivery mock
        expect(evalContent).toContain("[passed] Keep build green")
        expect(evalContent).toContain("Reasoning: The build selector passed.")
        // Delivery section present with summary
        expect(evalContent).toContain("## Delivery")

        // ── Cross-document consistency ────────────────────────────────────
        // All docs reference the same task ID
        const allDocs = [prdContent, planContent, goalInitial, goalFinal, evalContent]
        for (const content of allDocs) {
          expect(content).toContain(taskID)
        }
        // Goal description is consistent across PRD, goals, and evaluation docs
        expect(prdContent).toContain("Keep build green")
        expect(goalFinal).toContain("Keep build green")
        expect(evalContent).toContain("Keep build green")
        // Request text appears in PRD, plan, and evaluation
        expect(prdContent).toContain(REQUEST)
        expect(planContent).toContain(REQUEST)
        expect(evalContent).toContain(REQUEST)
      },
    })
  },
  { timeout: 30_000 },
  )
})
