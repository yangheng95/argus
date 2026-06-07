import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_REQUIRED_TOOLS } from "../../src/coding-assistant/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("coding assistant routes", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("creates and claims project-bound right sidebar assistant sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/coding/session", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(created.status).toBe(201)
        const body = (await created.json()) as { session: Session.Info }
        expect(body.session.kind).toBe("assistant")
        expect(body.session.directory).toBe(tmp.path)
        expect(body.session.metadata).toEqual({ codingAssistant: { surface: "right-sidebar" } })

        const claimed = await app.request(`/coding/session/${body.session.id}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(claimed.status).toBe(200)
        const claimBody = (await claimed.json()) as { session: Session.Info }
        expect(claimBody.session.id).toBe(body.session.id)
      },
    })
  })

  test("lists only right sidebar assistant sessions from the current project directory", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    let listedID = ""
    let otherDirectoryID = ""
    await Instance.provide({
      directory: first.path,
      fn: async () => {
        listedID = (await Session.create({
          kind: "assistant",
          title: "listed",
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        })).id
        otherDirectoryID = (await Session.createNext({
          kind: "assistant",
          directory: second.path,
          title: "other directory",
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        })).id
        await Session.create({ kind: "assistant", title: "plain assistant" })
        const app = Server.App()
        const response = await app.request("/coding/sessions", {
          method: "GET",
          headers: {
            "x-opencorvus-directory": first.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { sessions: Session.Info[] }
        const ids = body.sessions.map((session) => session.id)
        expect(ids).toContain(listedID)
        expect(ids).not.toContain(otherDirectoryID)
        expect(body.sessions.every((session) => session.metadata?.codingAssistant)).toBe(true)
      },
    })
  })

  test("persists selected task metadata for the current right sidebar project only", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    let otherProjectTaskID = ""
    await Instance.provide({
      directory: second.path,
      fn: async () => {
        otherProjectTaskID = "task_other_project"
        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: otherProjectTaskID,
            project_id: Instance.project.id,
            title: "Other project task",
            request: "other project",
            source: "test",
          }).run(),
        )
      },
    })

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/coding/session", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": first.path,
          },
        })
        const { session } = (await created.json()) as { session: Session.Info }
        const taskID = "task_current_project"
        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Current project task",
            request: "current project",
            source: "test",
          }).run(),
        )

        const selected = await app.request(`/coding/session/${session.id}/selection`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": first.path,
          },
          body: JSON.stringify({ taskID }),
        })
        expect(selected.status).toBe(200)
        const body = (await selected.json()) as { session: Session.Info }
        expect(body.session.metadata).toEqual({
          codingAssistant: {
            surface: "right-sidebar",
            selectedTaskID: taskID,
          },
        })

        const crossProject = await app.request(`/coding/session/${session.id}/selection`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": first.path,
          },
          body: JSON.stringify({ taskID: otherProjectTaskID }),
        })
        expect(crossProject.status).toBe(404)
      },
    })
  })

  test("rejects non-right-sidebar sessions and retired direct message routes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const app = Server.App()

        const claim = await app.request(`/coding/session/${session.id}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(claim.status).toBe(404)

        const stream = await app.request("/coding/message/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ text: "retired" }),
        })
        expect(stream.status).toBe(404)

        const messages = await app.request(`/coding/session/${session.id}/messages`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(messages.status).toBe(404)
      },
    })
  })

  test("canonical prompt_async enables project team tools for right sidebar sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/coding/session", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const { session } = (await created.json()) as { session: Session.Info }

        const prompted = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            parts: [{ type: "text", text: "what is the project status?" }],
          }),
        })

        expect(prompted.status).toBe(202)
        const { taskID } = (await prompted.json()) as { taskID: string }
        const row = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, taskID)).get(),
        )
        expect(row?.metadata.input).toMatchObject({
          agent: "coding-assistant",
          tools: { panel: true },
          extra: { surface: "right-sidebar" },
        })
      },
    })
  })

  test("right sidebar prompt overlay overrides agent, tool, prompt, and source spoofing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/coding/session", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const { session } = (await created.json()) as { session: Session.Info }

        const prompted = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "control",
            system: "malicious complete replacement",
            systemMode: "complete",
            tools: {
              panel: false,
              question: false,
              bash: false,
              read: false,
              glob: false,
              search_code: false,
              edit: false,
              write: false,
              apply_patch: false,
              todoread: false,
              todowrite: false,
            },
            extra: { source: "mission" },
            parts: [{ type: "text", text: "spoof route" }],
          }),
        })

        expect(prompted.status).toBe(202)
        const { taskID } = (await prompted.json()) as { taskID: string }
        const row = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, taskID)).get(),
        )
        expect(row?.metadata.input).toMatchObject({
          agent: "coding-assistant",
          extra: {
            surface: "right-sidebar",
            source: "right-sidebar-assistant",
          },
        })
        expect(row?.metadata.input.system).toBeUndefined()
        expect(row?.metadata.input.systemMode).toBeUndefined()
        for (const tool of RIGHT_SIDEBAR_CODING_ASSISTANT_REQUIRED_TOOLS) {
          expect(row?.metadata.input.tools?.[tool]).toBe(true)
        }

        const syncPrompt = await app.request(`/session/${session.id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "mission",
            model: { providerID: "test", modelID: "test-model" },
            noReply: true,
            system: "sync malicious complete replacement",
            systemMode: "complete",
            tools: {
              panel: false,
              question: false,
              bash: false,
              edit: false,
              write: false,
              apply_patch: false,
            },
            extra: { source: "panel" },
            parts: [{ type: "text", text: "sync spoof" }],
          }),
        })
        expect(syncPrompt.status).toBe(200)
        const body = (await syncPrompt.json()) as { info: { agent?: string; system?: string; systemMode?: string; tools?: Record<string, boolean>; extra?: Record<string, unknown> } }
        expect(body.info.agent).toBe("coding-assistant")
        expect(body.info.system).toBeUndefined()
        expect(body.info.systemMode).toBeUndefined()
        for (const tool of RIGHT_SIDEBAR_CODING_ASSISTANT_REQUIRED_TOOLS) {
          expect(body.info.tools?.[tool]).toBe(true)
        }
        expect(body.info.extra).toMatchObject({
          surface: "right-sidebar",
          source: "right-sidebar-assistant",
        })
      },
    })
  })
})
