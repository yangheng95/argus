import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { PanelTool } from "../../src/tool/panel"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * Spec: gateway-master-supervisor-2026-05-26.md §2.4.
 *
 * Master is a scheduler, not an executor. The panel surface is shared
 * with control_agent + panel_ui, but master may only invoke create_task
 * and query_task — every other panel action is denied at the host
 * boundary so a stray prompt or future config slip cannot give master
 * retry/cancel/replan/session-management powers.
 */
describe("panel actor whitelist — gateway_master", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  async function call(action: Record<string, unknown>, agent: string) {
    await using tmp = await tmpdir({ git: true })
    let result: unknown
    let error: unknown
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PanelTool.init()
        try {
          result = await tool.execute(action as any, {
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            agent,
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel" },
          })
        } catch (err) {
          error = err
        }
      },
    })
    return { result, error }
  }

  test("gateway_master can call create_task", async () => {
    const stubID = Identifier.ascending("task")
    spyOn(EngineService, "createTask").mockResolvedValue(stubID)
    const { error } = await call(
      { action: "create_task", request: "do something", allow_create: true, queue: false },
      "gateway-master",
    )
    expect(error).toBeUndefined()
  })

  test("gateway_master can call query_task", async () => {
    spyOn(EngineService, "getBoard").mockResolvedValue({
      task: { id: "task_1", title: "t", status: "active", time: { created: 1, updated: 2 } },
    } as any)
    const { error } = await call({ action: "query_task", taskIDs: ["task_1"] }, "gateway-master")
    expect(error).toBeUndefined()
  })

  test.each([
    ["retry_task", { taskID: "task_1" }],
    ["replan_task", { taskID: "task_1" }],
    ["cancel_task", { taskID: "task_1" }],
    ["send_task_message", { taskID: "task_1", text: "hi" }],
    ["reply_interaction", { interactionID: "i_1" }],
    ["reject_interaction", { interactionID: "i_1" }],
    ["update_checks", { taskID: "task_1" }],
    ["update_goal", { goalID: "g_1", description: "x", acceptance_specs: [{}] }],
    ["delete_goal", { goalID: "g_1" }],
    ["fork_session", { sessionID: "s_1" }],
    ["delete_session", { sessionID: "s_1" }],
    ["create_session", {}],
    ["view_plan", { taskID: "task_1" }],
    ["view_board", {}],
    ["view_tasks", {}],
  ])("gateway_master is denied %s", async (action, extraParams) => {
    const { error } = await call({ action, ...extraParams }, "gateway-master")
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toMatch(/not permitted for gateway_master/i)
  })

  test("control_agent retains access to actions denied for gateway_master", async () => {
    spyOn(EngineService, "getProjectBoard").mockResolvedValue({ tasks: [] } as any)
    const { error } = await call({ action: "view_tasks" }, "control")
    expect(error).toBeUndefined()
  })

  test("panel_ui (route fake context) retains access to actions denied for gateway_master", async () => {
    spyOn(EngineService, "getProjectBoard").mockResolvedValue({ tasks: [] } as any)
    const { error } = await call({ action: "view_tasks" }, "gateway") // route fake uses "gateway" agent name
    expect(error).toBeUndefined()
  })
})
