import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { ChannelAdapter, IncomingMessage } from "../src/adapter"
import { SessionCoordinator } from "../src/session-coordinator"
import { sdkMock } from "./sdk-mock"

mock.module("@opencorvus-ai/sdk", () => sdkMock)
mock.module("@opencorvus-ai/sdk", () => sdkMock)

const { ChannelRuntime } = await import("../src/core")

function adapter(): ChannelAdapter {
  return {
    platform: "slack",
    start: async () => {},
    stop: async () => {},
    sendMessage: async () => {},
    uploadImage: async () => {},
    onMessage: () => {},
  }
}

function incoming(thread: string, text: string): IncomingMessage {
  return {
    platform: "slack",
    channel: "C1",
    thread,
    user: "U1",
    text,
  }
}

beforeEach(() => {
  process.env.OPENCORVUS_SHARED_SESSION_MODE = "0"
  process.env.OPENCORVUS_CHANNEL_TASK_MODE = "session-async"
})

describe("channel runtime session isolation", () => {
  test("creates separate sessions for separate slack threads when shared mode is off", async () => {
    const createCalls: Array<{ title: string }> = []
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const ids = ["session_1", "session_2"]
    const a = adapter()

    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        session: {
          create(input: { title: string }): Promise<{ error?: unknown; data: { id: string } }>
          promptAsync(input: {
            sessionID: string
            parts: Array<{ type: "text"; text: string }>
            system: string
          }): Promise<{ error?: unknown }>
        }
      }
      handleMessage(msg: IncomingMessage): Promise<void>
    }

    core.adapters = [a]
    core.client = {
      session: {
        create: async (input) => {
          createCalls.push(input)
          const id = ids.shift()
          if (!id) throw new Error("unexpected extra session.create call")
          return { data: { id } }
        },
        promptAsync: async (input) => {
          promptCalls.push({
            sessionID: input.sessionID,
            text: input.parts[0]?.text ?? "",
          })
          return {}
        },
      },
    }

    await core.handleMessage(incoming("T1", "hello one"))
    await core.handleMessage(incoming("T2", "hello two"))

    expect(createCalls).toHaveLength(2)
    expect(promptCalls).toHaveLength(2)
    expect(promptCalls[0]?.sessionID).not.toBe(promptCalls[1]?.sessionID)
  })
})
