import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { Message } from "../../src/session/message"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.started event", () => {
  test("should emit session.started event when session is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: Session.Info | undefined

        const unsub = Bus.subscribe(Session.Event.Created, (event) => {
          eventReceived = true
          receivedInfo = event.properties.info as Session.Info
        })

        const session = await Session.create({ kind: "assistant" })

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedInfo).toBeDefined()
        expect(receivedInfo?.id).toBe(session.id)
        expect(receivedInfo?.projectID).toBe(session.projectID)
        expect(receivedInfo?.directory).toBe(session.directory)
        expect(receivedInfo?.title).toBe(session.title)

        await Session.remove(session.id)
      },
    })
  })

  test("created event includes session metadata", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let receivedInfo: Session.Info | undefined

        const unsub = Bus.subscribe(Session.Event.Created, (event) => {
          receivedInfo = event.properties.info as Session.Info
        })

        const session = await Session.create({
          kind: "assistant",
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(receivedInfo?.id).toBe(session.id)
        expect(receivedInfo?.metadata).toEqual({ codingAssistant: { surface: "right-sidebar" } })
        expect(session.metadata).toEqual({ codingAssistant: { surface: "right-sidebar" } })

        await Session.remove(session.id)
      },
    })
  })

  test("session.started event should be emitted before session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubStarted = Bus.subscribe(Session.Event.Created, () => {
          events.push("started")
        })

        const unsubUpdated = Bus.subscribe(Session.Event.Updated, () => {
          events.push("updated")
        })

        const session = await Session.create({ kind: "assistant" })

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubStarted()
        unsubUpdated()

        expect(events).toContain("started")
        expect(events).toContain("updated")
        expect(events.indexOf("started")).toBeLessThan(events.indexOf("updated"))

        await Session.remove(session.id)
      },
    })
  })
})

describe("Session.fork", () => {
  test("tracks parent session and exposes children", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const root = await Session.create({ kind: "assistant", title: "root-session" })
        const child = await Session.fork({ sessionID: root.id })

        expect(child.parentID).toBe(root.id)

        const children = await Session.children(root.id)
        expect(children.map((item) => item.id)).toContain(child.id)

        await Session.remove(root.id)
      },
    })
  })

  test("removing a parent session removes forked children", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const root = await Session.create({ kind: "assistant", title: "root-session" })
        const child = await Session.fork({ sessionID: root.id })

        await Session.remove(root.id)

        await expect(Session.get(root.id)).rejects.toThrow()
        await expect(Session.get(child.id)).rejects.toThrow()
      },
    })
  })

  test("clones compaction summary parent links inside the forked session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const root = await Session.create({ kind: "assistant", title: "root-session" })
        const model = { providerID: "test", modelID: "test-model" }
        const user = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: root.id,
          role: "user",
          time: { created: Date.now() },
          agent: "user",
          model,
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: root.id,
          messageID: user.id,
          type: "compaction",
          auto: true,
        })
        const summary = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: root.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: user.id,
          modelID: model.modelID,
          providerID: model.providerID,
          agent: "compaction",
          path: { cwd: projectRoot, root: projectRoot },
          summary: true,
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            total: 0,
            cache: { read: 0, write: 0 },
          },
          finish: "stop",
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: root.id,
          messageID: summary.id,
          type: "text",
          text: "summary",
        })
        const recentUser = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: root.id,
          role: "user",
          time: { created: Date.now() },
          agent: "user",
          model,
        })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: root.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: recentUser.id,
          modelID: model.modelID,
          providerID: model.providerID,
          agent: "agent",
          path: { cwd: projectRoot, root: projectRoot },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            total: 0,
            cache: { read: 0, write: 0 },
          },
          finish: "stop",
        })

        const child = await Session.fork({ sessionID: root.id })
        const childMessages = await Session.messages({ sessionID: child.id })
        const parentOrderKeys = new Set([user.orderKey, summary.orderKey, recentUser.orderKey])
        const childUsers = new Set(
          childMessages.filter((message) => message.info.role === "user").map((message) => message.info.id),
        )
        const childAssistants = childMessages.filter(
          (message): message is Message.WithParts & { info: Message.Assistant } => message.info.role === "assistant",
        )

        expect(childAssistants).toHaveLength(2)
        expect(childMessages.every((message) => message.info.orderKey.includes(":message:"))).toBe(true)
        expect(childMessages.some((message) => parentOrderKeys.has(message.info.orderKey))).toBe(false)
        for (const message of childAssistants) {
          expect(childUsers.has(message.info.parentID)).toBe(true)
          expect(message.info.parentID).not.toBe(user.id)
          expect(message.info.parentID).not.toBe(recentUser.id)
        }
        expect(childAssistants.map((message) => message.info.summary ?? false)).toEqual([true, false])

        await Session.remove(root.id)
      },
    })
  })
})

describe("Session.updateMessage", () => {
  test("preserves the original message created time across repeated updates", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const messageID = Identifier.ascending("message")
        const created = 1_776_000_000_100
        const driftedCreated = 1_776_000_012_000
        const events: Message.Info[] = []
        const unsub = Bus.subscribe(Message.Event.Updated, (event) => {
          events.push(event.properties.info as Message.Info)
        })

        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "assistant",
          time: { created },
          parentID: "user-parent",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "frontend-research",
          path: { cwd: projectRoot, root: projectRoot },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            total: 0,
            cache: { read: 0, write: 0 },
          },
        })
        const updated = await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "assistant",
          time: { created: driftedCreated },
          parentID: "user-parent",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "frontend-research",
          path: { cwd: projectRoot, root: projectRoot },
          cost: 0,
          tokens: {
            input: 0,
            output: 1,
            reasoning: 0,
            total: 1,
            cache: { read: 0, write: 0 },
          },
        })

        unsub()
        const persisted = await Session.messages({ sessionID: session.id })
        const persistedMessage = persisted.find((message) => message.info.id === messageID)

        expect(updated.time.created).toBe(created)
        expect(events.at(-1)?.time.created).toBe(created)
        expect(updated.orderKey).toBe(events.at(-1)?.orderKey)
        expect(events.every((event) => typeof event.orderKey === "string" && event.orderKey.includes(":message:"))).toBe(
          true,
        )
        expect(persistedMessage?.info.time.created).toBe(created)
        expect(persistedMessage?.info.role === "assistant" ? persistedMessage.info.tokens.output : undefined).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("visible message.updated bus events reject missing orderKey", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        await expect(
          Bus.publish(Message.Event.Updated, {
            info: {
              id: Identifier.ascending("message"),
              sessionID: session.id,
              role: "assistant",
              time: { created: Date.now() },
              parentID: "user-parent",
              modelID: "test-model",
              providerID: "test-provider",
              agent: "frontend-research",
              path: { cwd: projectRoot, root: projectRoot },
              cost: 0,
              tokens: {
                input: 0,
                output: 0,
                reasoning: 0,
                total: 0,
                cache: { read: 0, write: 0 },
              },
            } as any,
          }),
        ).rejects.toThrow(/orderKey/)
        await Session.remove(session.id)
      },
    })
  })
})
