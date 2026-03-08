import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { OrchestratorGoalTable, OrchestratorRunTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { WorkbenchBriefSnapshotTable, WorkbenchPreferenceTable, WorkbenchTaskNoteTable } from "../../src/workbench/workbench.sql"
import { WorkbenchService } from "../../src/workbench/service"
import { Instance } from "../../src/project/instance"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("workbench.service", () => {
  let llm: string | undefined

  beforeEach(() => {
    llm = process.env.OPENCORVUS_WORKBENCH_LLM
    process.env.OPENCORVUS_WORKBENCH_LLM = "0"
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
      },
    })
  })

  test("stores free-form preference without command syntax", async () => {
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
        expect(result.kind).toBe("preference")
        const prefs = Database.use((db) =>
          db.select().from(WorkbenchPreferenceTable).where(eq(WorkbenchPreferenceTable.user_id, "U-NAT")).all(),
        )
        expect(prefs.some((item) => item.key === "style" && item.value === "concise")).toBe(true)
        expect(prefs.some((item) => item.key === "lockfile_policy" && item.value === "avoid_changes")).toBe(true)
      },
    })
  })

  test("adds goal and plan hint from task messages", async () => {
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
          text: "/goal add regression coverage",
          source: "slack",
        })
        await OrchestratorService.handleTaskMessage(taskID, {
          text: "/plan keep the diff small",
          source: "slack",
        })
        const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get())!
        const goals = Database.use((db) =>
          db.select().from(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.plan_version_id, task.active_plan_version_id!)).all(),
        )
        const notes = Database.use((db) => db.select().from(WorkbenchTaskNoteTable).where(eq(WorkbenchTaskNoteTable.task_id, taskID)).all())
        expect(goals.some((item) => item.description === "add regression coverage")).toBe(true)
        const added = goals.find((item) => item.description === "add regression coverage")
        expect((added?.metadata as { check_selector?: string[] } | null | undefined)?.check_selector).toContain("test")
        expect(notes.some((item) => item.kind === "plan_hint")).toBe(true)
      },
    })
  })

  test("stores free-form plan hint without command syntax", async () => {
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
        expect(result.kind).toBe("plan")
        const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get())!
        const notes = Database.use((db) => db.select().from(WorkbenchTaskNoteTable).where(eq(WorkbenchTaskNoteTable.task_id, taskID)).all())
        expect(notes.some((item) => item.kind === "plan_hint")).toBe(true)
        expect(task.active_plan_version_id).toBeTruthy()
      },
    })
  })

  test("compiles assistant brief snapshot", async () => {
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
              user: "U2",
            },
          },
        })
        await OrchestratorService.handleTaskMessage(taskID, {
          text: "/pref style=concise",
          source: "slack",
          user_id: "U2",
        })
        await OrchestratorService.handleTaskMessage(taskID, {
          text: "Remember to avoid lockfile changes",
          source: "slack",
          user_id: "U2",
        })
        const run = Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).get())!
        const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get())!
        const brief = WorkbenchService.compileBrief({
          taskID,
          runID: run.id,
          planVersionID: task.active_plan_version_id!,
          sessionID: task.session_id!,
        })
        expect(brief.content).toContain("User preferences:")
        expect(brief.content).toContain("Recent task notes:")
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
          text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
          source: "slack",
          user_id: "U3",
        })
        await OrchestratorService.handleTaskMessage(taskID, {
          text: "Let's keep the diff small and do this incrementally.",
          source: "slack",
          user_id: "U3",
        })
        const board = WorkbenchService.compileBoard({ taskID })
        expect(board.lanes.find((lane) => lane.id === "preferences")?.cards.length).toBeGreaterThan(0)
        expect(board.lanes.find((lane) => lane.id === "staging")?.cards.length).toBeGreaterThan(0)
        expect(board.lanes.find((lane) => lane.id === "notes")?.cards.length).toBeGreaterThan(0)
        expect(board.brief.content).toContain("User preferences:")
      },
    })
  })

  test("compiles board with api user-scoped preferences without slack metadata", async () => {
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
        expect(board.lanes.find((lane) => lane.id === "preferences")?.cards.some((card) => card.title === "style")).toBe(true)
        expect(board.brief.content).toContain("lockfile_policy: avoid_changes")
      },
    })
  })
})
