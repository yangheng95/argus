import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { BotAdapter, IncomingMessage } from "../src/adapter"
import { SessionCoordinator } from "../src/session-coordinator"

const sdk = {
  createOpencode: async () => {
    throw new Error("not used in this test")
  },
  createOpencodeClient: () => {
    throw new Error("not used in this test")
  },
}

mock.module("@opencorvus-ai/sdk", () => sdk)
mock.module("@opencorvus-ai/sdk/v2", () => sdk)

const { BotCore } = await import("../src/core")

function adapter(): BotAdapter {
  return {
    platform: "slack",
    start: async () => {},
    stop: async () => {},
    sendMessage: async () => {},
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
  delete process.env.OPENCORVUS_BOT_TASK_MODE
})

describe("bot core submit mode", () => {
  test("uses tui.runtime.submitTask by default", async () => {
    const submitCalls: Array<{ sessionID: string; text: string; wait: boolean }> = []
    const promptCalls: Array<{ sessionID: string; parts: Array<{ type: "text"; text: string }>; system: string }> = []
    const a = adapter()
    const core = new BotCore() as unknown as {
      adapters: BotAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: BotAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            submitTask(input: { sessionID: string; text: string; wait: boolean }): Promise<{ error?: unknown }>
          }
        }
        session: {
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
    core.session.bind("slack:C1:T1", {
      sessionId: "session_1",
      adapter: a,
      channel: "C1",
      thread: "T1",
    })
    core.client = {
      tui: {
        runtime: {
          submitTask: async (input) => {
            submitCalls.push(input)
            return {}
          },
        },
      },
      session: {
        promptAsync: async (input) => {
          promptCalls.push(input)
          return {}
        },
      },
    }

    await core.handleMessage(incoming("ship it"))

    expect(submitCalls).toHaveLength(1)
    expect(submitCalls[0]).toEqual({
      sessionID: "session_1",
      text: "ship it",
      wait: true,
    })
    expect(promptCalls).toHaveLength(0)
  })

  test("falls back to session.promptAsync when tui runtime submit fails", async () => {
    const submitCalls: Array<{ sessionID: string; text: string; wait: boolean }> = []
    const promptCalls: Array<{ sessionID: string; parts: Array<{ type: "text"; text: string }>; system: string }> = []
    const a = adapter()
    const core = new BotCore() as unknown as {
      adapters: BotAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: BotAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            submitTask(input: { sessionID: string; text: string; wait: boolean }): Promise<{ error?: unknown }>
          }
        }
        session: {
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
    core.session.bind("slack:C1:T1", {
      sessionId: "session_1",
      adapter: a,
      channel: "C1",
      thread: "T1",
    })
    core.client = {
      tui: {
        runtime: {
          submitTask: async (input) => {
            submitCalls.push(input)
            return { error: { message: "submit failed" } }
          },
        },
      },
      session: {
        promptAsync: async (input) => {
          promptCalls.push(input)
          return {}
        },
      },
    }

    await core.handleMessage(incoming("fallback"))

    expect(submitCalls).toHaveLength(1)
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.sessionID).toBe("session_1")
    expect(promptCalls[0]?.parts[0]?.text).toBe("fallback")
    expect(promptCalls[0]?.system.length).toBeGreaterThan(0)
  })

  test("supports OPENCORVUS_BOT_TASK_MODE=session-async", async () => {
    process.env.OPENCORVUS_BOT_TASK_MODE = "session-async"
    const submitCalls: Array<{ sessionID: string; text: string; wait: boolean }> = []
    const promptCalls: Array<{ sessionID: string; parts: Array<{ type: "text"; text: string }>; system: string }> = []
    const a = adapter()
    const core = new BotCore() as unknown as {
      adapters: BotAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: BotAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            submitTask(input: { sessionID: string; text: string; wait: boolean }): Promise<{ error?: unknown }>
          }
        }
        session: {
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
    core.session.bind("slack:C1:T1", {
      sessionId: "session_1",
      adapter: a,
      channel: "C1",
      thread: "T1",
    })
    core.client = {
      tui: {
        runtime: {
          submitTask: async (input) => {
            submitCalls.push(input)
            return {}
          },
        },
      },
      session: {
        promptAsync: async (input) => {
          promptCalls.push(input)
          return {}
        },
      },
    }

    await core.handleMessage(incoming("legacy"))

    expect(submitCalls).toHaveLength(0)
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.parts[0]?.text).toBe("legacy")
  })
})
