import { beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ChannelAdapter, IncomingMessage } from "../src/adapter"
import { SessionCoordinator } from "../src/session-coordinator"
import { sdkMock } from "./sdk-mock"

mock.module("@opencorvus-ai/sdk", () => sdkMock)

const { ChannelRuntime } = await import("../src/core")

function adapter(sent: string[] = []): ChannelAdapter {
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

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "opencorvus-channel-runtime-"))
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
          }): Promise<{ error?: unknown; data: { taskID: string } }>
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
          return { data: { taskID: `task_${input.sessionID}` } }
        },
      },
    }

    await core.handleMessage(incoming("T1", "hello one"))
    await core.handleMessage(incoming("T2", "hello two"))

    expect(createCalls).toHaveLength(2)
    expect(promptCalls).toHaveLength(2)
    expect(promptCalls[0]?.sessionID).not.toBe(promptCalls[1]?.sessionID)
  })

  test("shared mode rejects corrupt shared session file without replacement session", async () => {
    const dir = await tempDir()
    try {
      const sharedFile = path.join(dir, "shared-session.json")
      await writeFile(sharedFile, "{")
      const sent: string[] = []
      const createCalls: Array<{ title: string }> = []
      const promptCalls: Array<{ sessionID: string; text: string }> = []
      const a = adapter(sent)

      const core = new ChannelRuntime({ sharedMode: true, sharedFile }) as unknown as {
        adapters: ChannelAdapter[]
        client: {
          session: {
            create(input: { title: string }): Promise<{ error?: unknown; data: { id: string } }>
            promptAsync(input: {
              sessionID: string
              parts: Array<{ type: "text"; text: string }>
              system: string
            }): Promise<{ error?: unknown; data: { taskID: string } }>
          }
        }
        handleMessage(msg: IncomingMessage): Promise<void>
      }

      core.adapters = [a]
      core.client = {
        session: {
          create: async (input) => {
            createCalls.push(input)
            return { data: { id: "shared_corrupt_replacement" } }
          },
          promptAsync: async (input) => {
            promptCalls.push({
              sessionID: input.sessionID,
              text: input.parts[0]?.text ?? "",
            })
            return { data: { taskID: "task_unexpected" } }
          },
        },
      }

      await core.handleMessage(incoming("T-corrupt", "hello corrupt"))

      expect(createCalls).toEqual([])
      expect(promptCalls).toEqual([])
      expect(sent).toEqual(["Failed to initialize shared session."])
      expect(await readFile(sharedFile, "utf8")).toBe("{")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test.each([
    ["missing session_id", "{}\n"],
    ["non-string session_id", '{"session_id": 123}\n'],
    ["empty session_id", '{"session_id": "   "}\n'],
  ])("shared mode rejects invalid shared session file shape: %s", async (_name, content) => {
    const dir = await tempDir()
    try {
      const sharedFile = path.join(dir, "shared-session.json")
      await writeFile(sharedFile, content)
      const sent: string[] = []
      const createCalls: Array<{ title: string }> = []
      const promptCalls: Array<{ sessionID: string; text: string }> = []
      const a = adapter(sent)

      const core = new ChannelRuntime({ sharedMode: true, sharedFile }) as unknown as {
        adapters: ChannelAdapter[]
        client: {
          session: {
            create(input: { title: string }): Promise<{ error?: unknown; data: { id: string } }>
            promptAsync(input: {
              sessionID: string
              parts: Array<{ type: "text"; text: string }>
              system: string
            }): Promise<{ error?: unknown; data: { taskID: string } }>
          }
        }
        handleMessage(msg: IncomingMessage): Promise<void>
      }

      core.adapters = [a]
      core.client = {
        session: {
          create: async (input) => {
            createCalls.push(input)
            return { data: { id: "shared_invalid_replacement" } }
          },
          promptAsync: async (input) => {
            promptCalls.push({
              sessionID: input.sessionID,
              text: input.parts[0]?.text ?? "",
            })
            return { data: { taskID: "task_unexpected" } }
          },
        },
      }

      await core.handleMessage(incoming("T-invalid", "hello invalid"))

      expect(createCalls).toEqual([])
      expect(promptCalls).toEqual([])
      expect(sent).toEqual(["Failed to initialize shared session."])
      expect(await readFile(sharedFile, "utf8")).toBe(content)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("shared mode fails before session create when shared file directory is unusable", async () => {
    const dir = await tempDir()
    try {
      const blocker = path.join(dir, "not-a-directory")
      await writeFile(blocker, "block")
      const sharedFile = path.join(blocker, "shared-session.json")
      const sent: string[] = []
      const createCalls: Array<{ title: string }> = []
      const promptCalls: Array<{ sessionID: string; text: string }> = []
      const a = adapter(sent)

      const core = new ChannelRuntime({ sharedMode: true, sharedFile }) as unknown as {
        adapters: ChannelAdapter[]
        client: {
          session: {
            create(input: { title: string }): Promise<{ error?: unknown; data: { id: string } }>
            promptAsync(input: {
              sessionID: string
              parts: Array<{ type: "text"; text: string }>
              system: string
            }): Promise<{ error?: unknown; data: { taskID: string } }>
          }
        }
        handleMessage(msg: IncomingMessage): Promise<void>
      }

      core.adapters = [a]
      core.client = {
        session: {
          create: async (input) => {
            createCalls.push(input)
            return { data: { id: "shared_unwritable_replacement" } }
          },
          promptAsync: async (input) => {
            promptCalls.push({
              sessionID: input.sessionID,
              text: input.parts[0]?.text ?? "",
            })
            return { data: { taskID: "task_unexpected" } }
          },
        },
      }

      await core.handleMessage(incoming("T-unwritable", "hello unwritable"))

      expect(createCalls).toEqual([])
      expect(promptCalls).toEqual([])
      expect(sent).toEqual(["Failed to initialize shared session."])
      expect(await readFile(blocker, "utf8")).toBe("block")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("shared mode persists a new shared session before using it", async () => {
    const dir = await tempDir()
    try {
      const sharedFile = path.join(dir, "nested", "shared-session.json")
      const createCalls: Array<{ title: string }> = []
      const promptCalls: Array<{ sessionID: string; text: string }> = []
      const a = adapter()

      const core = new ChannelRuntime({ sharedMode: true, sharedFile }) as unknown as {
        adapters: ChannelAdapter[]
        client: {
          session: {
            create(input: { title: string }): Promise<{ error?: unknown; data: { id: string } }>
            promptAsync(input: {
              sessionID: string
              parts: Array<{ type: "text"; text: string }>
              system: string
            }): Promise<{ error?: unknown; data: { taskID: string } }>
          }
        }
        handleMessage(msg: IncomingMessage): Promise<void>
      }

      core.adapters = [a]
      core.client = {
        session: {
          create: async (input) => {
            createCalls.push(input)
            return { data: { id: "shared_persisted" } }
          },
          promptAsync: async (input) => {
            expect(JSON.parse(await readFile(sharedFile, "utf8")).session_id).toBe(input.sessionID)
            promptCalls.push({
              sessionID: input.sessionID,
              text: input.parts[0]?.text ?? "",
            })
            return { data: { taskID: `task_${input.sessionID}` } }
          },
        },
      }

      await core.handleMessage(incoming("T1", "first shared"))
      expect(JSON.parse(await readFile(sharedFile, "utf8")).session_id).toBe("shared_persisted")

      const secondCore = new ChannelRuntime({ sharedMode: true, sharedFile }) as unknown as {
        adapters: ChannelAdapter[]
        client: {
          session: {
            create(input: { title: string }): Promise<{ error?: unknown; data: { id: string } }>
            promptAsync(input: {
              sessionID: string
              parts: Array<{ type: "text"; text: string }>
              system: string
            }): Promise<{ error?: unknown; data: { taskID: string } }>
          }
        }
        handleMessage(msg: IncomingMessage): Promise<void>
      }
      secondCore.adapters = [a]
      secondCore.client = core.client

      await secondCore.handleMessage(incoming("T2", "second shared"))

      expect(createCalls).toHaveLength(1)
      expect(promptCalls.map((item) => item.sessionID)).toEqual(["shared_persisted", "shared_persisted"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("shared mode does not bind or prompt when post-create shared file write fails", async () => {
    const dir = await tempDir()
    try {
      const sharedFile = path.join(dir, "shared-session.json")
      const sent: string[] = []
      const createCalls: Array<{ title: string }> = []
      const promptCalls: Array<{ sessionID: string; text: string }> = []
      const a = adapter(sent)

      const core = new ChannelRuntime({ sharedMode: true, sharedFile }) as unknown as {
        adapters: ChannelAdapter[]
        sharedSessionId?: string
        writeSharedSessionFile(file: string, sessionId: string): Promise<void>
        client: {
          session: {
            create(input: { title: string }): Promise<{ error?: unknown; data: { id: string } }>
            promptAsync(input: {
              sessionID: string
              parts: Array<{ type: "text"; text: string }>
              system: string
            }): Promise<{ error?: unknown; data: { taskID: string } }>
          }
        }
        handleMessage(msg: IncomingMessage): Promise<void>
      }

      core.adapters = [a]
      core.writeSharedSessionFile = async () => {
        throw new Error("write denied")
      }
      core.client = {
        session: {
          create: async (input) => {
            createCalls.push(input)
            return { data: { id: "shared_unpersisted" } }
          },
          promptAsync: async (input) => {
            promptCalls.push({
              sessionID: input.sessionID,
              text: input.parts[0]?.text ?? "",
            })
            return { data: { taskID: "task_unexpected" } }
          },
        },
      }

      await core.handleMessage(incoming("T-write-fail", "hello write fail"))

      expect(createCalls).toHaveLength(1)
      expect(promptCalls).toEqual([])
      expect(core.sharedSessionId).toBeUndefined()
      expect(sent).toEqual(["Failed to initialize shared session."])
      await expect(Bun.file(sharedFile).exists()).resolves.toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("start rejects corrupt shared session file before starting adapters", async () => {
    const dir = await tempDir()
    try {
      const sharedFile = path.join(dir, "shared-session.json")
      await writeFile(sharedFile, "{")
      let started = 0
      const a = {
        ...adapter(),
        start: async () => {
          started += 1
        },
      }
      const core = new ChannelRuntime({
        baseUrl: "http://127.0.0.1:17777",
        directory: dir,
        sharedMode: true,
        sharedFile,
      })
      core.register(a)

      await expect(core.start()).rejects.toThrow("Invalid shared session file JSON")
      expect(started).toBe(0)
      expect((core as unknown as { running: boolean }).running).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
