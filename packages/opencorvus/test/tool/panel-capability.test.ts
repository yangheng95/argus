import { expect, test } from "bun:test"
import { panelCapabilities } from "../../src/panel/capability"

test("filters panel-only actions by surface", () => {
  const panel = panelCapabilities("panel")
  const slack = panelCapabilities("slack")

  expect(panel.actions.some((item) => item.action === "set_executor")).toBe(true)
  expect(slack.actions.some((item) => item.action === "set_executor")).toBe(false)
  expect(slack.actions.some((item) => item.action === "view_board")).toBe(true)
})

test("exposes local action metadata and input schemas", () => {
  const panel = panelCapabilities("panel")
  const create = panel.actions.find((item) => item.action === "create_session")
  const select = panel.actions.find((item) => item.action === "select_task")
  const view = panel.actions.find((item) => item.action === "view_plan")
  const task = panel.actions.find((item) => item.action === "create_task")
  const screenshot = panel.actions.find((item) => item.action === "capture_overlay_screenshot")
  const settings = panel.actions.find((item) => item.action === "update_panel_settings")
  const api = panel.actions.find((item) => item.action === "call_panel_api")

  expect(create?.local_action_types).toEqual(["select_session"])
  expect(create?.local_action_surfaces).toEqual(["panel"])
  expect(select?.local_only).toBe(true)
  expect(view?.schema).toMatchObject({
    type: "object",
    required: expect.arrayContaining(["action", "taskID"]),
  })
  expect(task?.schema).toMatchObject({
    properties: {
      checks: {
        type: "object",
      },
      routing: {
        type: "object",
      },
    },
  })
  expect(screenshot?.schema).toMatchObject({
    properties: {
      match: {
        type: "string",
      },
    },
  })
  expect(settings?.schema).toMatchObject({
    properties: {
      sessionID: {
        type: "string",
      },
      settings: {
        type: "object",
      },
    },
  })
  expect(api?.schema).toMatchObject({
    properties: {
      method: {
        enum: ["GET", "POST", "PATCH", "DELETE"],
      },
      path: {
        type: "string",
      },
    },
  })
})
