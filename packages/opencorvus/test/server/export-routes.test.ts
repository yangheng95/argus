import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function createSessionWithText(title: string, text: string) {
  const session = await Session.create({ kind: "root", title })
  const message = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test-model" },
  } as any)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: session.id,
    messageID: message.id,
    type: "text",
    text,
  })
  return session
}

describe("session export routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("GET /export/session/:sessionID rejects sessions outside the active project", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const app = Server.App()
    let oneSessionID = ""
    let twoSessionID = ""

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        const session = await createSessionWithText("project-a-export-title", "project-a-export-message")
        oneSessionID = session.id
      },
    })
    await Instance.provide({
      directory: two.path,
      fn: async () => {
        const session = await createSessionWithText("project-b-export-title", "project-b-export-secret")
        twoSessionID = session.id
      },
    })

    const foreign = await app.request(`/export/session/${twoSessionID}`, {
      headers: {
        "x-opencorvus-directory": one.path,
      },
    })

    expect(foreign.status).toBe(404)
    const foreignText = await foreign.text()
    expect(foreignText).not.toContain("project-b-export-title")
    expect(foreignText).not.toContain("project-b-export-secret")

    const own = await app.request(`/export/session/${oneSessionID}`, {
      headers: {
        "x-opencorvus-directory": one.path,
      },
    })

    expect(own.status).toBe(200)
    const ownBody = (await own.json()) as {
      session: { id: string; title: string }
      messages: Array<{ info: { sessionID: string }; parts: Array<{ type: string; text?: string }> }>
    }
    expect(ownBody.session).toMatchObject({
      id: oneSessionID,
      title: "project-a-export-title",
    })
    expect(JSON.stringify(ownBody.messages)).toContain("project-a-export-message")
    expect(JSON.stringify(ownBody.messages)).not.toContain("project-b-export-secret")
  }, 30_000)
})
