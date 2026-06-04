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

function incoming(text: string): IncomingMessage {
  return {
    platform: "slack",
    channel: "C1",
    thread: "T1",
    user: "U1",
    text,
  }
}

type RuntimeStartInput = {
  mode: "spawn"
  directory: string
  sessionID: string
  bin?: string
}

beforeEach(() => {
  delete process.env.OPENCORVUS_CHANNEL_TASK_MODE
  delete process.env.OPENCORVUS_CHANNEL_TASK_TIMEOUT_MS
  delete process.env.OPENCORVUS_CHANNEL_TASK_SWEEP_MS
})

describe("channel runtime submit mode", () => {
  test("uses tui.runtime.submitTask by default", async () => {
    const startCalls: RuntimeStartInput[] = []
    const submitCalls: Array<{ sessionID: string; text: string; wait: boolean }> = []
    const promptCalls: Array<{ sessionID: string; parts: Array<{ type: "text"; text: string }>; system: string }> = []
    const a = adapter()
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            start(input: RuntimeStartInput): Promise<{ error?: unknown }>
            submitTask(input: {
              sessionID: string
              text: string
              wait: boolean
            }): Promise<{ error?: unknown; data?: Record<string, unknown> }>
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
          start: async (input) => {
            startCalls.push(input)
            return {}
          },
          submitTask: async (input) => {
            submitCalls.push(input)
            return {
              data: {
                accepted: true,
                sessionID: input.sessionID,
                waited: false,
                completed: false,
                message: null,
              },
            }
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

    expect(startCalls).toHaveLength(1)
    expect(startCalls[0]?.mode).toBe("spawn")
    expect(startCalls[0]?.sessionID).toBe("session_1")
    expect(startCalls[0]?.directory).toBeTruthy()
    expect(submitCalls).toHaveLength(1)
    expect(submitCalls[0]).toEqual({
      sessionID: "session_1",
      text: "ship it",
      wait: false,
    })
    expect(promptCalls).toHaveLength(0)
  })

  test("fails when tui runtime submit fails instead of falling back", async () => {
    const startCalls: RuntimeStartInput[] = []
    const sent: string[] = []
    const submitCalls: Array<{ sessionID: string; text: string; wait: boolean }> = []
    const promptCalls: Array<{ sessionID: string; parts: Array<{ type: "text"; text: string }>; system: string }> = []
    const a: ChannelAdapter = {
      ...adapter(),
      sendMessage: async (_channel, _thread, text) => {
        sent.push(text)
      },
    }
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            start(input: RuntimeStartInput): Promise<{ error?: unknown }>
            submitTask(input: {
              sessionID: string
              text: string
              wait: boolean
            }): Promise<{ error?: unknown; data?: Record<string, unknown> }>
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
          start: async (input) => {
            startCalls.push(input)
            return {}
          },
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

    expect(startCalls).toHaveLength(1)
    expect(startCalls[0]?.mode).toBe("spawn")
    expect(startCalls[0]?.sessionID).toBe("session_1")
    expect(submitCalls).toHaveLength(1)
    expect(promptCalls).toHaveLength(0)
    expect(sent.at(-1)).toBe("Failed to send prompt.")
  })

  test("fails when tui runtime start fails instead of falling back", async () => {
    const startCalls: RuntimeStartInput[] = []
    const sent: string[] = []
    const submitCalls: Array<{ sessionID: string; text: string; wait: boolean }> = []
    const promptCalls: Array<{ sessionID: string; parts: Array<{ type: "text"; text: string }>; system: string }> = []
    const a: ChannelAdapter = {
      ...adapter(),
      sendMessage: async (_channel, _thread, text) => {
        sent.push(text)
      },
    }
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            start(input: RuntimeStartInput): Promise<{ error?: unknown }>
            submitTask(input: {
              sessionID: string
              text: string
              wait: boolean
            }): Promise<{ error?: unknown; data?: Record<string, unknown> }>
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
          start: async (input) => {
            startCalls.push(input)
            return { error: { message: "start failed" } }
          },
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

    await core.handleMessage(incoming("start failure"))

    expect(startCalls).toHaveLength(1)
    expect(submitCalls).toHaveLength(0)
    expect(promptCalls).toHaveLength(0)
    expect(sent.at(-1)).toBe("Failed to send prompt.")
  })

  test("keeps processing until session.idle after async submit", async () => {
    const sendCalls: Array<string> = []
    const submitCalls: Array<{ sessionID: string; text: string; wait: boolean }> = []
    const promptCalls: Array<{ sessionID: string; parts: Array<{ type: "text"; text: string }>; system: string }> = []
    const a: ChannelAdapter = {
      platform: "slack",
      start: async () => {},
      stop: async () => {},
      sendMessage: async (_channel, _thread, text) => {
        sendCalls.push(text)
      },
      uploadImage: async () => {},
      onMessage: () => {},
    }
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            start(input: RuntimeStartInput): Promise<{ error?: unknown }>
            submitTask(input: {
              sessionID: string
              text: string
              wait: boolean
            }): Promise<{ error?: unknown; data?: Record<string, unknown> }>
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
      handleEvent(event: unknown): Promise<void>
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
          start: async () => {
            return {}
          },
          submitTask: async (input) => {
            submitCalls.push(input)
            return {
              data: {
                accepted: true,
                sessionID: input.sessionID,
                waited: false,
                completed: false,
                message: null,
              },
            }
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

    await core.handleMessage(incoming("first"))

    expect(core.session.processing("session_1")).toBe(true)
    expect(sendCalls).toHaveLength(0)
    expect(promptCalls).toHaveLength(0)

    await core.handleEvent({
      type: "session.idle",
      properties: {
        sessionID: "session_1",
      },
    })
    expect(core.session.processing("session_1")).toBe(false)

    await core.handleMessage(incoming("second"))

    expect(submitCalls).toHaveLength(2)
    expect(promptCalls).toHaveLength(0)
  })

  test("does not release on session.status idle when task is non-terminal", async () => {
    const a = adapter()
    const oldFetch = globalThis.fetch
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ found: true, status: "running", terminal: false, error: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown) as typeof fetch

    try {
      const core = new ChannelRuntime() as unknown as {
        adapters: ChannelAdapter[]
        session: SessionCoordinator<
          { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
          IncomingMessage
        >
        client: {
          tui: {
            runtime: {
              start(input: RuntimeStartInput): Promise<{ error?: unknown }>
              submitTask(input: {
                sessionID: string
                text: string
                wait: boolean
              }): Promise<{ error?: unknown; data?: Record<string, unknown> }>
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
        handleEvent(event: unknown): Promise<void>
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
            start: async () => {
              return {}
            },
            submitTask: async (input) => {
              return {
                data: {
                  accepted: true,
                  sessionID: input.sessionID,
                  taskID: "task_running",
                  waited: false,
                  completed: false,
                  message: null,
                },
              }
            },
          },
        },
        session: {
          promptAsync: async () => {
            return {}
          },
        },
      }

      await core.handleMessage(incoming("keep-running"))
      expect(core.session.processing("session_1")).toBe(true)

      await core.handleEvent({
        type: "session.status",
        properties: {
          sessionID: "session_1",
          status: { type: "idle" },
        },
      })

      expect(core.session.processing("session_1")).toBe(true)
    } finally {
      globalThis.fetch = oldFetch
    }
  })

  test("releases on session.status idle when task is terminal", async () => {
    const a = adapter()
    const oldFetch = globalThis.fetch
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ found: true, status: "completed", terminal: true, error: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown) as typeof fetch

    try {
      const core = new ChannelRuntime() as unknown as {
        adapters: ChannelAdapter[]
        session: SessionCoordinator<
          { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
          IncomingMessage
        >
        client: {
          tui: {
            runtime: {
              start(input: RuntimeStartInput): Promise<{ error?: unknown }>
              submitTask(input: {
                sessionID: string
                text: string
                wait: boolean
              }): Promise<{ error?: unknown; data?: Record<string, unknown> }>
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
        handleEvent(event: unknown): Promise<void>
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
            start: async () => {
              return {}
            },
            submitTask: async (input) => {
              return {
                data: {
                  accepted: true,
                  sessionID: input.sessionID,
                  taskID: "task_done",
                  waited: false,
                  completed: false,
                  message: null,
                },
              }
            },
          },
        },
        session: {
          promptAsync: async () => {
            return {}
          },
        },
      }

      await core.handleMessage(incoming("release-now"))
      expect(core.session.processing("session_1")).toBe(true)

      await core.handleEvent({
        type: "session.status",
        properties: {
          sessionID: "session_1",
          status: { type: "idle" },
        },
      })

      expect(core.session.processing("session_1")).toBe(false)
    } finally {
      globalThis.fetch = oldFetch
    }
  })

  test("releases processing when async task watchdog expires", async () => {
    process.env.OPENCORVUS_CHANNEL_TASK_TIMEOUT_MS = "1000"
    const sendCalls: Array<string> = []
    const a: ChannelAdapter = {
      platform: "slack",
      start: async () => {},
      stop: async () => {},
      sendMessage: async (_channel, _thread, text) => {
        sendCalls.push(text)
      },
      uploadImage: async () => {},
      onMessage: () => {},
    }
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      running: boolean
      session: SessionCoordinator<
        { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            start(input: RuntimeStartInput): Promise<{ error?: unknown }>
            submitTask(input: {
              sessionID: string
              text: string
              wait: boolean
            }): Promise<{ error?: unknown; data?: Record<string, unknown> }>
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
      expirePending(): Promise<void>
    }

    core.running = true
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
          start: async () => {
            return {}
          },
          submitTask: async (input) => {
            return {
              data: {
                accepted: true,
                sessionID: input.sessionID,
                taskID: "task_watchdog",
                waited: false,
                completed: false,
                message: null,
              },
            }
          },
        },
      },
      session: {
        promptAsync: async () => {
          return {}
        },
      },
    }

    await core.handleMessage(incoming("watchdog"))
    expect(core.session.processing("session_1")).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 1100))
    await core.expirePending()

    expect(core.session.processing("session_1")).toBe(false)
    expect(sendCalls.at(-1)).toContain("Task timed out")
  })

  test("releases the queue when loop continuation promptAsync returns an API error", async () => {
    const sent: string[] = []
    const submitCalls: Array<{ sessionID: string; text: string; wait: boolean }> = []
    const promptCalls: Array<{ sessionID: string; parts: Array<{ type: "text"; text: string }>; system: string }> = []
    const a: ChannelAdapter = {
      ...adapter(),
      sendMessage: async (_channel, _thread, text) => {
        sent.push(text)
      },
    }
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            start(input: RuntimeStartInput): Promise<{ error?: unknown }>
            submitTask(input: {
              sessionID: string
              text: string
              wait: boolean
            }): Promise<{ error?: unknown; data?: Record<string, unknown> }>
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
      handleEvent(event: unknown): Promise<void>
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
          start: async () => {
            return {}
          },
          submitTask: async (input) => {
            submitCalls.push(input)
            return {
              data: {
                accepted: true,
                sessionID: input.sessionID,
                taskID: `task_${submitCalls.length}`,
                waited: false,
                completed: false,
                message: null,
              },
            }
          },
        },
      },
      session: {
        promptAsync: async (input) => {
          promptCalls.push(input)
          return { error: { message: "loop failed" } }
        },
      },
    }

    await core.handleMessage(incoming("loop-start"))
    await core.handleMessage(incoming("queued-after-failure"))
    await core.handleEvent({
      type: "task.report",
      properties: {
        sessionID: "session_1",
        status: "progress",
        summary: "Still working",
        next_plan: "Finish the next step",
      },
    })
    await core.handleEvent({
      type: "session.idle",
      properties: {
        sessionID: "session_1",
      },
    })
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(promptCalls).toHaveLength(1)
    expect(submitCalls).toHaveLength(2)
    expect(submitCalls[1]?.text).toBe("queued-after-failure")
    expect(sent.some((item) => item.includes("queued (#1)"))).toBe(true)
  })

  test("supports OPENCORVUS_CHANNEL_TASK_MODE=session-async", async () => {
    process.env.OPENCORVUS_CHANNEL_TASK_MODE = "session-async"
    const startCalls: RuntimeStartInput[] = []
    const submitCalls: Array<{ sessionID: string; text: string; wait: boolean }> = []
    const promptCalls: Array<{ sessionID: string; parts: Array<{ type: "text"; text: string }>; system: string }> = []
    const a = adapter()
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
        IncomingMessage
      >
      client: {
        tui: {
          runtime: {
            start(input: RuntimeStartInput): Promise<{ error?: unknown }>
            submitTask(input: {
              sessionID: string
              text: string
              wait: boolean
            }): Promise<{ error?: unknown; data?: Record<string, unknown> }>
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
          start: async (input) => {
            startCalls.push(input)
            return {}
          },
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

    expect(startCalls).toHaveLength(0)
    expect(submitCalls).toHaveLength(0)
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.parts[0]?.text).toBe("legacy")
  })

  test("releases processing on session.error event", async () => {
    const sent: string[] = []
    const a: ChannelAdapter = {
      platform: "slack",
      start: async () => {},
      stop: async () => {},
      sendMessage: async (_channel, _thread, text) => {
        sent.push(text)
      },
      uploadImage: async () => {},
      onMessage: () => {},
    }
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      session: SessionCoordinator<
        { sessionId: string; adapter: ChannelAdapter; channel: string; thread: string },
        IncomingMessage
      >
      handleEvent(event: unknown): Promise<void>
    }

    core.adapters = [a]
    core.session.bind("slack:C1:T1", {
      sessionId: "session_1",
      adapter: a,
      channel: "C1",
      thread: "T1",
    })
    core.session.start("session_1")

    await core.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "session_1",
        error: {
          name: "UnknownError",
          data: {
            message: "runtime stopped",
          },
        },
      },
    })

    expect(core.session.processing("session_1")).toBe(false)
    expect(sent.at(-1)).toBe("Session failed: runtime stopped")
  })
})
