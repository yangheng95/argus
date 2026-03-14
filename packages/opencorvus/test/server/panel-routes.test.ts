import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { OrchestratorService } from "../../src/orchestrator/service"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
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
        expect(names).not.toContain("create_session")
        expect(names).not.toContain("delete_session")
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
          session_id?: string
          local_action?: { type: string; executor?: string }
        }
        expect(body.kind).toBe("panel_response")
        expect(body.session_id).toBeUndefined()
        expect(body.local_action?.type).toBe("set_executor")
        expect(body.local_action?.executor).toBe("codex")
      },
    })
  })

  test("POST /panel/message writes structured control logs", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()
    const requestID = `req_panel_log_${Date.now()}`

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
            request_id: requestID,
            metadata: {
              executor: "codex",
              ui_context: "engine_bar",
            },
          }),
        })

        expect(response.status).toBe(200)
        await Bun.sleep(50)

        const logs = await app.request("/log/tail?n=500", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(logs.status).toBe(200)
        const body = await logs.json() as { lines: string[] }
        const requestLine = body.lines.find((line) =>
          line.includes("service=control-message") &&
          line.includes("panel request received") &&
          line.includes(requestID),
        )
        const resultLine = body.lines.find((line) =>
          line.includes("service=control-message") &&
          line.includes("panel request completed") &&
          line.includes(requestID),
        )

        expect(requestLine).toBeDefined()
        expect(requestLine).toContain(`"request_id":"${requestID}"`)
        expect(requestLine).toContain(`"ui_context":"engine_bar"`)
        expect(resultLine).toBeDefined()
        expect(resultLine).toContain(`"kind":"panel_response"`)
        expect(resultLine).toContain(`"local_action":{"type":"set_executor","executor":"codex"}`)
        expect(resultLine).not.toContain(`"session_id":`)
      },
    })
  })

  test("POST /panel/message/stream returns a task-first response for session-management requests", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/panel/message/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            surface: "panel",
            text: "Create new session",
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.text()
        const events = body
          .split(/\r?\n\r?\n/)
          .flatMap((block) => {
            const data = block
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n")
            if (!data) return []
            return [JSON.parse(data) as { type: string; delta?: string; result?: { message?: string } }]
          })

        expect(events.some((item) => item.type === "message_delta" && item.delta?.includes("only exposes tasks"))).toBe(true)
        expect(events.at(-1)?.type).toBe("done")
        expect(events.at(-1)?.result?.message).toContain("only exposes tasks")
      },
    })
  })

  test("POST /panel/message rejects panel session management requests", async () => {
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
            text: "Create new session",
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
          kind: string
          message: string
        }
        const sessions = [...Session.list({ roots: true })].filter((item) => !item.title.startsWith("Control ("))

        expect(body.kind).toBe("panel_response")
        expect(body.message).toContain("only exposes tasks")
        expect(sessions).toHaveLength(0)
      },
    })
  })

  test("POST /panel/message rejects sessionID in desktop panel requests", async () => {
    await using tmp = await tmpdir({ git: true })

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
            text: "hello",
            sessionID: "session_forbidden",
          }),
        })

        expect(response.status).toBe(400)
      },
    })
  })

  test("POST /panel/message does not create a task session without explicit permission", async () => {
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
            text: "Fix the login race condition",
            allow_create: false,
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
          kind: string
          message: string
        }
        const sessions = [...Session.list({ roots: true })].filter((item) => !item.title.startsWith("Control ("))

        expect(body.kind).toBe("panel_response")
        expect(body.message).not.toContain("Task accepted:")
        expect(sessions).toHaveLength(0)
      },
    })
  })

  test("panel knowledge memory resolves taskID through the linked task session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "Remember panel task context",
          source: "panel",
        })
        const task = await OrchestratorService.getTask(taskID)
        if (!task.sessionID) throw new Error("task missing linked session")
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
          sessionID: task.sessionID,
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

        const taskList = await app.request(`/panel/knowledge/memory?taskID=${taskID}`, {
          headers: baseHeaders,
        })
        expect(taskList.status).toBe(200)
        const taskBody = await taskList.json() as Array<{ title: string; kind: string }>
        expect(taskBody.some((item) => item.title === "Session episode" && item.kind === "episode")).toBe(true)

        const search = await app.request("/panel/knowledge/memory/search", {
          method: "POST",
          headers: {
            ...baseHeaders,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query: "feature panel-session-memory validating session",
            taskID,
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
