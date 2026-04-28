import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { createWorkflowState, WorkflowRegistry } from "../../src/engine/workflow"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator tools", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("workflow tasks reject task-level build before delivery rework", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_${stamp}`
    const taskID = `tsk_build_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Build workflow contract test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Build workflow contract task",
        request: "Verify workflow task-level build cannot bypass requirements and architect",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build workflow test" })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.build.execute({
          request: "Implement the page directly.",
          reason: "Try to bypass the workflow.",
        }, {} as any)

        expect(result).toContain("rejected task-level build")
        expect(result).toContain("kind=workflow")
        expect(result).toContain("requirements, architect, and per-goal build")
        expect(workflowState.workflowID).toBe("pipeline")
      },
    })
  })
})
