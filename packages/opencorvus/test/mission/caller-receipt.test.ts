import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA } from "../../src/coding-assistant/session"
import { Identifier } from "../../src/id/id"
import { attachMissionCaller, ensureMissionCallerReceiptBridge } from "../../src/mission/caller-receipt"
import { ensureMissionSession } from "../../src/mission/session"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { sessionLifecycleOrderKey, SessionStatus } from "../../src/session/status"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("mission caller receipt", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  async function seedCallerUserMessage(sessionID: string): Promise<string> {
    const messageID = Identifier.ascending("message")
    await Session.persistMessage({
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: "coding-assistant",
        model: { providerID: "test", modelID: "model" },
      } satisfies Message.User,
      parts: [
        {
          id: Identifier.ascending("part"),
          messageID,
          sessionID,
          type: "text",
          text: "please run a durable workflow",
          source: "user",
        } satisfies Message.TextPart,
      ],
      touchSessionID: sessionID,
    })
    return messageID
  }

  test("terminal mission status writes one visible receipt to the caller chat", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureMissionCallerReceiptBridge()
        const caller = await Session.create({
          kind: "assistant",
          title: "right sidebar assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const callerMessageID = await seedCallerUserMessage(caller.id)
        const mission = await ensureMissionSession({ missionID: "receipt-mission", defaultCwd: tmp.path })
        await attachMissionCaller({
          missionSessionID: mission.id,
          callerSession: caller,
          callerMessageID,
        })

        const terminalStatus = {
          type: "terminal",
          reason: "completed",
          summary: "Implementation and verification completed.",
        } satisfies SessionStatus.Info
        await Bus.publish(SessionStatus.Event.Status, {
          sessionID: mission.id,
          orderKey: sessionLifecycleOrderKey(mission.id),
          status: terminalStatus,
        })
        await Bus.publish(SessionStatus.Event.Status, {
          sessionID: mission.id,
          orderKey: sessionLifecycleOrderKey(mission.id),
          status: terminalStatus,
        })

        const messages = await Session.messages({ sessionID: caller.id })
        const receiptMessages = messages.filter(
          (message) => message.info.role === "assistant" && message.info.agent === "mission",
        )
        const updatedMission = await Session.get(mission.id)
        const receipt = (updatedMission.metadata as { mission?: { receipt?: Record<string, unknown> } } | undefined)
          ?.mission?.receipt

        expect(receiptMessages).toHaveLength(1)
        expect(receiptMessages[0]?.info.parentID).toBe(callerMessageID)
        expect(receiptMessages[0]?.parts[0]).toMatchObject({
          type: "text",
          text: expect.stringContaining("Mission receipt-mission completed."),
        })
        expect(receipt).toMatchObject({
          message_id: receiptMessages[0]?.info.id,
          terminal_reason: "completed",
        })
      },
    })
  }, 15_000)
})
