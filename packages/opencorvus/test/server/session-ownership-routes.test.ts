import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionControlRecordTable } from "../../src/session/session.sql"
import { Database, and, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const TEST_MODEL = { providerID: "test", modelID: "test-model" }

async function createSessionMessage(input: { title: string; text: string }) {
  const session = await Session.create({ kind: "root", title: input.title })
  const message = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: TEST_MODEL,
  } as any)
  const part = await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: session.id,
    messageID: message.id,
    type: "text",
    text: input.text,
  })
  return { session, message, part }
}

function manualSummarizeControlCount(sessionID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(SessionControlRecordTable)
      .where(
        and(
          eq(SessionControlRecordTable.session_id, sessionID),
          eq(SessionControlRecordTable.kind, "manual_summarize"),
        ),
      )
      .all(),
  ).length
}

function jsonRequest(headers: Record<string, string>, body: unknown) {
  return {
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

describe("session route active-project ownership", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test(
    "remaining session routes reject sessions outside the active project before side effects",
    async () => {
      await using one = await tmpdir({ git: true })
      await using two = await tmpdir({ git: true })
      const app = Server.App()
      let oneIDs!: Awaited<ReturnType<typeof createSessionMessage>>
      let twoIDs!: Awaited<ReturnType<typeof createSessionMessage>>

      await Instance.provide({
        directory: one.path,
        fn: async () => {
          oneIDs = await createSessionMessage({
            title: "project-a-owned-session",
            text: "project-a-owned-message",
          })
        },
      })
      await Instance.provide({
        directory: two.path,
        fn: async () => {
          twoIDs = await createSessionMessage({
            title: "project-b-secret-title",
            text: "project-b-secret-message",
          })
        },
      })

      const projectAHeaders = { "x-opencorvus-directory": one.path }
      const foreignGets = [
        `/session/${twoIDs.session.id}`,
        `/session/${twoIDs.session.id}/children`,
        `/session/${twoIDs.session.id}/events`,
        `/session/${twoIDs.session.id}/conversation`,
        `/session/${twoIDs.session.id}/diff?messageID=${twoIDs.message.id}`,
        `/session/${twoIDs.session.id}/prompt_async/task_missing_ownership`,
      ]

      for (const route of foreignGets) {
        const response = await app.request(route, { headers: projectAHeaders })
        expect(response.status, route).toBe(404)
        const text = await response.text()
        expect(text).not.toContain("project-b-secret-title")
        expect(text).not.toContain("project-b-secret-message")
      }

      const foreignPosts: Array<{ route: string; body: unknown }> = [
        {
          route: `/session/${twoIDs.session.id}/init`,
          body: { providerID: "test", modelID: "test-model", messageID: twoIDs.message.id },
        },
        { route: `/session/${twoIDs.session.id}/fork`, body: {} },
        {
          route: `/session/${twoIDs.session.id}/summarize`,
          body: { providerID: "test", modelID: "test-model" },
        },
        {
          route: `/session/${twoIDs.session.id}/message`,
          body: { model: TEST_MODEL, noReply: true, parts: [{ type: "text", text: "foreign sync prompt" }] },
        },
        {
          route: `/session/${twoIDs.session.id}/prompt_async`,
          body: { model: TEST_MODEL, parts: [{ type: "text", text: "foreign async prompt" }] },
        },
        {
          route: `/session/${twoIDs.session.id}/command`,
          body: { command: "missing-command", arguments: "foreign command" },
        },
        {
          route: `/session/${twoIDs.session.id}/shell`,
          body: { agent: "build", command: "echo foreign shell" },
        },
      ]

      for (const { route, body } of foreignPosts) {
        const response = await app.request(route, {
          method: "POST",
          ...jsonRequest(projectAHeaders, body),
        })
        expect(response.status, route).toBe(404)
        const text = await response.text()
        expect(text).not.toContain("project-b-secret-title")
        expect(text).not.toContain("project-b-secret-message")
      }

      const foreignPatch = await app.request(`/session/${twoIDs.session.id}`, {
        method: "PATCH",
        ...jsonRequest(projectAHeaders, { title: "project-a-forged-foreign-title" }),
      })
      expect(foreignPatch.status).toBe(404)

      const foreignAbort = await app.request(`/session/${twoIDs.session.id}/abort`, {
        method: "POST",
        headers: projectAHeaders,
      })
      expect(foreignAbort.status).toBe(404)

      const foreignDelete = await app.request(`/session/${twoIDs.session.id}`, {
        method: "DELETE",
        headers: projectAHeaders,
      })
      expect(foreignDelete.status).toBe(404)

      expect(manualSummarizeControlCount(twoIDs.session.id)).toBe(0)

      const bOwnConversation = await app.request(`/session/${twoIDs.session.id}/conversation`, {
        headers: { "x-opencorvus-directory": two.path },
      })
      expect(bOwnConversation.status).toBe(200)
      const bOwnConversationText = JSON.stringify(await bOwnConversation.json())
      expect(bOwnConversationText).toContain("project-b-secret-title")
      expect(bOwnConversationText).toContain("project-b-secret-message")

      const bOwnGet = await app.request(`/session/${twoIDs.session.id}`, {
        headers: { "x-opencorvus-directory": two.path },
      })
      expect(bOwnGet.status).toBe(200)
      expect(await bOwnGet.json()).toMatchObject({
        id: twoIDs.session.id,
        title: "project-b-secret-title",
      })

      const bAfterForeignPatch = await app.request(`/session/${twoIDs.session.id}`, {
        headers: { "x-opencorvus-directory": two.path },
      })
      expect(await bAfterForeignPatch.json()).toMatchObject({ title: "project-b-secret-title" })

      const aOwnPatch = await app.request(`/session/${oneIDs.session.id}`, {
        method: "PATCH",
        ...jsonRequest({ "x-opencorvus-directory": one.path }, { title: "project-a-updated-title" }),
      })
      expect(aOwnPatch.status).toBe(200)
      expect(await aOwnPatch.json()).toMatchObject({ title: "project-a-updated-title" })
    },
    30_000,
  )
})
