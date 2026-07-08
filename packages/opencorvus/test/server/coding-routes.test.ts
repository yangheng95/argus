import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { SessionTable } from "../../src/session/session.sql"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { TaskQueueService } from "../../src/scheduler/task-queue-service"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionPromptState } from "../../src/session/prompt/state"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_REQUIRED_TOOLS } from "../../src/coding-assistant/session"
import { deriveTitle } from "../../src/title/derive"
import { Identifier } from "../../src/id/id"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { installControlModel } from "../workspace/mock-control-model"
import { expectNoProcessErrors } from "../fixture/process-errors"

const PROMPT_ASYNC_TEST_CONFIG = { model: "mock-control/control" } as const

async function waitUntil(assertion: () => boolean, label: string, inactivityMs = 500): Promise<void> {
  const started = Date.now()
  while (Date.now() - started <= inactivityMs) {
    if (assertion()) return
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function importCurrentProjectRightSidebarChildWithForeignParent(input: {
  directory: string
  parentID: string
  title: string
}): Promise<string> {
  let sessionID = ""
  await Instance.provide({
    directory: input.directory,
    fn: async () => {
      const time = Date.now()
      const child: Session.Info = {
        id: Identifier.descending("session"),
        slug: `coding-cross-parent-${Math.random().toString(36).slice(2)}`,
        projectID: Instance.project.id,
        directory: input.directory,
        parentID: input.parentID,
        title: input.title,
        version: "test",
        kind: "assistant",
        metadata: { codingAssistant: { surface: "right-sidebar" } },
        time: {
          created: time,
          updated: time,
        },
      }
      await Session.importSnapshot({ info: child, messages: [] })
      sessionID = child.id
    },
  })
  return sessionID
}

describe("coding assistant routes", () => {
  afterEach(async () => {
    mock.restore()
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
  }, 15_000)

  test("lists only right sidebar assistant sessions from the current project directory", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    let listedID = ""
    let otherDirectoryID = ""
    await Instance.provide({
      directory: second.path,
      fn: async () => {
        otherDirectoryID = (
          await Session.create({
            kind: "assistant",
            title: "other directory",
            metadata: { codingAssistant: { surface: "right-sidebar" } },
          })
        ).id
      },
    })

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        listedID = (
          await Session.create({
            kind: "assistant",
            title: "listed",
            metadata: { codingAssistant: { surface: "right-sidebar" } },
          })
        ).id
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

        const queryScoped = await app.request(`/coding/sessions?directory=${encodeURIComponent(second.path)}`, {
          method: "GET",
        })
        expect(queryScoped.status).toBe(200)
        const queryBody = (await queryScoped.json()) as { sessions: Session.Info[] }
        expect(queryBody.sessions.map((session) => session.id)).toEqual([otherDirectoryID])
      },
    })
  }, 15_000)

  test("coding session routes reject current-project right sidebar sessions with a foreign parent chain", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    let foreignParentID = ""
    await Instance.provide({
      directory: second.path,
      fn: async () => {
        foreignParentID = (await Session.create({ kind: "assistant", title: "foreign coding parent" })).id
      },
    })

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        const valid = await Session.create({
          kind: "assistant",
          title: "valid right sidebar",
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        })
        const pollutedID = await importCurrentProjectRightSidebarChildWithForeignParent({
          directory: first.path,
          parentID: foreignParentID,
          title: "polluted right sidebar",
        })
        const app = Server.App()
        const headers = {
          "content-type": "application/json",
          "x-opencorvus-directory": first.path,
        }

        const listed = await app.request("/coding/sessions?limit=1", { method: "GET", headers })
        expect(listed.status).toBe(200)
        const listedBody = (await listed.json()) as { sessions: Session.Info[] }
        expect(listedBody.sessions.map((session) => session.id)).toEqual([valid.id])

        const claim = await app.request(`/coding/session/${pollutedID}`, { method: "GET", headers })
        expect(claim.status).toBe(404)

        const rename = await app.request(`/coding/session/${pollutedID}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: "renamed polluted session" }),
        })
        expect(rename.status).toBe(404)

        const stop = await app.request(`/coding/session/${pollutedID}/abort`, { method: "POST", headers })
        expect(stop.status).toBe(404)

        const selection = await app.request(`/coding/session/${pollutedID}/selection`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ taskID: null }),
        })
        expect(selection.status).toBe(404)

        const remove = await app.request(`/coding/session/${pollutedID}`, { method: "DELETE", headers })
        expect(remove.status).toBe(404)
      },
    })
  })

  test("lists right sidebar assistant sessions with search and cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await Session.create({
          kind: "assistant",
          title: "Alpha assistant",
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        })
        const second = await Session.create({
          kind: "assistant",
          title: "Beta assistant",
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        })
        const app = Server.App()

        const searched = await app.request("/coding/sessions?search=Beta", {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(searched.status).toBe(200)
        const searchedBody = (await searched.json()) as { sessions: Session.Info[] }
        expect(searchedBody.sessions.map((session) => session.id)).toEqual([second.id])

        const expectedOrder = [first, second].sort(
          (a, b) => b.time.updated - a.time.updated || b.id.localeCompare(a.id),
        )
        const firstPage = await app.request("/coding/sessions?limit=1", {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(firstPage.status).toBe(200)
        const firstBody = (await firstPage.json()) as {
          sessions: Session.Info[]
          nextCursor?: { updated: number; sessionID: string }
        }
        expect(firstBody.sessions).toHaveLength(1)
        expect(firstBody.sessions[0].id).toBe(expectedOrder[0].id)
        expect(firstBody.nextCursor).toEqual({
          updated: expectedOrder[0].time.updated,
          sessionID: expectedOrder[0].id,
        })

        const cursor = new URLSearchParams({
          limit: "1",
          cursorUpdated: String(firstBody.nextCursor!.updated),
          cursorSessionID: firstBody.nextCursor!.sessionID,
        })
        const secondPage = await app.request(`/coding/sessions?${cursor.toString()}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(secondPage.status).toBe(200)
        const secondBody = (await secondPage.json()) as { sessions: Session.Info[] }
        expect(secondBody.sessions.map((session) => session.id)).toEqual([expectedOrder[1].id])
      },
    })
  })

  test("rejects half coding session cursors and paginates same-timestamp sessions by sessionID", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const alpha = await Session.create({
          kind: "assistant",
          title: "Alpha assistant",
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        })
        const beta = await Session.create({
          kind: "assistant",
          title: "Beta assistant",
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        })
        const gamma = await Session.create({
          kind: "assistant",
          title: "Gamma assistant",
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        })
        const fixedUpdated = Date.now() + 10_000
        Database.use((db) => {
          for (const session of [alpha, beta, gamma]) {
            db.update(SessionTable).set({ time_updated: fixedUpdated }).where(eq(SessionTable.id, session.id)).run()
          }
        })

        const app = Server.App()
        const onlyUpdated = await app.request(`/coding/sessions?cursorUpdated=${fixedUpdated}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(onlyUpdated.status).toBe(400)

        const onlySession = await app.request(`/coding/sessions?cursorSessionID=${encodeURIComponent(beta.id)}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(onlySession.status).toBe(400)

        const expectedOrder = [alpha.id, beta.id, gamma.id].sort((left, right) => right.localeCompare(left))
        const firstPage = await app.request("/coding/sessions?limit=2", {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(firstPage.status).toBe(200)
        const firstBody = (await firstPage.json()) as {
          sessions: Session.Info[]
          nextCursor?: { updated: number; sessionID: string }
        }
        expect(firstBody.sessions.map((session) => session.id)).toEqual(expectedOrder.slice(0, 2))
        expect(firstBody.nextCursor).toEqual({
          updated: fixedUpdated,
          sessionID: expectedOrder[1],
        })

        const cursor = new URLSearchParams({
          limit: "2",
          cursorUpdated: String(firstBody.nextCursor!.updated),
          cursorSessionID: firstBody.nextCursor!.sessionID,
        })
        const secondPage = await app.request(`/coding/sessions?${cursor.toString()}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(secondPage.status).toBe(200)
        const secondBody = (await secondPage.json()) as { sessions: Session.Info[]; nextCursor?: unknown }
        expect(secondBody.sessions.map((session) => session.id)).toEqual(expectedOrder.slice(2))
        expect(secondBody.nextCursor).toBeUndefined()
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
          db
            .insert(EngineTaskTable)
            .values({
              id: otherProjectTaskID,
              project_id: Instance.project.id,
              title: "Other project task",
              request: "other project",
              source: "test",
            })
            .run(),
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
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "Current project task",
              request: "current project",
              source: "test",
            })
            .run(),
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

        const otherDirectorySession = await Session.createNext({
          kind: "root",
          directory: second.path,
          title: "Other directory root",
        })
        const sameProjectOtherDirectoryTaskID = "task_same_project_other_directory"
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: sameProjectOtherDirectoryTaskID,
              project_id: Instance.project.id,
              session_id: otherDirectorySession.id,
              title: "Same project other directory task",
              request: "same project other directory",
              source: "test",
            })
            .run(),
        )
        const crossDirectory = await app.request(`/coding/session/${session.id}/selection`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": first.path,
          },
          body: JSON.stringify({ taskID: sameProjectOtherDirectoryTaskID }),
        })
        expect(crossDirectory.status).toBe(404)
        expect((await Session.get(session.id)).metadata).toEqual({
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

  test("updates, stops, and deletes only project-bound right sidebar sessions", async () => {
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
        const beforeUpdated = session.time.updated
        const plain = await Session.create({ kind: "assistant", title: "plain assistant" })

        const renamed = await app.request(`/coding/session/${session.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ title: "Renamed assistant" }),
        })
        expect(renamed.status).toBe(200)
        const renamedBody = (await renamed.json()) as { session: Session.Info }
        expect(renamedBody.session.title).toBe("Renamed assistant")
        expect(renamedBody.session.time.updated).toBeGreaterThanOrEqual(beforeUpdated)

        const taskID = Identifier.ascending("task")
        const queuedAt = Date.now()
        Database.use((db) =>
          db
            .insert(TaskQueueTable)
            .values({
              id: taskID,
              session_id: session.id,
              prompt: "queued assistant work",
              priority: "normal",
              status: "queued",
              source: "session.prompt_async",
              metadata: {
                kind: "session_prompt",
                input: {
                  parts: [{ type: "text", text: "queued assistant work" }],
                },
              },
              time_created: queuedAt,
              time_updated: queuedAt,
            })
            .run(),
        )
        const stopped = await app.request(`/coding/session/${session.id}/abort`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(stopped.status).toBe(200)
        await waitUntil(
          () =>
            Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, taskID)).get())
              ?.status === "failed",
          "coding assistant queued task failure",
        )
        const queueRow = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, taskID)).get(),
        )
        expect(queueRow?.status).toBe("failed")
        expect(queueRow?.error_message).toBe("coding assistant stopped")

        const plainRename = await app.request(`/coding/session/${plain.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ title: "Should not rename" }),
        })
        expect(plainRename.status).toBe(404)
        expect((await Session.get(plain.id)).title).toBe("plain assistant")

        const deleted = await app.request(`/coding/session/${session.id}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(deleted.status).toBe(200)

        const claimDeleted = await app.request(`/coding/session/${session.id}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(claimDeleted.status).toBe(404)
      },
    })
  })

  test("delete waits for active right sidebar prompt to finish before removing the session", async () => {
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
        const { session } = (await created.json()) as { session: Session.Info }
        const abort = SessionPromptState.start(session.id, tmp.path)
        if (!abort) throw new Error("expected active prompt state")
        let cancelled = false
        abort.addEventListener("abort", () => {
          cancelled = true
        })

        await expectNoProcessErrors(async () => {
          const deletedPromise = app.request(`/coding/session/${session.id}`, {
            method: "DELETE",
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          await waitUntil(() => cancelled, "coding session cancellation")
          const beforeFinish = await Promise.race([
            deletedPromise.then(() => "resolved" as const),
            Bun.sleep(50).then(() => "pending" as const),
          ])
          try {
            expect(beforeFinish).toBe("pending")
          } finally {
            SessionPromptState.finish(session.id, abort, tmp.path)
          }
          const deleted = await deletedPromise
          expect(deleted.status).toBe(200)
        })

        expect(SessionPromptState.isActive(session.id, tmp.path)).toBe(false)
        const claimDeleted = await app.request(`/coding/session/${session.id}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(claimDeleted.status).toBe(404)
      },
    })
  })

  test("coding session abort reaches live prompt state after instance disposal", async () => {
    await using tmp = await tmpdir({ git: true })
    let session: Session.Info | undefined
    let abort: AbortSignal | undefined
    let cancelled = false

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
        session = ((await created.json()) as { session: Session.Info }).session
        abort = SessionPromptState.start(session.id, tmp.path)
        if (!abort) throw new Error("expected active prompt state")
        abort.addEventListener("abort", () => {
          cancelled = true
        })
        SessionStatus.set(session.id, { type: "streaming" }, { publish: false })
      },
    })

    await Instance.disposeAll()

    if (!session || !abort) throw new Error("expected coding assistant prompt state")
    const stoppedPromise = Server.App().request(`/coding/session/${session.id}/abort`, {
      method: "POST",
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })
    await waitUntil(() => cancelled, "coding session cancellation after instance disposal", 5_000)
    const beforeFinish = await Promise.race([
      stoppedPromise.then(() => "resolved" as const),
      Bun.sleep(50).then(() => "pending" as const),
    ])
    try {
      expect(beforeFinish).toBe("pending")
    } finally {
      SessionPromptState.finish(session.id, abort, tmp.path)
    }
    const stopped = await stoppedPromise
    expect(stopped.status).toBe(200)
    expect(SessionPromptState.isActive(session.id, tmp.path)).toBe(false)
    expect(SessionStatus.get(session.id)).toEqual({ type: "terminal", reason: "aborted" })
  })

  test("coding session abort reports incomplete cancellation when live prompt state is missing", async () => {
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
        const { session } = (await created.json()) as { session: Session.Info }
        SessionStatus.set(session.id, { type: "streaming" }, { publish: false })
        try {
          const stopped = await app.request(`/coding/session/${session.id}/abort`, {
            method: "POST",
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(stopped.status).toBe(409)
          expect(await stopped.json()).toMatchObject({
            name: "TaskCancellationIncompleteError",
            data: {
              handle: "SessionPrompt.cancel",
            },
          })
          expect(SessionStatus.get(session.id)).toEqual({ type: "streaming" })
        } finally {
          SessionStatus.set(session.id, { type: "idle" }, { publish: false })
        }
      },
    })
  })

  test("delete preserves right sidebar session when live prompt cancellation is incomplete", async () => {
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
        const { session } = (await created.json()) as { session: Session.Info }
        SessionStatus.set(session.id, { type: "streaming" }, { publish: false })
        try {
          const deleted = await app.request(`/coding/session/${session.id}`, {
            method: "DELETE",
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(deleted.status).toBe(409)
          expect(await deleted.json()).toMatchObject({
            name: "TaskCancellationIncompleteError",
            data: {
              handle: "EngineService.deleteSession",
            },
          })
          expect((await Session.get(session.id)).id).toBe(session.id)
        } finally {
          SessionStatus.set(session.id, { type: "idle" }, { publish: false })
        }
      },
    })
  })

  test("canonical prompt_async enables project team tools for right sidebar sessions", async () => {
    await using tmp = await tmpdir({ git: true, config: PROMPT_ASYNC_TEST_CONFIG })
    installControlModel()

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
        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, taskID)).get())
        expect(row?.metadata.input).toMatchObject({
          agent: "coding-assistant",
          tools: { panel: true },
          extra: { surface: "right-sidebar" },
        })
        await TaskQueueService.runNow()
      },
    })
  })

  test("first prompt titles right sidebar sessions from user text without overwriting manual rename", async () => {
    await using tmp = await tmpdir({ git: true, config: PROMPT_ASYNC_TEST_CONFIG })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(SessionPrompt, "loop").mockResolvedValue({ info: {} as never, parts: [] } as never)
        const app = Server.App()
        const created = await app.request("/coding/session", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const { session } = (await created.json()) as { session: Session.Info }
        const firstPrompt =
          "Investigate the failing title projection across Coding Assistant and Mission Control surfaces so it matches task titles exactly"

        const prompted = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            parts: [{ type: "text", text: firstPrompt }],
          }),
        })
        expect(prompted.status).toBe(202)
        expect((await Session.get(session.id)).title).toBe(deriveTitle(firstPrompt))

        const manualCreated = await app.request("/coding/session", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const { session: manualSession } = (await manualCreated.json()) as { session: Session.Info }
        const renamed = await app.request(`/coding/session/${manualSession.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ title: "Manual assistant title" }),
        })
        expect(renamed.status).toBe(200)

        const manualPrompted = await app.request(`/session/${manualSession.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            parts: [{ type: "text", text: "This must not replace the manual title" }],
          }),
        })
        expect(manualPrompted.status).toBe(202)
        expect((await Session.get(manualSession.id)).title).toBe("Manual assistant title")
        await TaskQueueService.runNow()
      },
    })
  })

  test("right sidebar prompt overlay overrides agent, tool, prompt, and source spoofing", async () => {
    await using tmp = await tmpdir({ git: true, config: PROMPT_ASYNC_TEST_CONFIG })
    installControlModel()

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
        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, taskID)).get())
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
        await TaskQueueService.runNow()

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
        const body = (await syncPrompt.json()) as {
          info: {
            agent?: string
            system?: string
            systemMode?: string
            tools?: Record<string, boolean>
            extra?: Record<string, unknown>
          }
        }
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
  }, 15_000)
})
