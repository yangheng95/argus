import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { OrchestratorGoalTable, OrchestratorPlanVersionTable, OrchestratorRunTable, OrchestratorSpecSnapshotTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { WorkbenchBriefSnapshotTable, WorkbenchPreferenceTable, WorkbenchTaskNoteTable } from "../../src/workbench/workbench.sql"
import { WorkbenchService } from "../../src/workbench/service"
import { Instance } from "../../src/project/instance"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { PlannerService } from "../../src/planner/service"
import { Session } from "../../src/session/index"
import { SpecService } from "../../src/spec/service"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("workbench.service", () => {
  let llm: string | undefined

  beforeEach(() => {
    llm = process.env.OPENCORVUS_WORKBENCH_LLM
    process.env.OPENCORVUS_WORKBENCH_LLM = "0"
    spyOn(SpecService, "initial").mockResolvedValue({
      summary: "Compiled spec",
      content: "# Scope\n\nImplement feature",
      scope: "Implement feature",
      goals: [
        {
          description: "Implement feature",
          criteria: "Task completed successfully",
          priority: "blocking",
          metadata: {
            check_selector: ["spec_check"],
          },
        },
      ],
      assumptions: [],
      risks: [],
      spec_items: [
        {
          title: "Implement feature",
          description: "Task completed successfully",
          priority: "blocking",
          check_selector: ["spec_check"],
        },
      ],
      evidence_sources: [],
      unresolved_questions: [],
    } as any)
    spyOn(SpecService, "rewrite").mockResolvedValue({
      summary: "Rewritten spec",
      content: "# Scope\n\nImplement feature with the updated operator goals",
      scope: "Implement feature with the updated operator goals",
      goals: [
        {
          description: "Implement feature",
          criteria: "Task completed successfully",
          priority: "blocking",
          metadata: {},
        },
        {
          description: "add regression coverage",
          criteria: "The rewritten specification explicitly captures this operator goal and the delivered implementation satisfies it: add regression coverage",
          priority: "blocking",
          metadata: {
            check_selector: ["spec_check"],
          },
        },
      ],
      assumptions: [],
      risks: [],
      spec_items: [
        {
          title: "Implement feature",
          description: "Task completed successfully",
          priority: "blocking",
          check_selector: [],
        },
      ],
      evidence_sources: [],
      unresolved_questions: [],
    } as any)
    spyOn(PlannerService, "initial").mockResolvedValue({
      summary: "Compiled plan",
      prompt: "Execute the compiled plan",
      metadata: {
        strategy: "initial",
        steps: ["Execute the task"],
        planner: {
          role: "headless_compiler",
          quality: "compiled",
          source: "planner_agent",
          clarification_source: "none",
        },
      },
    } as any)
    spyOn(PlannerService, "replan").mockResolvedValue({
      summary: "Compiled replan",
      prompt: "Execute the compiled replan",
      metadata: {
        strategy: "replan",
        steps: ["Rewrite the specification", "Rebuild the plan", "Execute the task"],
        planner: {
          role: "headless_compiler",
          quality: "compiled",
          source: "planner_agent",
          clarification_source: "none",
        },
      },
    } as any)
  })

  afterEach(async () => {
    if (llm === undefined) delete process.env.OPENCORVUS_WORKBENCH_LLM
    else process.env.OPENCORVUS_WORKBENCH_LLM = llm
    mock.restore()
    await resetDatabase()
  })

  test("stores preference from task message", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
          metadata: {
            slack: {
              user: "U1",
            },
          },
        })
        const result = await OrchestratorService.handleTaskMessage(taskID, {
          text: "/pref style=concise",
          source: "slack",
          user_id: "U1",
        })
        expect(result.kind).toBe("preference")
        const pref = Database.use((db) => db.select().from(WorkbenchPreferenceTable).where(eq(WorkbenchPreferenceTable.user_id, "U1")).get())
        expect(pref?.key).toBe("style")
        expect(pref?.value).toBe("concise")
        expect(pref?.scope).toBe("global")
      },
    })
  })

  test("records free-form preference text as an operator note when intent analysis is unavailable", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
          metadata: {
            slack: {
              user: "U-NAT",
            },
          },
        })
        const result = await OrchestratorService.handleTaskMessage(taskID, {
          text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
          source: "slack",
          user_id: "U-NAT",
        })
        expect(result.kind).toBe("note")
        const prefs = Database.use((db) =>
          db.select().from(WorkbenchPreferenceTable).where(eq(WorkbenchPreferenceTable.user_id, "U-NAT")).all(),
        )
        const notes = Database.use((db) =>
          db.select().from(WorkbenchTaskNoteTable).where(eq(WorkbenchTaskNoteTable.task_id, taskID)).all(),
        )
        expect(prefs).toHaveLength(0)
        expect(notes.some((item) => item.kind === "operator_note")).toBe(true)
      },
    })
  })

  test("stores session preference when explicitly requested", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
        })
        const result = await OrchestratorService.handleTaskMessage(taskID, {
          text: "/pref session style=concise",
          source: "api",
          user_id: "U-SESSION",
        })
        expect(result.kind).toBe("preference")
        const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get())!
        const pref = Database.use((db) =>
          db
            .select()
            .from(WorkbenchPreferenceTable)
            .where(eq(WorkbenchPreferenceTable.task_id, taskID))
            .all()
            .find((item) => item.key === "style"),
        )
        expect(pref?.scope).toBe("session")
        expect(pref?.session_id).toBe(task.session_id)
      },
    })
  })

  test("adds goal and plan hint from task messages", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "abort").mockResolvedValue(true)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
        })
        const goal = await OrchestratorService.handleTaskMessage(taskID, {
          text: "/goal add regression coverage",
          source: "slack",
        })
        await OrchestratorService.handleTaskMessage(taskID, {
          text: "/plan keep the diff small",
          source: "slack",
        })
        const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get())!
        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )
        const specs = Database.use((db) =>
          db.select().from(OrchestratorSpecSnapshotTable).where(eq(OrchestratorSpecSnapshotTable.task_id, taskID)).all(),
        )
        const notes = Database.use((db) => db.select().from(WorkbenchTaskNoteTable).where(eq(WorkbenchTaskNoteTable.task_id, taskID)).all())
        expect(goal.message).toContain("Queued a spec rewrite and replan")
        expect(task.status).toBe("running")
        expect(task.active_plan_version_id).toBe(plans.at(-1)?.id)
        expect(task.active_spec_version_id).toBe(specs.at(-1)?.id)
        expect(plans).toHaveLength(2)
        expect(specs).toHaveLength(2)
        expect(notes.some((item) => item.kind === "goal_update" && item.content === "add regression coverage")).toBe(true)
        expect(notes.some((item) => item.kind === "plan_hint")).toBe(true)
      },
    })
  })

  test("records spec updates from task messages and queues a spec rewrite", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "abort").mockResolvedValue(true)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
        })
        const result = await OrchestratorService.handleTaskMessage(taskID, {
          text: "/spec replace the email flow with a magic-link login requirement",
          source: "api",
        })
        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )
        const specs = Database.use((db) =>
          db.select().from(OrchestratorSpecSnapshotTable).where(eq(OrchestratorSpecSnapshotTable.task_id, taskID)).all(),
        )
        const notes = Database.use((db) =>
          db.select().from(WorkbenchTaskNoteTable).where(eq(WorkbenchTaskNoteTable.task_id, taskID)).all(),
        )

        expect(result.kind).toBe("spec")
        expect(result.message).toContain("Queued a spec rewrite and replan")
        expect(plans).toHaveLength(2)
        expect(specs).toHaveLength(2)
        expect(notes.some((item) => item.kind === "constraint" && item.content.includes("magic-link login"))).toBe(true)
      },
    })
  })

  test("records free-form plan text as an operator note when intent analysis is unavailable", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
        })
        const result = await OrchestratorService.handleTaskMessage(taskID, {
          text: "Let's keep the diff small and do this incrementally.",
          source: "slack",
        })
        const notes = Database.use((db) => db.select().from(WorkbenchTaskNoteTable).where(eq(WorkbenchTaskNoteTable.task_id, taskID)).all())
        expect(result.kind).toBe("note")
        expect(notes.some((item) => item.kind === "operator_note")).toBe(true)
      },
    })
  })

  test("writes resumable task messages into the task session transcript", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
        })
        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )!
        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).get(),
        )!
        const now = Date.now()

        Database.use((db) => {
          db.update(OrchestratorRunTable)
            .set({
              status: "failed",
              time_completed: now,
              time_updated: now,
            })
            .where(eq(OrchestratorRunTable.id, run.id))
            .run()
          db.update(OrchestratorTaskTable)
            .set({
              status: "failed",
              error: "previous run failed",
              time_completed: now,
              time_updated: now,
            })
            .where(eq(OrchestratorTaskTable.id, taskID))
            .run()
        })

        const result = await OrchestratorService.handleTaskMessage(taskID, {
          text: "/plan also update the copy",
          source: "api",
        })
        const msgs = await Session.messages({ sessionID: task.session_id! })
        const last = msgs.findLast((item) => item.info.role === "user")
        const runs = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).all(),
        )

        expect(result.kind).toBe("plan")
        expect(result.should_resume).toBe(true)
        expect(last?.parts.some((part) => part.type === "text" && part.text === "/plan also update the copy")).toBe(true)
        expect(runs.length).toBeGreaterThan(1)
      },
    })
  })

  test("forwards plan hints into the active executor session when resume is available", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    const resume = spyOn(OpencodeExecutor, "resume").mockImplementation(async (input: { sessionID: string; message: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
        })
        const result = await OrchestratorService.handleTaskMessage(taskID, {
          text: "/plan keep the diff small and land tests first",
          source: "api",
        })
        const notes = Database.use((db) =>
          db.select().from(WorkbenchTaskNoteTable).where(eq(WorkbenchTaskNoteTable.task_id, taskID)).all(),
        )

        expect(result.kind).toBe("plan")
        expect(result.message).toContain("forwarded to the active run")
        expect(resume).toHaveBeenCalledTimes(1)
        expect(resume.mock.calls[0]?.[0]).toMatchObject({
          message: "/plan keep the diff small and land tests first",
        })
        expect(notes.some((item) => item.kind === "plan_hint")).toBe(true)
      },
    })
  })

  test("compiles assistant brief snapshot", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const planID = Identifier.ascending("plan")
        const specID = Identifier.ascending("spec")
        const session = await Session.create({ title: "implement feature" })
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              active_spec_version_id: specID,
              active_plan_version_id: planID,
              source: "api",
              title: "implement feature",
              request: "implement feature",
              status: "queued",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "Compiled spec",
              content: "# Scope\n\nImplement feature",
              scope: "Implement feature",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorPlanVersionTable)
            .values({
              id: planID,
              task_id: taskID,
              spec_snapshot_id: specID,
              version: 1,
              status: "active",
              summary: "Compiled plan",
              prompt: "Execute the compiled plan",
              metadata: {
                strategy: "initial",
                steps: ["Execute the task"],
              },
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorGoalTable)
            .values({
              id: Identifier.ascending("goal"),
              task_id: taskID,
              spec_snapshot_id: specID,
              description: "Implement feature",
              criteria: "Task completed successfully",
              priority: "blocking",
              status: "pending",
              order_index: 0,
              metadata: {},
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(WorkbenchPreferenceTable)
            .values({
              id: Identifier.ascending("pref"),
              project_id: Instance.project.id,
              task_id: taskID,
              session_id: session.id,
              user_id: "U2",
              scope: "global",
              key: "lockfile_policy",
              value: "avoid_changes",
              source: "slack",
              confidence: 100,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(WorkbenchTaskNoteTable)
            .values({
              id: Identifier.ascending("note"),
              task_id: taskID,
              kind: "operator_note",
              source: "slack",
              user_id: "U2",
              content: "Keep updates concise.",
              time_created: now,
              time_updated: now,
            })
            .run()
        })
        const brief = WorkbenchService.compileBrief({
          taskID,
          planVersionID: planID,
          sessionID: session.id,
        })
        expect(brief.content).toContain("Global preferences:")
        expect(brief.content).toContain("Recent task notes:")
        expect(brief.content).toContain("A startup checkpoint is captured before the first execution run.")
        expect(brief.content).toContain("The orchestrator may record internal checkpoint commits automatically.")
        expect(brief.content).toContain("use a concise, meaningful message grounded in the task request and plan")
        const snapshot = Database.use((db) =>
          db
            .select()
            .from(WorkbenchBriefSnapshotTable)
            .where(eq(WorkbenchBriefSnapshotTable.task_id, taskID))
            .orderBy(WorkbenchBriefSnapshotTable.time_created)
            .all()
            .at(-1),
        )
        expect(snapshot?.content).toContain("lockfile_policy: avoid_changes")
      },
    })
  })

  test("compiles task board projection", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
          metadata: {
            slack: {
              user: "U3",
            },
          },
        })
        await OrchestratorService.handleTaskMessage(taskID, {
          text: "/pref style=concise",
          source: "slack",
          user_id: "U3",
        })
        await OrchestratorService.handleTaskMessage(taskID, {
          text: "/plan keep the diff small",
          source: "slack",
          user_id: "U3",
        })
        const board = WorkbenchService.compileBoard({ taskID })
        expect(board.lanes.map((lane) => lane.id)).toEqual(["spec", "plan", "goals", "acceptance", "evaluation", "delivery"])
        expect(board.brief.content).toContain("Global preferences:")
        expect(board.brief.content).toContain("Recent task notes:")
      },
    })
  })

  test("brief and board fall back to active spec goals when no active plan exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const specID = Identifier.ascending("spec")
        const session = await Session.create({ title: "spec only task" })
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              active_spec_version_id: specID,
              active_plan_version_id: null,
              source: "api",
              title: "spec only task",
              request: "ship the spec-only path",
              status: "queued",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "Spec only",
              content: "# Scope\n\nSpec-only flow",
              scope: "Spec-only flow",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorGoalTable)
            .values({
              id: Identifier.ascending("goal"),
              task_id: taskID,
              spec_snapshot_id: specID,
              description: "Spec-only goal",
              criteria: "Still visible before plan activation.",
              priority: "blocking",
              status: "pending",
              order_index: 0,
              metadata: {
                check_selector: ["spec_check"],
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        const brief = WorkbenchService.compileBrief({
          taskID,
          sessionID: session.id,
        })
        const board = WorkbenchService.compileBoard({ taskID })

        expect(brief.goals).toHaveLength(1)
        expect(brief.content).toContain("Spec-only goal")
        expect(board.task.activeSpecVersionID).toBe(specID)
        expect(board.plan).toBeUndefined()
        expect(board.lanes.find((lane) => lane.id === "goals")?.cards[0]?.title).toBe("Spec-only goal")
      },
    })
  })

  test("brief and board prioritize the latest task notes", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
        })
        for (const index of Array.from({ length: 8 }, (_, item) => item + 1)) {
          await OrchestratorService.handleTaskMessage(taskID, {
            text: `/plan hint-${index}`,
            source: "api",
          })
        }

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )!
        const run = Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).get())!
        const brief = WorkbenchService.compileBrief({
          taskID,
          runID: run.id,
          planVersionID: task.active_plan_version_id!,
          sessionID: task.session_id!,
        })
        const board = WorkbenchService.compileBoard({ taskID })
        const noteSection = brief.content.split("Recent task notes:\n").at(1)?.split("\n\nRelevant memory:").at(0) ?? brief.content

        expect(noteSection).toMatch(/\[plan_hint\] hint-8(?:\D|$)/)
        expect(noteSection).not.toMatch(/\[plan_hint\] hint-1(?:\D|$)/)
        expect(board.brief.content).toContain("hint-8")
      },
    })
  })

  test("does not infer free-form api preferences when intent analysis is unavailable", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
        })
        await OrchestratorService.handleTaskMessage(taskID, {
          text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
          source: "api",
          user_id: "U-API",
        })
        const board = WorkbenchService.compileBoard({ taskID })
        expect(board.brief.content).not.toContain("style: concise")
        expect(board.brief.content).toContain("Please keep updates concise")
      },
    })
  })

  test("global preferences apply across sessions while session preferences stay local", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async (input: { sessionID: string }) => ({
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const firstTaskID = await OrchestratorService.createTask({
          request: "first feature",
        })
        await OrchestratorService.handleTaskMessage(firstTaskID, {
          text: "/pref style=concise",
          source: "api",
        })
        await OrchestratorService.handleTaskMessage(firstTaskID, {
          text: "/pref session branch_policy=scratch_only",
          source: "api",
        })

        const secondTaskID = await OrchestratorService.createTask({
          request: "second feature",
        })
        const secondTask = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, secondTaskID)).get(),
        )!
        const secondRun = Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, secondTaskID)).get())!
        const brief = WorkbenchService.compileBrief({
          taskID: secondTaskID,
          runID: secondRun.id,
          planVersionID: secondTask.active_plan_version_id!,
          sessionID: secondTask.session_id!,
        })

        expect(brief.content).toContain("style: concise")
        expect(brief.content).not.toContain("branch_policy: scratch_only")
      },
    })
  })
})
