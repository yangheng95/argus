import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("DecisionLog type & interface", () => {
  test("createDecisionLog returns reader + writer interface", () => {
    const log = createDecisionLog("task_test_1")
    expect(typeof log.append).toBe("function")
    expect(typeof log.read).toBe("function")
    expect(typeof log.readByKey).toBe("function")
    expect(typeof log.toPromptSection).toBe("function")
    expect(typeof log.phasePromptSectionForGoal).toBe("function")
  })

  test("DecisionLog is scoped by taskID", () => {
    const log1 = createDecisionLog("task_1")
    const log2 = createDecisionLog("task_2")
    expect(log1).not.toBe(log2)
  })

  test("DecisionEntry type has all required fields", () => {
    const entry: import("../../src/decision-log").DecisionEntry = {
      id: "dlog_test",
      taskID: "task_1",
      goalID: null,
      phase: "requirements",
      key: "runtime",
      value: "Bun",
      reason: "PRD specifies Bun as runtime",
      timeCreated: Date.now(),
    }
    expect(entry.key).toBe("runtime")
    expect(entry.goalID).toBeNull()
  })
})

describe("DecisionLog.toPromptSection truncation", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>
  let projectID = ""
  let taskID = ""

  function seed() {
    const now = Date.now()
    Database.use((db) =>
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        vcs: "git",
        name: "DecisionLog Truncation Test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run(),
    )
    Database.use((db) =>
      db.insert(OrchestratorTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "trunc test",
        request: "decision log truncation",
        status: "active",
        priority: "normal",
        time_created: now,
        time_updated: now,
      }).run(),
    )
  }

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    const stamp = Date.now().toString(16)
    projectID = `project_dl_${stamp}`
    taskID = `tsk_${stamp}dl`
    seed()
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("returns all entries when no limit is set", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        for (let i = 0; i < 5; i++) {
          log.append({ phase: "architect", key: `key_${i}`, value: `v${i}`, reason: `r${i}` })
        }
        const section = log.toPromptSection()
        expect(section).toContain("5 entries")
        for (let i = 0; i < 5; i++) expect(section).toContain(`key_${i}`)
        expect(section).not.toContain("older omitted")
      },
    })
  })

  test("keeps the latest N entries and notes how many older were omitted", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        for (let i = 0; i < 30; i++) {
          log.append({ phase: "architect", key: `key_${i}`, value: `v${i}`, reason: `r${i}` })
          if (i % 5 === 4) await new Promise((r) => setTimeout(r, 2))
        }
        const section = log.toPromptSection({ limit: 10 })
        expect(section).toContain("latest 10 of 30")
        expect(section).toContain("20 older omitted")
        // Latest keys (20..29) must be present; oldest (0..9) must NOT.
        for (let i = 20; i < 30; i++) expect(section).toContain(`key_${i}`)
        for (let i = 0; i < 10; i++) expect(section).not.toContain(`- **key_${i}**`)
      },
    })
  })

  test("no omission note when entries already fit under limit", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        log.append({ phase: "requirements", key: "runtime", value: "Bun", reason: "PRD" })
        const section = log.toPromptSection({ limit: 10 })
        expect(section).toContain("1 entries")
        expect(section).not.toContain("omitted")
      },
    })
  })

  test("returns empty string when no decisions exist", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        expect(log.toPromptSection()).toBe("")
        expect(log.toPromptSection({ limit: 5 })).toBe("")
      },
    })
  })
})
