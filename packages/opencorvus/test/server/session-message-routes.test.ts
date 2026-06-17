import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function createSessionMessage(input: { title: string; text: string }) {
  const session = await Session.create({ kind: "root", title: input.title })
  const message = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test-model" },
  } as any)
  const part = await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: session.id,
    messageID: message.id,
    type: "text",
    text: input.text,
  })
  return { sessionID: session.id, messageID: message.id, partID: part.id }
}

describe("session message routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test(
    "message and part routes reject resources outside the active project",
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
            title: "project-a-message-owner",
            text: "project-a-visible-message",
          })
        },
      })
      await Instance.provide({
        directory: two.path,
        fn: async () => {
          twoIDs = await createSessionMessage({
            title: "project-b-message-owner",
            text: "project-b-secret-message",
          })
        },
      })

      const foreignList = await app.request(`/session/${twoIDs.sessionID}/message`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(foreignList.status).toBe(404)
      expect(await foreignList.text()).not.toContain("project-b-secret-message")

      const wrongSessionGet = await app.request(`/session/${oneIDs.sessionID}/message/${twoIDs.messageID}`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(wrongSessionGet.status).toBe(404)
      expect(await wrongSessionGet.text()).not.toContain("project-b-secret-message")

      const foreignSessionGet = await app.request(`/session/${twoIDs.sessionID}/message/${twoIDs.messageID}`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(foreignSessionGet.status).toBe(404)
      expect(await foreignSessionGet.text()).not.toContain("project-b-secret-message")

      const foreignPartPatch = await app.request(
        `/session/${oneIDs.sessionID}/message/${oneIDs.messageID}/part/${twoIDs.partID}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": one.path,
          },
          body: JSON.stringify({
            id: twoIDs.partID,
            sessionID: oneIDs.sessionID,
            messageID: oneIDs.messageID,
            type: "text",
            text: "project-a-forged-overwrite",
          }),
        },
      )
      expect(foreignPartPatch.status).toBe(404)

      const ownPatch = await app.request(
        `/session/${oneIDs.sessionID}/message/${oneIDs.messageID}/part/${oneIDs.partID}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": one.path,
          },
          body: JSON.stringify({
            id: oneIDs.partID,
            sessionID: oneIDs.sessionID,
            messageID: oneIDs.messageID,
            type: "text",
            text: "project-a-updated-message",
          }),
        },
      )
      expect(ownPatch.status).toBe(200)
      expect(await ownPatch.json()).toMatchObject({ text: "project-a-updated-message" })

      const bOwn = await app.request(`/session/${twoIDs.sessionID}/message/${twoIDs.messageID}`, {
        headers: { "x-opencorvus-directory": two.path },
      })
      expect(bOwn.status).toBe(200)
      const bOwnBody = JSON.stringify(await bOwn.json())
      expect(bOwnBody).toContain("project-b-secret-message")
      expect(bOwnBody).not.toContain("project-a-forged-overwrite")

      const aOwn = await app.request(`/session/${oneIDs.sessionID}/message/${oneIDs.messageID}`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(aOwn.status).toBe(200)
      expect(JSON.stringify(await aOwn.json())).toContain("project-a-updated-message")
    },
    30_000,
  )
})
