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

describe("orchestrator.goal evaluation workspace", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("runs goal evaluation inside the goal workspace instead of the task root", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const dirs: string[] = []
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => {
      const session = await Session.get(sessionID)
      await Bun.write(path.join(session.directory, "src", "from-goal.ts"), "export const goal = true\n")
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
    spyOn(EvaluatorService, "evaluate").mockImplementation(async () => {
      dirs.push(Instance.directory)
      const exists = await Bun.file(path.join(Instance.directory, "src", "from-goal.ts")).exists()
      return {
        status: exists ? "passed" : "failed",
        verdict: exists ? "accepted" : "rejected",
        summary: exists ? "Goal file found." : "Goal file missing.",
        checks: [
          {
            name: "verify_cmd",
            status: exists ? "passed" : "failed",
            evidence: Instance.directory,
          },
          {
            name: "spec_check",
            status: "passed",
            evidence: "stubbed",
          },
        ],
        artifacts: [],
      } as Awaited<ReturnType<typeof EvaluatorService.evaluate>>
    })
    spyOn(EvaluatorService, "analyzeDelivery").mockImplementation(async (input) => {
      const failed = input.checkResults.some((item) => item.status === "failed")
      return {
        verdict: failed ? "rejected" : "accepted",
        classification: failed ? "evaluation" : "unknown",
        summary: failed ? "Automated checks failed." : "All required checks passed.",
        goal_statuses: input.goals.map((_, goal_index) => ({
          goal_index,
          status: failed ? "failed" as const : "passed" as const,
          evidence: failed ? "Required checks failed." : "Required checks passed.",
          reasoning: failed ? "The goal workspace file was not visible during evaluation." : "The goal workspace file was visible during evaluation.",
        })),
        replan_guidance: failed
          ? {
              root_cause: "Goal evaluation ran in the wrong directory",
              what_failed: "The goal workspace file was not visible during evaluation.",
              suggested_strategy: "Evaluate the goal inside its own workspace.",
              avoid_approaches: [],
            }
          : null,
      }
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
          request: "verify goal evaluation cwd",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
          },
          goals: [
            {
              description: "Write goal file",
              criteria: "Create src/from-goal.ts in the goal workspace.",
              priority: "blocking",
              metadata: {
                check_selector: ["verify_cmd"],
              },
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
        expect(dirs).toHaveLength(2)
        expect(dirs[0]).not.toBe(tmp.path)
        expect(dirs[1]).toBe(tmp.path)
        expect(await Bun.file(path.join(tmp.path, "src", "from-goal.ts")).text()).toBe("export const goal = true\n")
      },
    })
  }, 20_000)
})
