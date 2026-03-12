import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import { DeliveryService } from "../../src/orchestrator/delivery"
import { OrchestratorService } from "../../src/orchestrator/service"
import { EvaluatorService } from "../../src/evaluator/service"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SpecService } from "../../src/spec/service"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function stubPlanner() {
  spyOn(SpecService, "initial").mockImplementation(async (input: any) => ({
    summary: `Spec for: ${input.title}`,
    content: `# Scope\n\n${input.request}`,
    goals: (input.goals ?? []).map((goal: any) => ({
      description: goal.description,
      criteria: goal.criteria,
      priority: goal.priority ?? "blocking",
      metadata: goal.metadata,
    })),
    assumptions: [],
    risks: [],
    clarifications: [],
    spec_items: [],
    evidence_sources: [],
    unresolved_questions: [],
  }))
  spyOn(PlannerService, "initial").mockImplementation(async (input: any) => ({
    summary: "Compiled plan",
    prompt: "Execute the compiled plan",
    goals: (input.goals ?? []).map((goal: any) => ({
      description: goal.description,
      criteria: goal.criteria,
      priority: goal.priority ?? "blocking",
      metadata: goal.metadata,
    })),
    metadata: {
      strategy: "initial",
      steps: ["Explore", "Implement", "Verify"],
      planner: {
        role: "headless_compiler",
        quality: "compiled",
        source: "planner_agent",
        clarification_source: "none",
      },
    },
  }) as any)
}

describe("orchestrator.goal analysis-only acceptance", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("accepts a goal when analysis passes and phase1 only reports missing local checks", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => {
      const session = await Session.get(sessionID)
      await Bun.write(path.join(session.directory, "src", "from-analysis.ts"), "export const ok = true\n")
      return {
        sessionID,
        queueTaskID: Identifier.ascending("task"),
      }
    })
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(EvaluatorService, "evaluate").mockImplementation(async (input) =>
      input.activeSpecVersionID
        ? {
            status: "passed",
            verdict: "accepted",
            summary: "All checks passed.",
            checks: [
              { name: "verify_cmd", status: "passed", evidence: "verified" },
              { name: "spec_check", status: "passed", evidence: "verified" },
            ],
            artifacts: [],
          }
        : {
            status: "failed",
            verdict: "rejected",
            summary: "No blocking evaluator checks ran.",
            checks: [
              { name: "evaluation_config", status: "skipped", evidence: "goal local checks are unavailable" },
            ],
            artifacts: [],
          } as Awaited<ReturnType<typeof EvaluatorService.evaluate>>)
    spyOn(EvaluatorService, "analyzeDelivery").mockResolvedValue({
      verdict: "accepted",
      classification: "unknown",
      summary: "Implementation is complete and correct.",
      goal_statuses: [
        {
          goal_index: 0,
          status: "passed",
          evidence: "read_file confirmed the required files exist with correct content.",
          reasoning: "The goal was satisfied even though no goal-local automated checks ran.",
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
        adapters: [{ id: "delivery", status: "delivered", summary: "Delivery finalized." }],
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "allow analysis-only goal acceptance",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
          },
          goals: [
            {
              description: "Write analysis file",
              criteria: "Create src/from-analysis.ts in the goal workspace.",
              priority: "blocking",
            } as any,
          ],
        })

        let progress = await OrchestratorService.getProgress(taskID)
        for (const _ of Array.from({ length: 80 })) {
          if (["completed", "failed"].includes(progress.task.status)) break
          await Bun.sleep(50)
          progress = await OrchestratorService.getProgress(taskID)
        }

        expect(progress.task.status).toBe("completed")
        expect(await Bun.file(path.join(tmp.path, "src", "from-analysis.ts")).text()).toBe("export const ok = true\n")
      },
    })
  }, 20_000)

  test("fails a goal when semantic analysis rejects a phase1 pass without selector evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => {
      const session = await Session.get(sessionID)
      await Bun.write(path.join(session.directory, "src", "semantic-gap.ts"), "export const gap = true\n")
      return {
        sessionID,
        queueTaskID: Identifier.ascending("task"),
      }
    })
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(EvaluatorService, "evaluate").mockImplementation(async (input) =>
      input.activeSpecVersionID
        ? {
            status: "passed",
            verdict: "accepted",
            summary: "All checks passed.",
            checks: [
              { name: "verify_cmd", status: "passed", evidence: "verified" },
              { name: "spec_check", status: "passed", evidence: "verified" },
            ],
            artifacts: [],
          }
        : {
            status: "passed",
            verdict: "accepted",
            summary: "verify_cmd passed.",
            checks: [
              { name: "verify_cmd", status: "passed", evidence: "verified" },
            ],
            artifacts: [],
          } as Awaited<ReturnType<typeof EvaluatorService.evaluate>>)
    spyOn(EvaluatorService, "analyzeDelivery").mockResolvedValue({
      verdict: "rejected",
      classification: "strategy",
      summary: "The required behavior is still missing even though the generic checks passed.",
      goal_statuses: [
        {
          goal_index: 0,
          status: "failed",
          evidence: "read_file did not find the required behavior described by the goal.",
          reasoning: "Generic checks passed, but they did not verify the actual goal contract.",
        },
      ],
      replan_guidance: {
        root_cause: "Goal semantics were not met.",
        what_failed: "The delivery did not satisfy the requested behavior.",
        suggested_strategy: "Implement the actual goal instead of relying on generic verification.",
        avoid_approaches: [],
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "goal semantics must still be checked",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
          },
          budget: {
            maxRuns: 1,
            maxReplans: 0,
          },
          goals: [
            {
              description: "Implement the semantic behavior",
              criteria: "Do the actual semantic thing, not just pass a generic command.",
              priority: "blocking",
            } as any,
          ],
        })

        let progress = await OrchestratorService.getProgress(taskID)
        for (const _ of Array.from({ length: 80 })) {
          if (["completed", "failed"].includes(progress.task.status)) break
          await Bun.sleep(50)
          progress = await OrchestratorService.getProgress(taskID)
        }

        expect(progress.task.status).toBe("failed")
        expect(progress.evaluation?.summary ?? progress.run?.error ?? "").toContain("generic checks passed")
      },
    })
  }, 20_000)
})
