import { $ } from "bun"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"
import { Database, eq } from "../../src/storage/db"
import { EvaluatorService } from "../../src/evaluator/service"
import { type ExecutorAdapter } from "../../src/executor/compat"
import { ExecutorRegistry } from "../../src/executor/registry"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Global } from "../../src/global"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorInteractionRequestTable,
  OrchestratorEvaluationTable,
  OrchestratorPlanVersionTable,
  OrchestratorRunTable,
  OrchestratorSpecItemTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { DeliveryService } from "../../src/orchestrator/delivery"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { PlannerFailureError, PlannerService } from "../../src/planner/service"
import { SpecService } from "../../src/spec/service"
import { Filesystem } from "../../src/util/filesystem"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: true })

function dict(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function gitMeta(input: { metadata?: Record<string, unknown> | null } | undefined) {
  return dict(dict(input?.metadata).git)
}

function stubSpec() {
  const initial = spyOn(SpecService, "initial").mockImplementation(async (input: any) => ({
    summary: `Spec for: ${input.title}`,
    content: `# Scope\n\nSpec content for ${input.title}`,
    scope: `Scope for ${input.title}`,
    assumptions: [],
    risks: [],
    spec_items: [
      {
        title: "Implement the requested change",
        description: "The requested change is correctly implemented.",
        priority: "blocking",
        check_selector: ["build", "test"],
      },
    ],
    evidence_sources: [],
    unresolved_questions: [],
  }) as any)
  const rewrite = spyOn(SpecService, "rewrite").mockImplementation(async (input: any) => ({
    summary: `Revised spec for: ${input.title}`,
    content: `# Scope\n\nRevised spec for ${input.title}`,
    scope: `Revised scope for ${input.title}`,
    assumptions: [],
    risks: [],
    spec_items: [
      {
        title: "Implement the revised change",
        description: "The revised change is correctly implemented.",
        priority: "blocking",
        check_selector: ["build", "test"],
      },
    ],
    evidence_sources: [],
    unresolved_questions: [],
  }) as any)
  return { initial, rewrite }
}

function stubPlanner() {
  stubSpec()
  const initial = spyOn(PlannerService, "initial").mockImplementation(async (input: any) => ({
    summary: "Compiled plan",
    prompt: "Execute the compiled plan",
    goals: input.goals && input.goals.length > 0
      ? input.goals.map((g: any) => ({
          description: g.description,
          criteria: g.criteria,
          priority: g.priority ?? "blocking",
          metadata: g.metadata,
        }))
      : [
          {
            description: "Implement the requested change",
            criteria: "The requested change is implemented and checks pass.",
            priority: "blocking",
          },
        ],
    metadata: {
      strategy: "initial",
      steps: ["Explore", "Plan", "Verify"],
      planner: {
        role: "headless_compiler",
        quality: "compiled",
        source: "planner_agent",
        clarification_source: "none",
      },
      clarification: undefined,
      spec_analysis: undefined,
    },
  }) as any)
  const replan = spyOn(PlannerService, "replan").mockResolvedValue({
    summary: "Compiled replan",
    prompt: "Execute the replanned approach",
    goals: [
      {
        description: "Implement the requested change",
        criteria: "The requested change is implemented and checks pass.",
        priority: "blocking",
      },
    ],
    metadata: {
      strategy: "replan",
      steps: ["Re-evaluate", "Re-implement", "Verify"],
      planner: {
        role: "headless_compiler",
        quality: "compiled",
        source: "planner_agent",
        clarification_source: "none",
      },
      previous_plan_id: "pln_previous",
      failure_summary: "previous run failed",
      clarification: undefined,
      spec_analysis: undefined,
    },
  } as any)
  const analyze = spyOn(EvaluatorService, "analyzeDelivery").mockImplementation(async (input) => {
    const failed = input.checkResults.some((item) => item.status === "failed")
    const goal_statuses = input.goals.map((goal, goal_index) => {
      const selectors = goal.check_selector ?? []
      const relevant = selectors.flatMap((selector) =>
        input.checkResults.filter((item) => item.name === selector || item.name.startsWith(`${selector}#`)),
      )
      if (relevant.some((item) => item.status === "failed")) {
        return {
          goal_index,
          status: "failed" as const,
          evidence: "Relevant automated checks failed.",
          reasoning: "At least one required check failed.",
        }
      }
      if (selectors.length > 0 && relevant.length === 0) {
        return {
          goal_index,
          status: "inconclusive" as const,
          evidence: "No matching automated check ran for this goal.",
          reasoning: "The goal cannot be confirmed without its selected checks.",
        }
      }
      if (relevant.length > 0 && relevant.every((item) => item.status === "passed")) {
        return {
          goal_index,
          status: "passed" as const,
          evidence: "Relevant automated checks passed.",
          reasoning: "All selected checks passed.",
        }
      }
      return {
        goal_index,
        status: failed && goal.priority === "blocking" ? "failed" as const : "passed" as const,
        evidence: failed ? "Automated check failure." : "Checks passed.",
        reasoning: failed ? "Blocking checks failed." : "Relevant checks passed.",
      }
    })
    const pendingBlocking = goal_statuses.some((item) =>
      item.status === "inconclusive" && input.goals[item.goal_index]?.priority === "blocking",
    )
    return {
      verdict: failed ? "rejected" : pendingBlocking ? "inconclusive" : "accepted",
      classification: failed ? "evaluation" : "unknown",
      summary: failed
        ? "Automated checks failed."
        : pendingBlocking
          ? "Required checks are incomplete for some blocking goals."
          : "All required checks passed.",
      goal_statuses,
      replan_guidance: failed
        ? {
            root_cause: "Automated checks failed",
            what_failed: "Evaluation rejected the candidate delivery",
            suggested_strategy: "Fix the failing checks before retrying.",
            avoid_approaches: [],
          }
      : null,
    }
  })
  return { initial, replan, analyze }
}

describe("orchestrator.service", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("rejects stale project ids after auto-initializing git", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stale = Instance.project.id
        expect(stale).toBe("global")
        await expect(
          OrchestratorService.createTask({
            project: stale,
            request: "implement feature",
          }),
        ).rejects.toThrow("project mismatch")
        expect(Instance.project.vcs).toBe("git")
        expect(Instance.project.id).not.toBe(stale)
      },
    })
  })

  test("initializes git and captures a checkpoint before first run", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "note.txt"), "hello")
      },
    })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => {
      const next = await Project.fromDirectory(tmp.path)
      expect(await Filesystem.exists(path.join(tmp.path, ".git"))).toBe(true)
      expect(await Filesystem.exists(path.join(Global.Path.data, "snapshot", next.project.id, "HEAD"))).toBe(true)
      return {
        sessionID,
        queueTaskID: Identifier.ascending("task"),
      }
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Instance.project.vcs).toBeUndefined()
        const taskID = await OrchestratorService.createTask({
          request: "create a starter task in a standalone directory",
        })
        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        expect(Instance.project.vcs).toBe("git")
        expect(Instance.project.id).not.toBe("global")
        expect(task?.project_id).toBe(Instance.project.id)
        const meta = gitMeta(task)
        const title = task?.title ?? ""
        expect(dict(meta.baseline).mode).toBe("created_commit")
        expect(typeof dict(meta.baseline).commit).toBe("string")
        expect(typeof dict(meta.baseline).snapshot).toBe("string")
        expect(dict(meta.baseline).message).toBe(`Checkpoint before ${title}`)
      },
    })

    const subject = await $`git log -1 --pretty=%s`.cwd(tmp.path).quiet().text()
    expect(subject.trim()).toBe("Checkpoint before create a starter task in a standalone directory")
    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("commits the accepted workspace state with a meaningful message", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "note.txt"), "before\n")
        await $`git add note.txt`.cwd(dir).quiet()
        await $`git commit --no-gpg-sign -m "seed note"`.cwd(dir).quiet()
      },
    })
    stubPlanner()
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
      summary: "Updated note.txt and verified the change.",
      diffs: [
        {
          file: "note.txt",
          before: "before\n",
          after: "after\n",
        },
      ],
    })
    spyOn(EvaluatorService, "evaluate").mockResolvedValue({
      status: "passed",
      summary: "All checks passed.",
      checks: [{ name: "manual", status: "passed", evidence: "verified" }],
      artifacts: [],
    } as Awaited<ReturnType<typeof EvaluatorService.evaluate>>)
    spyOn(DeliveryService, "deliver").mockResolvedValue({
      status: "delivered",
      summary: "Delivery finalized.",
      artifacts: [],
      publish: {
        mode: "manual",
        adapters: [{ id: "delivery", status: "delivered", summary: "Delivery finalized." }],
      },
    })
    let title = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
        })
        await Bun.write(path.join(tmp.path, "note.txt"), "after\n")
        const board = await OrchestratorService.getBoard(taskID)
        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        const meta = gitMeta(task)
        title = task?.title ?? ""
        expect(task?.status).toBe("completed")
        expect(dict(meta.baseline).mode).toBe("created_commit")
        expect(dict(meta.result).mode).toBe("created_commit")
        expect(dict(meta.baseline).message).toBe(`Checkpoint before ${title}`)
        expect(dict(meta.result).message).toBe(title)
        expect(typeof dict(meta.result).commit).toBe("string")
        expect(board.task.metadata?.git).toBeTruthy()
        expect(
          board.snapshots.some((item) => item.payload?.stage === "result" && item.payload?.message === title),
        ).toBe(true)
      },
    })

    const log = await $`git log --pretty=%s -2`.cwd(tmp.path).quiet().text()
    expect(log.split(/\r?\n/).filter(Boolean).slice(0, 2)).toEqual([
      title,
      `Checkpoint before ${title}`,
    ])
  })

  test("persists spec items when resuming a legacy planner clarification", async () => {
    await using tmp = await tmpdir({ git: true })
    const { replan } = stubPlanner()
    replan.mockResolvedValue({
      summary: "Clarified replan",
      prompt: "Execute the clarified replanned approach",
      goals: [
        {
          description: "Keep build green",
          criteria: "Build passes.",
          priority: "blocking",
          metadata: {
            check_selector: ["build"],
          },
        },
      ],
      metadata: {
        strategy: "replan",
        steps: ["Re-evaluate", "Re-implement", "Verify"],
        planner: {
          role: "headless_compiler",
          quality: "compiled",
          source: "planner_agent",
          clarification_source: "suppressed",
        },
        spec: {
          summary: "Clarified spec summary",
          spec_items: [
            {
              title: "Preserve the acceptance gate",
              description: "Spec items remain available to spec_check after clarification.",
              priority: "blocking",
              check_selector: ["spec_check"],
            },
          ],
        },
        spec_analysis: {
          expanded_spec: "# Scope\n\nKeep spec items attached after clarification.",
          ambiguities: [],
          questions: [],
        },
      },
    } as any)
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "queued",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
        })
        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )!
        const runID = Identifier.ascending("run")
        const interactionID = Identifier.ascending("interaction")
        const now = Date.now()

        Database.transaction((db) => {
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              plan_version_id: task.active_plan_version_id,
              session_id: task.session_id,
              executor: "opencode",
              status: "blocked",
              phase: "replan",
              blocking_reason: "clarification",
              retry_count: 0,
              metadata: {
                previous_run_id: task.active_run_id,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
          db.update(OrchestratorTaskTable)
            .set({
              active_run_id: runID,
              status: "blocked",
              blocking_reason: "clarification",
              time_updated: now,
            })
            .where(eq(OrchestratorTaskTable.id, taskID))
            .run()
          db.insert(OrchestratorInteractionRequestTable)
            .values({
              id: interactionID,
              task_id: taskID,
              run_id: runID,
              session_id: task.session_id,
              external_id: Identifier.ascending("question"),
              request_type: "question",
              status: "pending",
              title: "Scope",
              body: "Which part should change?",
              payload: {
                planner_clarification: true,
                questions: [
                  {
                    header: "Scope",
                    question: "Which part should change?",
                  },
                ],
                provisional_plan: {
                  summary: "Need answers",
                  goals: [],
                  metadata: {
                    strategy: "replan",
                    failure_summary: "Previous plan lacked scope detail.",
                  },
                },
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        await OrchestratorService.replyInteraction(interactionID, {
          message: "Only update the marketing hero copy.",
        })

        const next = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )!
        const specItems = Database.use((db) =>
          db
            .select()
            .from(OrchestratorSpecItemTable)
            .where(eq(OrchestratorSpecItemTable.spec_snapshot_id, next.active_spec_version_id!))
            .all(),
        )
        expect(next.active_spec_version_id).toBeTruthy()
        expect(specItems).toHaveLength(1)
        expect(specItems[0]?.title).toBe("Preserve the acceptance gate")
      },
    })
  })

  test("persists spec snapshot and items when initial planning fails", async () => {
    await using tmp = await tmpdir({ git: true })
    stubSpec()
    spyOn(PlannerService, "initial").mockRejectedValue(new PlannerFailureError("planner exploded"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          OrchestratorService.createTask({
            request: "update the landing page hero section copy",
          }),
        ).rejects.toThrow("planner exploded")

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).get(),
        )
        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).get(),
        )
        const snapshot = Database.use((db) =>
          db.select().from(OrchestratorSpecSnapshotTable).get(),
        )
        const specItems = Database.use((db) =>
          db.select().from(OrchestratorSpecItemTable).all(),
        )

        expect(task?.status).toBe("failed")
        expect(task?.active_spec_version_id).toBe(snapshot?.id)
        expect(run?.status).toBe("failed")
        expect(snapshot?.summary).toContain("Spec for:")
        expect(specItems).toHaveLength(1)
        expect(specItems[0]?.title).toBe("Implement the requested change")
      },
    })
  })

  test("retries same plan after first evaluation failure", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        console.log("[DEBUG] Before createTask")
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })
        console.log("[DEBUG] After createTask, taskID:", taskID)
        console.log("[DEBUG] Before getProgress")
        try {
          const progress = await OrchestratorService.getProgress(taskID)
          console.log("[DEBUG] Progress:", progress.task.status, progress.run?.status)
        } catch (e) {
          console.log("[DEBUG] getProgress error:", e instanceof Error ? e.message : String(e))
        }
        console.log("[DEBUG] After getProgress (should not hang)")
        const progress = await OrchestratorService.getProgress(taskID)
        console.log("[DEBUG] Second progress:", progress.task.status)
        expect(progress.task.status).toBe("running")
        expect(progress.run?.status).toBe("accepted")
        expect(progress.run?.retryCount).toBe(1)
        expect(progress.run?.planVersionID).toBe(progress.plan?.id)

        const runs = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).all(),
        )
        const evaluations = Database.use((db) =>
          db.select().from(OrchestratorEvaluationTable).where(eq(OrchestratorEvaluationTable.task_id, taskID)).all(),
        )
        expect(runs.length).toBe(2)
        expect(evaluations.length).toBe(1)
        expect(evaluations[0]?.status).toBe("failed")
        expect(runs.some((item) => item.status === "completed")).toBe(true)
        expect(runs.some((item) => item.status === "accepted" && item.retry_count === 1)).toBe(true)
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("preserves all planner clarification questions in blocked interactions", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(PlannerService, "initial").mockResolvedValue({
      summary: "Need answers",
      prompt: "Ask before executing",
      goals: [
        {
          description: "Clarify",
          criteria: "Clarify the request",
          priority: "blocking",
        },
      ],
      metadata: {
        strategy: "initial",
        steps: ["Clarify"],
        planner: {
          role: "headless_compiler",
          quality: "compiled",
          source: "planner_agent",
          clarification_source: "model",
        },
        clarification: {
          reason: "Need more detail",
          questions: [
            {
              header: "Scope",
              question: "Which package should change?",
            },
            {
              header: "Compatibility",
              question: "Should old behavior remain?",
            },
          ],
        },
      },
    } as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "Refactor this subsystem",
        })

        const interaction = Database.use((db) =>
          db
            .select()
            .from(OrchestratorInteractionRequestTable)
            .where(eq(OrchestratorInteractionRequestTable.task_id, taskID))
            .get(),
        )

        expect(interaction?.status).toBe("pending")
        expect(Array.isArray(interaction?.payload?.questions)).toBe(true)
        expect(interaction?.payload?.questions).toHaveLength(2)
        expect(interaction?.body).toContain("Which package should change?")
        expect(interaction?.body).toContain("Should old behavior remain?")
      },
    })
  })

  test("selectTaskChecks toggles named checks without losing their commands", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
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
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "run a custom check",
          checks: {
            named: {
              typecheck: {
                label: "Type Check",
                family: "lint",
                commands: [`"${process.execPath}" -e "process.exit(0)"`],
              },
            },
          },
        })

        await OrchestratorService.selectTaskChecks(taskID, { "named:typecheck": false })
        let task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        let checks = task?.metadata?.checks as { named?: { typecheck?: { enabled?: boolean; commands?: string[] } } } | undefined
        expect(checks?.named?.typecheck?.enabled).toBe(false)
        expect(checks?.named?.typecheck?.commands).toEqual([`"${process.execPath}" -e "process.exit(0)"`])

        await OrchestratorService.selectTaskChecks(taskID, { "named:typecheck": true })
        task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        checks = task?.metadata?.checks as { named?: { typecheck?: { enabled?: boolean; commands?: string[] } } } | undefined
        expect(checks?.named?.typecheck?.enabled).toBe(true)
        expect(checks?.named?.typecheck?.commands).toEqual([`"${process.execPath}" -e "process.exit(0)"`])
      },
    })
  })

  test("replans after second evaluation failure", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        await OrchestratorService.getProgress(taskID)
        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("running")
        expect(progress.run?.status).toBe("accepted")
        expect(progress.run?.phase).toBe("replan")
        expect(progress.plan?.version).toBe(2)

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )
        const evaluations = Database.use((db) =>
          db.select().from(OrchestratorEvaluationTable).where(eq(OrchestratorEvaluationTable.task_id, taskID)).all(),
        )
        expect(task?.active_plan_version_id).toBe(progress.plan?.id)
        expect(plans.length).toBe(2)
        expect(evaluations.length).toBe(2)
        expect(evaluations.every((item) => item.status === "failed")).toBe(true)
        expect(plans.some((item) => item.status === "superseded")).toBe(true)
      },
    })

    expect(submit).toHaveBeenCalledTimes(3)
  })

  test("blocks automatic replan when replanning needs clarification", async () => {
    await using tmp = await tmpdir({ git: true })
    const { replan } = stubPlanner()
    replan.mockResolvedValue({
      summary: "Clarification required before planning",
      prompt: "Wait for clarification",
      goals: [
        {
          description: "Clarify the change",
          criteria: "Clarification is answered.",
          priority: "blocking",
        },
      ],
      metadata: {
        strategy: "replan",
        steps: ["Clarify"],
        planner: {
          role: "headless_compiler",
          quality: "compiled",
          source: "spec_stage",
          clarification_source: "model",
        },
        clarification: {
          reason: "Need more scope detail",
          questions: [
            {
              header: "Scope",
              question: "Which part should change?",
            },
          ],
        },
      },
    } as any)
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        await OrchestratorService.getProgress(taskID)
        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("blocked")
        expect(progress.run?.status).toBe("blocked")
        expect(progress.run?.phase).toBe("replan")
        expect(progress.plan?.version).toBe(1)
        expect(progress.pendingInteractions).toHaveLength(1)

        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )
        expect(plans).toHaveLength(1)
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("marks task failed when retry and replan budgets are exhausted", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("failed")
        expect(progress.run?.status).toBe("completed")
        expect(progress.evaluation?.status).toBe("failed")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("records operator note and queues a follow-up run when task is not actively running", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    let calls = 0
    spyOn(OpencodeExecutor, "status").mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        return {
          queueTaskID: Identifier.ascending("task"),
          status: "completed",
          error: null,
        }
      }
      return {
        queueTaskID: Identifier.ascending("task"),
        status: "queued",
        error: null,
      }
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const failed = await OrchestratorService.getProgress(taskID)
        expect(failed.task.status).toBe("failed")

        const note = await OrchestratorService.recordOperatorNote(taskID, "Please also update the copy.")
        expect(note.resumed).toBe(true)

        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("running")
        expect(progress.run?.status).toBe("accepted")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("retryTask queues a deterministic retry run without task-message NLP", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const failed = await OrchestratorService.getProgress(taskID)
        expect(failed.task.status).toBe("failed")

        const run = await OrchestratorService.retryTask(taskID)
        expect(run.status).toBe("accepted")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("replanTask queues a new plan version without task-message NLP", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const failed = await OrchestratorService.getProgress(taskID)
        expect(failed.task.status).toBe("failed")
        expect(failed.plan?.version).toBe(1)

        const run = await OrchestratorService.replanTask(taskID)
        expect(run.status).toBe("accepted")
        expect(run.phase).toBe("replan")

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )
        expect(task?.active_plan_version_id).toBe(run.planVersionID)
        expect(plans.length).toBe(2)
        expect(plans.some((item) => item.status === "superseded")).toBe(true)
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("replanTask persists rewritten spec items on the new active spec version", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const failed = await OrchestratorService.getProgress(taskID)
        expect(failed.task.status).toBe("failed")
        const previousSpecVersionID = failed.task.activeSpecVersionID

        await OrchestratorService.replanTask(taskID)

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        const specItems = Database.use((db) =>
          db
            .select()
            .from(OrchestratorSpecItemTable)
            .where(eq(OrchestratorSpecItemTable.spec_snapshot_id, task?.active_spec_version_id!))
            .all(),
        )

        expect(task?.active_spec_version_id).toBeTruthy()
        expect(task?.active_spec_version_id).not.toBe(previousSpecVersionID)
        expect(specItems).toHaveLength(1)
        expect(typeof specItems[0]?.title).toBe("string")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("replanTask blocks when clarification is required before replanning", async () => {
    await using tmp = await tmpdir({ git: true })
    const { replan } = stubPlanner()
    replan.mockResolvedValue({
      summary: "Clarification required before planning",
      prompt: "Wait for clarification",
      goals: [
        {
          description: "Clarify the change",
          criteria: "Clarification is answered.",
          priority: "blocking",
        },
      ],
      metadata: {
        strategy: "replan",
        steps: ["Clarify"],
        planner: {
          role: "headless_compiler",
          quality: "compiled",
          source: "spec_stage",
          clarification_source: "model",
        },
        clarification: {
          reason: "Need more scope detail",
          questions: [
            {
              header: "Scope",
              question: "Which part should change?",
            },
          ],
        },
      },
    } as any)
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const failed = await OrchestratorService.getProgress(taskID)
        expect(failed.task.status).toBe("failed")
        const run = await OrchestratorService.replanTask(taskID)
        expect(run.status).toBe("blocked")
        expect(run.phase).toBe("replan")

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )
        const interaction = Database.use((db) =>
          db.select().from(OrchestratorInteractionRequestTable).where(eq(OrchestratorInteractionRequestTable.run_id, run.id)).get(),
        )
        expect(task?.status).toBe("blocked")
        expect(task?.active_plan_version_id).toBe(failed.plan?.id)
        expect(plans).toHaveLength(1)
        expect(interaction?.status).toBe("pending")
        expect(interaction?.body).toContain("Which part should change?")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("answering replanning clarification resumes PlannerService.replan and creates the next version", async () => {
    await using tmp = await tmpdir({ git: true })
    const { replan } = stubPlanner()
    replan
      .mockResolvedValueOnce({
        summary: "Clarification required before planning",
        prompt: "Wait for clarification",
        goals: [
          {
            description: "Keep build green",
            criteria: "Build passes.",
            priority: "blocking",
            metadata: {
              check_selector: ["build"],
            },
          },
        ],
        metadata: {
          strategy: "replan",
          steps: ["Clarify"],
          planner: {
            role: "headless_compiler",
            quality: "compiled",
            source: "spec_stage",
            clarification_source: "model",
          },
          clarification: {
            reason: "Need more scope detail",
            questions: [
              {
                header: "Scope",
                question: "Which part should change?",
              },
            ],
          },
          replan_context: {
            previousSummary: "Old summary",
            failureAnalysis: {
              classification: "evaluation",
              summary: "Checks failed",
              rootCause: "Checks failed",
              suggestedStrategy: "Try a safer change",
              avoidApproaches: ["Do not repeat the old patch"],
            },
            previousGoalStatuses: [],
          },
        },
      } as any)
      .mockResolvedValueOnce({
        summary: "Compiled replan after clarification",
        prompt: "Execute the clarified replanned approach",
        goals: [
          {
            description: "Keep build green",
            criteria: "Build passes.",
            priority: "blocking",
            metadata: {
              check_selector: ["build"],
            },
          },
        ],
        metadata: {
          strategy: "replan",
          steps: ["Re-evaluate", "Re-implement", "Verify"],
          planner: {
            role: "headless_compiler",
            quality: "compiled",
            source: "planner_agent",
            clarification_source: "suppressed",
          },
          previous_plan_id: "pln_previous",
          failure_summary: "previous run failed",
          clarification: undefined,
          spec_analysis: undefined,
        },
      } as any)
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    const status = spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const failed = await OrchestratorService.getProgress(taskID)
        expect(failed.task.status).toBe("failed")
        const blockedRun = await OrchestratorService.replanTask(taskID)
        expect(blockedRun.status).toBe("blocked")

        const interaction = Database.use((db) =>
          db.select().from(OrchestratorInteractionRequestTable).where(eq(OrchestratorInteractionRequestTable.run_id, blockedRun.id)).get(),
        )
        expect(interaction?.status).toBe("pending")

        status.mockResolvedValue({
          queueTaskID: Identifier.ascending("task"),
          status: "queued",
          error: null,
        })
        await OrchestratorService.replyInteraction(interaction!.id, {
          message: "Only update the marketing hero copy.",
        })

        const progress = await OrchestratorService.getProgress(taskID)
        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )
        expect(progress.task.status).toBe("running")
        expect(progress.run?.status).toBe("accepted")
        expect(progress.run?.phase).toBe("replan")
        expect(progress.plan?.version).toBe(2)
        expect(plans.some((item) => item.status === "superseded")).toBe(true)
        expect(replan.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
          allowClarification: false,
          previousPlanID: failed.plan?.id,
        }))
        expect(replan.mock.calls[1]?.[0]?.request).toContain("Only update the marketing hero copy.")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("only marks goals passed when evaluation checks match goal selectors", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          checks: {
            build: [`"${process.execPath}" -e "process.exit(0)"`],
          },
          goals: [
            {
              description: "Build passes",
              criteria: "Build command passes.",
              priority: "blocking",
              metadata: {
                check_selector: ["build"],
              },
            } as any,
            {
              description: "Tests pass",
              criteria: "Test command passes.",
              priority: "blocking",
              metadata: {
                check_selector: ["test"],
              },
            } as any,
          ],
        })

        const progress = await OrchestratorService.getProgress(taskID)
        const goals = progress.goals
        // With goal-gating: evaluation passed but "Tests pass" goal still pending
        // so task should retry instead of completing
        expect(progress.task.status).toBe("running")
        expect(goals.find((item) => item.description === "Build passes")?.status).toBe("passed")
        expect(goals.find((item) => item.description === "Tests pass")?.status).toBe("pending")
      },
    })

    // Initial run + retry because pending blocking goals remain
    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("completes task when evaluation passes and all blocking goals are satisfied", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          checks: {
            build: [`"${process.execPath}" -e "process.exit(0)"`],
          },
          goals: [
            {
              description: "Build passes",
              criteria: "Build command passes.",
              priority: "blocking",
              metadata: {
                check_selector: ["build"],
              },
            } as any,
            {
              description: "Nice to have",
              criteria: "Advisory goal.",
              priority: "advisory",
              metadata: {
                check_selector: ["test"],
              },
            } as any,
          ],
        })

        const progress = await OrchestratorService.getProgress(taskID)
        // All blocking goals passed (only "Build passes" is blocking), so task completes
        expect(progress.task.status).toBe("completed")
        expect(progress.goals.find((item) => item.description === "Build passes")?.status).toBe("passed")
        // Advisory goal stays pending but doesn't block completion
        expect(progress.goals.find((item) => item.description === "Nice to have")?.status).toBe("pending")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("dispatches with the configured executor when registered", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    const calls: Array<{ sessionID: string; prompt: string; priority?: "high" | "normal" | "low" }> = []
    const codex: ExecutorAdapter = {
      capabilities() {
        return {
          submit: true,
          status: true,
          abort: true,
          delivery: true,
          resume: true,
          events: true,
        }
      },
      async submit(input: { sessionID: string; prompt: string; priority?: "high" | "normal" | "low" }) {
        calls.push(input)
        return {
          sessionID: input.sessionID,
          queueTaskID: Identifier.ascending("task"),
        }
      },
      async status(queueTaskID: string) {
        return {
          queueTaskID,
          status: "queued",
          error: null,
        }
      },
      async abort() {
        return true
      },
      async delivery() {
        return {
          summary: "done",
          diffs: [],
        }
      },
      async resume(input: { sessionID: string; message: string; priority?: "high" | "normal" | "low" }) {
        return this.submit({
          sessionID: input.sessionID,
          prompt: input.message,
          priority: input.priority,
        })
      },
      async *events() {},
    }
    ExecutorRegistry.register("codex", codex)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          executor: "codex",
        })

        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.run?.executor).toBe("codex")
        expect(progress.run?.status).toBe("accepted")

        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).get(),
        )
        expect(run?.executor).toBe("codex")
        expect(run?.executor_ref?.queue_task_id).toBeTruthy()
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.prompt).toContain("update the landing page hero section copy")
  })

  test("persists task-specific spec metadata and stage routing", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(PlannerService, "initial").mockResolvedValue({
      summary: "Compiled plan",
      prompt: "Execute the compiled plan",
      goals: [
        {
          description: "Implement the requested change",
          criteria: "Checks pass.",
          priority: "blocking",
        },
      ],
      metadata: {
        strategy: "initial",
        steps: ["Spec", "Plan", "Verify"],
        stage_sources: {
          spec: {
            requested: "executor",
            resolved: "executor",
            executor: "codex",
          },
          plan: {
            requested: "executor",
            resolved: "executor",
            executor: "codex",
          },
          evaluation: {
            requested: "hybrid",
            resolved: "opencorvus",
            fallback_reason: "hybrid evaluation is not implemented yet",
          },
        },
        spec: {
          summary: "Task spec",
          source: {
            requested: "executor",
            resolved: "executor",
            executor: "codex",
          },
        },
        spec_analysis: {
          expanded_spec: "# Scope\n\nTask-specific spec body",
          ambiguities: [],
          questions: [],
          goals: [],
          risk_areas: [],
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
      status: "queued",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          routing: {
            spec: "executor",
            plan: "executor",
            evaluation: "hybrid",
          },
        })

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        const plan = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).get(),
        )
        const taskMeta = task?.metadata as any
        const planMeta = plan?.metadata as any

        expect(typeof taskMeta?.spec?.file).toBe("string")
        expect(existsSync(String(taskMeta?.spec?.file))).toBe(true)
        expect(taskMeta?.stage_sources?.plan?.resolved).toBe("executor")
        expect(taskMeta?.routing).toEqual({
          spec: "executor",
          plan: "executor",
          evaluation: "hybrid",
        })
        expect(planMeta?.spec?.file).toBe(taskMeta?.spec?.file)
      },
    })
  })
})
