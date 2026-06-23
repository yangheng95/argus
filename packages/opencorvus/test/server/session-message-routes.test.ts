import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function addSessionMessage(sessionID: string, text: string) {
  const message = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test-model" },
  } as any)
  const part = await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID,
    messageID: message.id,
    type: "text",
    text,
  })
  return { messageID: message.id, partID: part.id }
}

async function createSessionMessage(input: { title: string; text: string }) {
  const session = await Session.create({ kind: "root", title: input.title })
  const { messageID, partID } = await addSessionMessage(session.id, input.text)
  return { sessionID: session.id, messageID, partID }
}

describe("session message routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("message and part routes reject resources outside the active project", async () => {
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
  }, 30_000)

  test("message and part delete routes require complete row ownership before publishing removal events", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const app = Server.App()
    const events: string[] = []
    const unsubscribers: Array<() => void> = []
    let oneBase!: Awaited<ReturnType<typeof createSessionMessage>>
    let oneOther!: Awaited<ReturnType<typeof addSessionMessage>>
    let oneDeletePart!: Awaited<ReturnType<typeof addSessionMessage>>
    let oneDeleteMessage!: Awaited<ReturnType<typeof addSessionMessage>>
    let twoIDs!: Awaited<ReturnType<typeof createSessionMessage>>

    try {
      await Instance.provide({
        directory: one.path,
        fn: async () => {
          oneBase = await createSessionMessage({
            title: "project-a-delete-owner",
            text: "project-a-base-message",
          })
          oneOther = await addSessionMessage(oneBase.sessionID, "project-a-other-message")
          oneDeletePart = await addSessionMessage(oneBase.sessionID, "project-a-delete-part-message")
          oneDeleteMessage = await addSessionMessage(oneBase.sessionID, "project-a-delete-message")
          unsubscribers.push(
            Bus.subscribe(Message.Event.Removed, (event) => {
              events.push(`message:${event.properties.sessionID}:${event.properties.messageID}`)
            }),
            Bus.subscribe(Message.Event.PartRemoved, (event) => {
              events.push(`part:${event.properties.sessionID}:${event.properties.messageID}:${event.properties.partID}`)
            }),
          )
        },
      })
      await Instance.provide({
        directory: two.path,
        fn: async () => {
          twoIDs = await createSessionMessage({
            title: "project-b-delete-owner",
            text: "project-b-delete-secret",
          })
        },
      })

      const missingMessageID = Identifier.ascending("message")
      const missingPartID = Identifier.ascending("part")
      const projectAHeaders = { "x-opencorvus-directory": one.path }
      const rejectedDeletes = [
        `/session/${oneBase.sessionID}/message/${missingMessageID}`,
        `/session/${oneBase.sessionID}/message/${oneBase.messageID}/part/${missingPartID}`,
        `/session/${oneBase.sessionID}/message/${twoIDs.messageID}`,
        `/session/${oneBase.sessionID}/message/${oneBase.messageID}/part/${twoIDs.partID}`,
        `/session/${oneBase.sessionID}/message/${oneBase.messageID}/part/${oneOther.partID}`,
      ]

      for (const route of rejectedDeletes) {
        const response = await app.request(route, { method: "DELETE", headers: projectAHeaders })
        expect(response.status, route).toBe(404)
        expect(await response.text()).not.toContain("project-b-delete-secret")
      }

      expect(events).toEqual([])

      const sameSessionPartOwner = await app.request(`/session/${oneBase.sessionID}/message/${oneOther.messageID}`, {
        headers: projectAHeaders,
      })
      expect(sameSessionPartOwner.status).toBe(200)
      expect(JSON.stringify(await sameSessionPartOwner.json())).toContain("project-a-other-message")

      const bOwn = await app.request(`/session/${twoIDs.sessionID}/message/${twoIDs.messageID}`, {
        headers: { "x-opencorvus-directory": two.path },
      })
      expect(bOwn.status).toBe(200)
      expect(JSON.stringify(await bOwn.json())).toContain("project-b-delete-secret")

      const ownedPartDelete = await app.request(
        `/session/${oneBase.sessionID}/message/${oneDeletePart.messageID}/part/${oneDeletePart.partID}`,
        { method: "DELETE", headers: projectAHeaders },
      )
      expect(ownedPartDelete.status).toBe(200)
      expect(events).toEqual([`part:${oneBase.sessionID}:${oneDeletePart.messageID}:${oneDeletePart.partID}`])

      const ownedMessageDelete = await app.request(
        `/session/${oneBase.sessionID}/message/${oneDeleteMessage.messageID}`,
        { method: "DELETE", headers: projectAHeaders },
      )
      expect(ownedMessageDelete.status).toBe(200)
      expect(events).toEqual([
        `part:${oneBase.sessionID}:${oneDeletePart.messageID}:${oneDeletePart.partID}`,
        `message:${oneBase.sessionID}:${oneDeleteMessage.messageID}`,
      ])
    } finally {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, 30_000)
})
