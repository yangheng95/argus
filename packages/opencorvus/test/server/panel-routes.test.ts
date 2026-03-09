import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { installControlModel } from "../control-plane/mock-control-model"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Memory } from "../../src/memory"

Log.init({ print: false })

describe("panel routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("GET /panel/capabilities filters actions by surface", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/panel/capabilities?surface=slack", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
          surface: string
          actions: Array<{
            action: string
            local_only: boolean
            local_action_types?: string[]
          }>
        }
        const names = body.actions.map((item) => item.action)

        expect(body.surface).toBe("slack")
        expect(names).toContain("view_board")
        expect(names).not.toContain("set_executor")
        expect(body.actions.find((item) => item.action === "create_session")?.local_action_types).toEqual(["select_session"])
      },
    })
  })

  test("POST /panel/message proxies to panel control service", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/panel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            surface: "panel",
            text: "Use executor codex for desktop panel actions and new tasks.",
            executor: "opencode",
            metadata: {
              executor: "codex",
              ui_context: "engine_bar",
            },
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
          kind: string
          message: string
          local_action?: { type: string; executor?: string }
        }
        expect(body.kind).toBe("panel_response")
        expect(body.local_action?.type).toBe("set_executor")
        expect(body.local_action?.executor).toBe("codex")
      },
    })
  })

  test("panel knowledge memory respects session-aware recall", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Memory.writeFile({
          title: "Global lesson",
          content: "## Lesson\nSocket Mode must be enabled before the bot will receive events.",
          source: "agent",
          projectId: Instance.project.id,
          kind: "lesson",
        })
        Memory.writeFile({
          title: "Session episode",
          content: "## Notes\nUse feature/panel-session-memory while validating this session only.",
          source: "agent",
          projectId: Instance.project.id,
          kind: "episode",
          scope: "session",
          sessionID: "ses_panel_memory",
        })

        const app = Server.App()
        const baseHeaders = {
          "x-opencorvus-directory": tmp.path,
        }

        const globalList = await app.request("/panel/knowledge/memory", {
          headers: baseHeaders,
        })
        expect(globalList.status).toBe(200)
        const globalBody = await globalList.json() as Array<{ title: string }>
        expect(globalBody.some((item) => item.title === "Global lesson")).toBe(true)
        expect(globalBody.some((item) => item.title === "Session episode")).toBe(false)

        const sessionList = await app.request("/panel/knowledge/memory?sessionID=ses_panel_memory", {
          headers: baseHeaders,
        })
        expect(sessionList.status).toBe(200)
        const sessionBody = await sessionList.json() as Array<{ title: string; kind: string }>
        expect(sessionBody.some((item) => item.title === "Session episode" && item.kind === "episode")).toBe(true)

        const search = await app.request("/panel/knowledge/memory/search", {
          method: "POST",
          headers: {
            ...baseHeaders,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query: "feature panel-session-memory validating session",
            sessionID: "ses_panel_memory",
            limit: 10,
          }),
        })
        expect(search.status).toBe(200)
        const searchBody = await search.json() as Array<{ fileTitle: string; kind: string; scope: string }>
        expect(searchBody.some((item) => item.fileTitle === "Session episode" && item.scope === "session")).toBe(true)
      },
    })
  })
})
