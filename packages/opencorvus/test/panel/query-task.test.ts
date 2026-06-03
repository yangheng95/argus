import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { PanelTool } from "../../src/tool/panel"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { PanelActionSchema } from "../../src/panel/capability"
import * as engine from "../../src/engine"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * Spec: gateway-mission-split-2026-05-28.md.
 *
 * `panel.query_task` is a structured batch reconciliation surface for
 * agents (mission, control). It MUST:
 *   - return JSON, not markdown prose (distinct from view_board)
 *   - keep 1:1 result rows with input taskIDs (errors as { taskID, error })
 *   - cap input at 50 IDs (Zod schema rejection)
 *   - optionally include children via metadata.parent_task_id index
 */
describe("panel.query_task action schema", () => {
  test("rejects empty taskIDs list", () => {
    const result = PanelActionSchema.safeParse({ action: "query_task", taskIDs: [] })
    expect(result.success).toBe(false)
  })

  test("rejects more than 50 taskIDs", () => {
    const taskIDs = Array.from({ length: 51 }, (_, i) => `task_${i}`)
    const result = PanelActionSchema.safeParse({ action: "query_task", taskIDs })
    expect(result.success).toBe(false)
  })

  test("accepts 1-50 taskIDs and optional flags", () => {
    const result = PanelActionSchema.safeParse({
      action: "query_task",
      taskIDs: ["task_a"],
      includeChildren: true,
      includeInteractions: true,
    })
    expect(result.success).toBe(true)
  })
})

describe("panel.query_task execution", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  async function runQuery(input: { taskIDs: string[]; includeChildren?: boolean; includeInteractions?: boolean }) {
    let parsed: { tasks: Array<Record<string, unknown>> } | undefined
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PanelTool.init()
        const result = await tool.execute(
          { action: "query_task", ...input },
          {
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            agent: "control",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel" },
          },
        )
        parsed = JSON.parse(result.output) as { tasks: Array<Record<string, unknown>> }
      },
    })
    return parsed!
  }

  test("returns structured JSON with 1:1 row alignment to input taskIDs", async () => {
    const getBoardSpy = spyOn(EngineService, "getBoard").mockImplementation(async (taskID: string) => ({
      task: {
        id: taskID,
        title: `Title for ${taskID}`,
        status: "active" as const,
        time: { created: 100, updated: 200, started: 150 },
      },
    }) as any)
    const out = await runQuery({ taskIDs: ["task_1", "task_2"] })
    expect(out.tasks).toHaveLength(2)
    expect(out.tasks[0]?.taskID).toBe("task_1")
    expect(out.tasks[0]?.title).toBe("Title for task_1")
    expect(out.tasks[0]?.status).toBe("active")
    expect(out.tasks[0]?.created).toBe(100)
    expect(out.tasks[0]?.started).toBe(150)
    expect(out.tasks[1]?.taskID).toBe("task_2")
    expect(getBoardSpy).toHaveBeenCalledTimes(2)
  })

  test("surfaces per-task errors without breaking the batch", async () => {
    spyOn(EngineService, "getBoard").mockImplementation(async (taskID: string) => {
      if (taskID === "task_bad") throw new Error("Task not found: task_bad")
      return {
        task: {
          id: taskID,
          title: "ok",
          status: "completed" as const,
          time: { created: 1, updated: 2 },
        },
      } as any
    })
    const out = await runQuery({ taskIDs: ["task_ok", "task_bad"] })
    expect(out.tasks).toHaveLength(2)
    expect(out.tasks[0]?.status).toBe("completed")
    expect(out.tasks[1]?.error).toBe("Task not found: task_bad")
    expect(out.tasks[1]?.taskID).toBe("task_bad")
  })

  test("includes evaluation + acceptance when present on board", async () => {
    spyOn(EngineService, "getBoard").mockImplementation(async (taskID: string) => ({
      task: { id: taskID, title: "t", status: "completed" as const, time: { created: 1, updated: 2, completed: 5 } },
      evaluation: { verdict: "accepted", summary: "all checks passed" },
      acceptance: { summary: "delivered v1" },
    }) as any)
    const out = await runQuery({ taskIDs: ["task_done"] })
    expect(out.tasks[0]?.evaluation).toEqual({ verdict: "accepted", summary: "all checks passed" })
    expect(out.tasks[0]?.acceptance).toEqual({ summary: "delivered v1" })
    expect(out.tasks[0]?.completed).toBe(5)
  })

  test("includeChildren=true populates children via findChildrenOfTask", async () => {
    spyOn(EngineService, "getBoard").mockImplementation(async (taskID: string) => ({
      task: { id: taskID, title: "p", status: "completed" as const, time: { created: 1, updated: 2 } },
    }) as any)
    spyOn(engine, "findChildrenOfTask").mockReturnValue(["child_1", "child_2"])
    const out = await runQuery({ taskIDs: ["task_parent"], includeChildren: true })
    expect(out.tasks[0]?.children).toEqual(["child_1", "child_2"])
  })

  test("includeChildren omitted means no children field on output", async () => {
    spyOn(EngineService, "getBoard").mockImplementation(async (taskID: string) => ({
      task: { id: taskID, title: "p", status: "completed" as const, time: { created: 1, updated: 2 } },
    }) as any)
    const out = await runQuery({ taskIDs: ["task_parent"] })
    expect(out.tasks[0]?.children).toBeUndefined()
  })

  test("includeInteractions counts pending interactions only", async () => {
    spyOn(EngineService, "getBoard").mockImplementation(async (taskID: string) => ({
      task: { id: taskID, title: "t", status: "active" as const, time: { created: 1, updated: 2 } },
      interactions: [
        { id: "i_1", status: "pending" },
        { id: "i_2", status: "answered" },
        { id: "i_3", status: "pending" },
      ],
    }) as any)
    const out = await runQuery({ taskIDs: ["task_with_q"], includeInteractions: true })
    expect(out.tasks[0]?.pendingInteractions).toBe(2)
  })
})
