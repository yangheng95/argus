import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { RuntimePathIDLookup } from "../../src/project/runtime-id-lookup"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

const now = 1700000000000

function seedProject(projectID: string, worktree = "C:/repo") {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree,
        name: "runtime id lookup",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function seedTask(projectID: string, taskID: string) {
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "runtime lookup",
        request: "lookup",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function seedGoal(taskID: string, goalID: string) {
  Database.use((db) =>
    db
      .insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: taskID,
        title: "lookup goal",
        slug: "lookup-goal",
        objective: "resolve path segment",
        acceptance_specs: [],
        owned_paths: [],
        depends_on: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "test",
        order_index: 0,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function seedRun(taskID: string, runID: string) {
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: "run-running",
        payload: { status: "running" },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function seedRunUpdateArtifact(taskID: string, runID: string, artifactID: string) {
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: artifactID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: "run-completed",
        payload: { status: "completed" },
        time_created: now + 100,
        time_updated: now + 100,
      })
      .run(),
  )
}

function seedGoalRunAttempt(taskID: string, goalID: string, runID: string, goalRunID: string) {
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: goalRunID,
        task_id: taskID,
        run_id: runID,
        goal_run_id: goalRunID,
        kind: "goal_run_attempt",
        label: "goal-run-running",
        payload: { goal_id: goalID, status: "running" },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function seedSession(projectID: string, sessionID: string) {
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: "lookup-session",
        directory: "C:/repo",
        title: "lookup session",
        version: "1.0.0",
        kind: "assistant",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

describe("RuntimePathIDLookup", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("resolves full IDs and 8-character directory keys for task, goal, run, and session segments", () => {
    const projectID = Identifier.create("workspace", false, now)
    const taskID = Identifier.create("task", false, now + 1)
    const goalID = Identifier.create("goal", false, now + 2)
    const runID = Identifier.create("run", false, now + 3)
    const sessionID = Identifier.create("session", false, now + 4)

    seedProject(projectID)
    seedTask(projectID, taskID)
    seedGoal(taskID, goalID)
    seedRun(taskID, runID)
    seedSession(projectID, sessionID)

    expect(RuntimePathIDLookup.task(projectID, taskID)).toBe(taskID)
    expect(RuntimePathIDLookup.task(projectID, Identifier.directoryKey(taskID))).toBe(taskID)
    expect(RuntimePathIDLookup.goal(projectID, goalID)).toBe(goalID)
    expect(RuntimePathIDLookup.goal(projectID, Identifier.directoryKey(goalID))).toBe(goalID)
    expect(RuntimePathIDLookup.run(projectID, runID)).toBe(runID)
    expect(RuntimePathIDLookup.run(projectID, Identifier.directoryKey(runID))).toBe(runID)
    expect(RuntimePathIDLookup.session(projectID, sessionID)).toBe(sessionID)
    expect(RuntimePathIDLookup.session(projectID, Identifier.directoryKey(sessionID))).toBe(sessionID)
    expect(RuntimePathIDLookup.resolve("task", projectID, Identifier.directoryKey(taskID))).toBe(taskID)
    expect(() =>
      RuntimePathIDLookup.session(projectID, Identifier.scopedDirectoryKey("task-session", `${taskID}:${sessionID}`)),
    ).toThrow("matched 0 database rows")
  })

  test("run lookup resolves logical run ids and rejects append-only artifact ids", () => {
    const projectID = Identifier.create("workspace", false, now)
    const taskID = Identifier.create("task", false, now + 30)
    const runID = Identifier.create("run", false, now + 31)
    const updateArtifactID = Identifier.create("run", false, now + 32)

    seedProject(projectID)
    seedTask(projectID, taskID)
    seedRun(taskID, runID)
    seedRunUpdateArtifact(taskID, runID, updateArtifactID)

    expect(RuntimePathIDLookup.run(projectID, runID)).toBe(runID)
    expect(RuntimePathIDLookup.run(projectID, Identifier.directoryKey(runID))).toBe(runID)
    expect(() => RuntimePathIDLookup.run(projectID, updateArtifactID)).toThrow("matched 0 database rows")
    expect(() => RuntimePathIDLookup.run(projectID, Identifier.directoryKey(updateArtifactID))).toThrow(
      "matched 0 database rows",
    )
  })

  test("resolves fanout and composite runtime keys", () => {
    const projectID = Identifier.create("workspace", false, now)
    const taskID = Identifier.create("task", false, now + 40)
    const goalID = Identifier.create("goal", false, now + 41)
    const runID = Identifier.create("run", false, now + 42)
    const sessionID = Identifier.create("session", false, now + 43)
    const goalRunID = Identifier.create("goal_run", false, now + 44)

    seedProject(projectID)
    seedSession(projectID, sessionID)
    seedTask(projectID, taskID)
    Database.use((db) =>
      db.update(EngineTaskTable).set({ session_id: sessionID }).where(eq(EngineTaskTable.id, taskID)).run(),
    )
    seedGoal(taskID, goalID)
    seedRun(taskID, runID)
    seedGoalRunAttempt(taskID, goalID, runID, goalRunID)

    const taskKey = Identifier.directoryKey(taskID)
    expect(RuntimePathIDLookup.resolveFanout("task", projectID, taskKey.slice(0, 2), taskKey.slice(2))).toBe(taskID)
    const taskSessionKey = Identifier.scopedDirectoryKey("task-session", `${taskID}:${sessionID}`)
    expect(RuntimePathIDLookup.taskSession(projectID, taskSessionKey)).toEqual({ taskID, sessionID })
    const goalRunKey = Identifier.scopedDirectoryKey("goal-run", `${taskID}:${goalID}:${runID}`)
    expect(RuntimePathIDLookup.goalRun(projectID, goalRunKey)).toEqual({ taskID, goalID, runID })
    expect(() => RuntimePathIDLookup.directoryKeyFromFanout("x", "short")).toThrow("Invalid runtime fanout path")
  })

  test("directory keys resolve same-millisecond IDs and legacy timestamp prefixes are rejected", () => {
    const projectID = Identifier.create("workspace", false, now)
    const firstTaskID = Identifier.create("task", false, now + 10)
    const secondTaskID = Identifier.create("task", false, now + 10)

    seedProject(projectID)
    seedTask(projectID, firstTaskID)
    seedTask(projectID, secondTaskID)

    expect(RuntimePathIDLookup.task(projectID, firstTaskID)).toBe(firstTaskID)
    expect(RuntimePathIDLookup.task(projectID, Identifier.directoryKey(firstTaskID))).toBe(firstTaskID)
    expect(RuntimePathIDLookup.task(projectID, Identifier.directoryKey(secondTaskID))).toBe(secondTaskID)
    expect(() => RuntimePathIDLookup.task(projectID, Identifier.shortPath(firstTaskID))).toThrow(
      "matched 0 database rows",
    )
    expect(() => RuntimePathIDLookup.task(projectID, firstTaskID.split("_").at(-1)!.slice(0, 8))).toThrow(
      "matched 0 database rows",
    )
  })

  test("directory-key lookup is scoped to the project", () => {
    const firstProjectID = Identifier.create("workspace", false, now)
    const secondProjectID = Identifier.create("workspace", false, now + 1)
    const firstTaskID = Identifier.create("task", false, now + 20)
    const secondTaskID = Identifier.create("task", false, now + 21)

    seedProject(firstProjectID, "C:/repo-a")
    seedProject(secondProjectID, "C:/repo-b")
    seedTask(firstProjectID, firstTaskID)
    seedTask(secondProjectID, secondTaskID)

    expect(RuntimePathIDLookup.task(firstProjectID, Identifier.directoryKey(firstTaskID))).toBe(firstTaskID)
    expect(RuntimePathIDLookup.task(secondProjectID, Identifier.directoryKey(secondTaskID))).toBe(secondTaskID)
    expect(() => RuntimePathIDLookup.task(firstProjectID, Identifier.directoryKey(secondTaskID))).toThrow(
      "matched 0 database rows",
    )
  })
})
