import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ControlTimeline } from "../../src/control/timeline"
import { Identifier } from "../../src/id/id"
import { OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { installControlModel } from "../control-plane/mock-control-model"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function clarify() {
  spyOn(PlannerService, "initial").mockResolvedValue({
    summary: "Clarify feature",
    prompt: "Ask before executing",
    goals: [
      {
        description: "Clarify the requested change",
        criteria: "The requested change is clearly scoped.",
        priority: "blocking",
      },
    ],
    metadata: {
      strategy: "initial",
      steps: ["Clarify the requested change"],
      clarification: {
        reason: "Need clarification before planning.",
        questions: [
          {
            header: "Clarification",
            question: "Which module should this change target?",
          },
        ],
      },
      spec_analysis: undefined,
    },
  })
}

describe("control routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("POST /panel/message persists desktop panel chat in a session", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const sent = await app.request("/panel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            surface: "panel",
            text: "Use executor codex for desktop panel actions and new tasks.",
            metadata: {
              executor: "codex",
              ui_context: "engine_bar",
            },
          }),
        })
        expect(sent.status).toBe(200)
        const created = await sent.json() as {
          session_id?: string
          message: string
        }
        expect(typeof created.session_id).toBe("string")
        expect(created.message).toContain("Executor set to codex")

        const res = await app.request(`/session/${created.session_id}/message`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(res.status).toBe(200)
        const body = await res.json() as Array<{
          info: { role: string }
          parts: Array<{ type: string; text: string }>
        }>
        const texts = body.flatMap((item) =>
          item.parts
            .filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => ({ role: item.info.role, text: part.text })),
        )
        expect(texts.some((item) => item.role === "user" && item.text === "Use executor codex for desktop panel actions and new tasks.")).toBe(true)
        expect(texts.some((item) => item.role === "assistant" && item.text.includes("Executor set to codex"))).toBe(true)

        const timeline = await app.request("/control/timeline?surface=panel", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(timeline.status).toBe(200)
        const entries = await timeline.json() as unknown[]
        expect(entries).toHaveLength(0)
      },
    })
  })

  test("GET /control/timeline returns persisted task-scoped control conversation", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ title: "task-control-session" })
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db.insert(OrchestratorTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            source: "panel",
            title: "task control target",
            request: "task control target",
            status: "queued",
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run(),
        )

        const sent = await app.request("/panel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            surface: "panel",
            taskID,
            text: "Please record this operator note.",
          }),
        })
        expect(sent.status).toBe(200)
        const created = await sent.json() as { task_id?: string }
        expect(created.task_id).toBe(taskID)

        const res = await app.request(`/control/timeline?taskID=${taskID}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(res.status).toBe(200)
        const body = await res.json() as Array<{
          info: { role: string; taskID?: string }
          parts: Array<{ type: string; text: string }>
        }>
        expect(body).toHaveLength(2)
        expect(body[0]?.info.role).toBe("user")
        expect(body[0]?.info.taskID).toBe(taskID)
        expect(body[0]?.parts[0]?.text).toBe("Please record this operator note.")
        expect(body[1]?.info.role).toBe("assistant")
        expect(body[1]?.info.taskID).toBe(taskID)
      },
    })
  })

  test("POST /panel/message reuses the selected panel session", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ title: "panel-selected-session" })

        const sent = await app.request("/panel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            surface: "panel",
            sessionID: session.id,
            text: "Use executor codex for desktop panel actions and new tasks.",
            metadata: {
              executor: "codex",
            },
          }),
        })
        expect(sent.status).toBe(200)
        const body = await sent.json() as { session_id?: string }
        expect(body.session_id).toBe(session.id)

        const res = await app.request(`/session/${session.id}/message`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(res.status).toBe(200)
        const messages = await res.json() as Array<{
          info: { role: string }
          parts: Array<{ type: string; text: string }>
        }>
        const texts = messages.flatMap((item) =>
          item.parts
            .filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => ({ role: item.info.role, text: part.text })),
        )
        expect(texts.some((item) => item.role === "user" && item.text === "Use executor codex for desktop panel actions and new tasks.")).toBe(true)
        expect(texts.some((item) => item.role === "assistant" && item.text.includes("Executor set to codex"))).toBe(true)
      },
    })
  })

  test("GET /control/timeline includes screenshot attachments as file parts", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ControlTimeline.append({
          surface: "panel",
          source: "panel",
          entries: [
            {
              role: "assistant",
              text: "Captured OpenCorvus GUI.",
              metadata: {
                attachments: [
                  {
                    mime: "image/png",
                    filename: "opencorvus-gui.png",
                    url: "data:image/png;base64,aGVsbG8=",
                  },
                ],
              },
            },
          ],
        })

        const app = Server.App()
        const res = await app.request("/control/timeline?surface=panel", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(res.status).toBe(200)
        const body = await res.json() as Array<{
          info: { role: string }
          parts: Array<{ type: string; text?: string; mime?: string; filename?: string }>
        }>
        const message = body.find((item) => item.parts[0]?.text === "Captured OpenCorvus GUI.")
        expect(message).toBeDefined()
        expect(message?.parts[1]).toMatchObject({
          type: "file",
          mime: "image/png",
          filename: "opencorvus-gui.png",
        })
      },
    })
  })
})
