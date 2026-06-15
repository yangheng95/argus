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
 * Spec: gateway-mission-split-2026-05-28.md §1 (Panel = coordination set).
 *
 * Mission is a coordinator, not an executor. The panel surface is shared
 * with control_agent + panel_ui, but the `mission` actor may only invoke a
 * bounded coordination set (dispatch / reconcile / follow-up / interaction /
 * stop). Every other panel action is denied at the host boundary so a stray
 * prompt or future config slip cannot give mission replan/goal-edit/session
 * powers — those belong to the orchestrator and the desktop panel_ui.
 */
const MISSION_ALLOWED = [
  ["create_task", { request: "do something", allow_create: true, queue: false }],
  ["query_task", { taskIDs: ["task_1"] }],
  ["view_board", {}],
  ["view_plan", { taskID: "task_1" }],
  ["view_tasks", {}],
  ["send_task_message", { taskID: "task_1", text: "hi", source: "mission" }],
  ["cancel_task", { taskID: "task_1" }],
  ["reply_interaction", { interactionID: "i_1" }],
  ["reject_interaction", { interactionID: "i_1" }],
] as const

const MISSION_DENIED = [
  ["retry_task", { taskID: "task_1" }],
  ["replan_task", { taskID: "task_1" }],
  ["update_checks", { taskID: "task_1" }],
  ["update_goal", { goalID: "g_1", description: "x", acceptance_specs: [{}] }],
  ["delete_goal", { goalID: "g_1" }],
  ["fork_session", { sessionID: "s_1" }],
  ["delete_session", { sessionID: "s_1" }],
  ["create_session", {}],
  ["set_executor", { executor: "opencorvus" }],
  ["select_task", { taskID: "task_1" }],
  ["select_session", { sessionID: "s_1" }],
] as const

function isWhitelistDenied(error: unknown): boolean {
  return error instanceof Error && /not permitted for the mission agent/i.test(error.message)
}

describe("panel actor whitelist — mission", () => {
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

  // Allowed actions: the host guard must let them through. They may still
  // fail downstream (no stubbed EngineService / no mission session), so we
  // only assert the failure is NOT the whitelist denial.
  test.each(MISSION_ALLOWED)("mission is allowed %s (not blocked by the actor guard)", async (action, params) => {
    const { error } = await call({ action, ...params }, "mission")
    expect(isWhitelistDenied(error)).toBe(false)
  })

  test.each(MISSION_DENIED)("mission is denied %s", async (action, params) => {
    const { error } = await call({ action, ...params }, "mission")
    expect(error).toBeInstanceOf(Error)
    expect(isWhitelistDenied(error)).toBe(true)
  })

  test("control_agent retains access to actions denied for mission", async () => {
    spyOn(EngineService, "getProjectBoard").mockResolvedValue({ tasks: [] } as any)
    const { error } = await call({ action: "view_tasks" }, "control")
    expect(error).toBeUndefined()
  })

  test("panel_ui (route fake context) retains access to actions denied for mission", async () => {
    spyOn(EngineService, "getProjectBoard").mockResolvedValue({ tasks: [] } as any)
    const { error } = await call({ action: "view_tasks" }, "gateway") // route fake uses "gateway" agent name → panel_ui
    expect(error).toBeUndefined()
  })

  test("panel_ui is not subject to the mission whitelist (can replan_task)", async () => {
    spyOn(EngineService, "retryTask").mockResolvedValue(undefined as any)
    const { error } = await call({ action: "replan_task", taskID: "task_1" }, "gateway")
    expect(isWhitelistDenied(error)).toBe(false)
  })
})
