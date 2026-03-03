import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { BotAdapter, IncomingMessage } from "../src/adapter"

mock.module("@opencorvus-ai/sdk", () => ({
  createOpencode: async () => {
    throw new Error("not used in this test")
  },
}))

const { BotCore } = await import("../src/core")

function adapter(sent: string[]): BotAdapter {
  return {
    platform: "slack",
    start: async () => {},
    stop: async () => {},
    sendMessage: async (_channel, _thread, text) => {
      sent.push(text)
    },
    uploadImage: async () => {},
    onMessage: () => {},
  }
}

function incoming(text: string): IncomingMessage {
  return {
    platform: "slack",
    channel: "C1",
    thread: "T1",
    user: "U1",
    text,
  }
}

beforeEach(() => {
  delete process.env.OPENCORVUS_BOT_SESSION_QUEUE_LIMIT
  delete process.env.OPENCORVUS_BOT_PERMISSION_ASK_REPLY
})

describe("bot core queue guard", () => {
  test("rejects new inbound message when per-session queue is full", async () => {
    process.env.OPENCORVUS_BOT_SESSION_QUEUE_LIMIT = "2"
    const sent: string[] = []
    const a = adapter(sent)
    const core = new BotCore() as unknown as {
      adapters: BotAdapter[]
      sessions: Map<string, { sessionId: string; adapter: BotAdapter; channel: string; thread: string }>
      sessionProcessing: Set<string>
      sessionQueues: Map<string, Array<{ msg: IncomingMessage; text: string }>>
      handleMessage(msg: IncomingMessage): Promise<void>
    }

    core.adapters = [a]
    core.sessions.set("slack:C1:T1", {
      sessionId: "session_1",
      adapter: a,
      channel: "C1",
      thread: "T1",
    })
    core.sessionProcessing.add("session_1")
    core.sessionQueues.set("session_1", [
      { msg: incoming("one"), text: "one" },
      { msg: incoming("two"), text: "two" },
    ])

    await core.handleMessage(incoming("overflow"))

    expect(core.sessionQueues.get("session_1")?.length).toBe(2)
    expect(sent.at(-1)).toBe("Current task is still running. Queue is full (2). Please retry later.")
  })
})

describe("bot core permission asked", () => {
  test("auto-replies permission request with reject by default", async () => {
    const sent: string[] = []
    const calls: Array<{ requestID: string; reply: "once" | "always" | "reject" }> = []
    const a = adapter(sent)
    const core = new BotCore() as unknown as {
      sessions: Map<string, { sessionId: string; adapter: BotAdapter; channel: string; thread: string }>
      sessionIndex: Map<string, string>
      client: {
        permission: {
          reply(input: { requestID: string; reply: "once" | "always" | "reject" }): Promise<{ error?: unknown }>
        }
      }
      handleEvent(event: unknown): Promise<void>
    }

    core.sessions.set("slack:C1:T1", {
      sessionId: "session_1",
      adapter: a,
      channel: "C1",
      thread: "T1",
    })
    core.sessionIndex.set("session_1", "slack:C1:T1")
    core.client = {
      permission: {
        reply: async (input) => {
          calls.push(input)
          return {}
        },
      },
    }

    await core.handleEvent({
      type: "permission.asked",
      properties: {
        id: "permission_1",
        sessionID: "session_1",
        permission: "bash",
        patterns: ["git push"],
      },
    })

    expect(calls).toEqual([{ requestID: "permission_1", reply: "reject" }])
    expect(sent.at(-1)).toBe("Auto-replied permission (reject): bash [git push]")
  })

  test("supports OPENCORVUS_BOT_PERMISSION_ASK_REPLY override", async () => {
    process.env.OPENCORVUS_BOT_PERMISSION_ASK_REPLY = "once"
    const sent: string[] = []
    const calls: Array<{ requestID: string; reply: "once" | "always" | "reject" }> = []
    const a = adapter(sent)
    const core = new BotCore() as unknown as {
      sessions: Map<string, { sessionId: string; adapter: BotAdapter; channel: string; thread: string }>
      sessionIndex: Map<string, string>
      client: {
        permission: {
          reply(input: { requestID: string; reply: "once" | "always" | "reject" }): Promise<{ error?: unknown }>
        }
      }
      handleEvent(event: unknown): Promise<void>
    }

    core.sessions.set("slack:C1:T1", {
      sessionId: "session_1",
      adapter: a,
      channel: "C1",
      thread: "T1",
    })
    core.sessionIndex.set("session_1", "slack:C1:T1")
    core.client = {
      permission: {
        reply: async (input) => {
          calls.push(input)
          return {}
        },
      },
    }

    await core.handleEvent({
      type: "permission.asked",
      properties: {
        id: "permission_2",
        sessionID: "session_1",
        permission: "edit",
        patterns: ["src/main.ts"],
      },
    })

    expect(calls).toEqual([{ requestID: "permission_2", reply: "once" }])
    expect(sent.at(-1)).toBe("Auto-replied permission (once): edit [src/main.ts]")
  })
})
