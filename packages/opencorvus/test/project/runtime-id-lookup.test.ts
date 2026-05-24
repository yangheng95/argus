import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { RuntimePathIDLookup } from "../../src/project/runtime-id-lookup"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

const now = 1700000000000

function seedProject(projectID: string) {
  Database.use((db) =>
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: "C:/repo",
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
    db.insert(EngineTaskTable)
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
    db.insert(EngineGoalTable)
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
    db.insert(EngineArtifactTable)
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

function seedSession(projectID: string, sessionID: string) {
  Database.use((db) =>
    db.insert(SessionTable)
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

  test("resolves full and short task, goal, run, and session segments", () => {
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

    expect(RuntimePathIDLookup.task(taskID)).toBe(taskID)
    expect(RuntimePathIDLookup.task(Identifier.shortPath(taskID))).toBe(taskID)
    expect(RuntimePathIDLookup.task(Identifier.legacyShortPath(taskID))).toBe(taskID)
    expect(RuntimePathIDLookup.goal(goalID)).toBe(goalID)
    expect(RuntimePathIDLookup.goal(Identifier.shortPath(goalID))).toBe(goalID)
    expect(RuntimePathIDLookup.goal(Identifier.legacyShortPath(goalID))).toBe(goalID)
    expect(RuntimePathIDLookup.run(runID)).toBe(runID)
    expect(RuntimePathIDLookup.run(Identifier.shortPath(runID))).toBe(runID)
    expect(RuntimePathIDLookup.run(Identifier.legacyShortPath(runID))).toBe(runID)
    expect(RuntimePathIDLookup.session(sessionID)).toBe(sessionID)
    expect(RuntimePathIDLookup.session(Identifier.shortPath(sessionID))).toBe(sessionID)
    expect(RuntimePathIDLookup.session(Identifier.legacyShortPath(sessionID))).toBe(sessionID)
  })

  test("new short segments resolve same-millisecond IDs and legacy short segments reject ambiguity", () => {
    const projectID = Identifier.create("workspace", false, now)
    const firstTaskID = Identifier.create("task", false, now + 10)
    const secondTaskID = Identifier.create("task", false, now + 10)

    seedProject(projectID)
    seedTask(projectID, firstTaskID)
    seedTask(projectID, secondTaskID)

    expect(RuntimePathIDLookup.task(firstTaskID)).toBe(firstTaskID)
    expect(RuntimePathIDLookup.task(Identifier.shortPath(firstTaskID))).toBe(firstTaskID)
    expect(RuntimePathIDLookup.task(Identifier.shortPath(secondTaskID))).toBe(secondTaskID)
    expect(() => RuntimePathIDLookup.task(Identifier.legacyShortPath(firstTaskID))).toThrow("matched")
  })
})
