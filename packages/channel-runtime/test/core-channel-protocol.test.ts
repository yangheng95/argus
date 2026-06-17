import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { ChannelAdapter, IncomingMessage } from "../src/adapter"
import { sdkMock } from "./sdk-mock"

mock.module("@opencorvus-ai/sdk", () => sdkMock)
mock.module("@opencorvus-ai/sdk", () => sdkMock)

const { ChannelRuntime } = await import("../src/core")
let oldFetch: typeof globalThis.fetch

function installFetchMock(handler: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>) {
  globalThis.fetch = Object.assign(handler, { preconnect: oldFetch.preconnect })
}

function adapter(
  platform: "slack" | "telegram" | "discord" | "feishu" | "googlechat",
  sent: string[],
  uploads: Array<{ channel: string; thread: string; filename: string; title?: string }>,
  urlUploads?: Array<{ channel: string; thread: string; url: string; filename: string; title?: string }>,
): ChannelAdapter {
  return {
    platform,
    start: async () => {},
    stop: async () => {},
    sendMessage: async (channel, thread, text) => {
      sent.push(`${channel}:${thread}:${text}`)
    },
    uploadImage: async (channel, thread, _imageBuffer, filename, title) => {
      uploads.push({ channel, thread, filename, title })
    },
    ...(urlUploads
      ? {
          uploadImageUrl: async (channel, thread, url, filename, title) => {
            urlUploads.push({ channel, thread, url, filename, title })
          },
        }
      : {}),
    onMessage: () => {},
  }
}

function incoming(platform: "slack" | "telegram" | "discord" | "googlechat", text: string): IncomingMessage {
  return {
    platform,
    channel: platform === "telegram" ? "chat-1" : platform === "googlechat" ? "spaces/AAA" : "ch-1",
    thread: platform === "telegram" ? "101" : platform === "googlechat" ? "spaces/AAA/threads/t-1" : "root-1",
    user: "u-1",
    text,
  }
}

beforeEach(() => {
  process.env.OPENCORVUS_CHANNEL_PROTOCOL = "1"
  oldFetch = globalThis.fetch
})

afterEach(() => {
  delete process.env.OPENCORVUS_CHANNEL_PROTOCOL
  globalThis.fetch = oldFetch
})

describe("channel runtime channel protocol", () => {
  test("routes telegram messages through channel.message and uploads image attachments", async () => {
    const sent: string[] = []
    const uploads: Array<{ channel: string; thread: string; filename: string; title?: string }> = []
    const calls: Array<unknown> = []
    const a = adapter("telegram", sent, uploads)
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      client: {
        channel: {
          message(input: unknown): Promise<{
            error?: unknown
            data: {
              kind: "panel_response"
              message: string
              task_id: string
              attachments: Array<{ mime: string; url: string; filename?: string }>
            }
          }>
        }
      }
      handleMessage(msg: IncomingMessage): Promise<void>
    }

    core.adapters = [a]
    core.client = {
      channel: {
        message: async (input) => {
          calls.push(input)
          return {
            data: {
              kind: "panel_response",
              message: "Captured OpenCorvus GUI.",
              task_id: "task_1",
              attachments: [
                {
                  mime: "image/png",
                  filename: "opencorvus-gui.png",
                  url: "data:image/png;base64,aGVsbG8=",
                },
              ],
            },
          }
        },
      },
    }

    await core.handleMessage(incoming("telegram", "send gui"))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      platform: "telegram",
      channel: "chat-1",
      thread: "101",
      text: "send gui",
      user_id: "u-1",
      source: "telegram",
      allow_create: true,
    })
    expect(sent).toEqual(["chat-1:101:Captured OpenCorvus GUI."])
    expect(uploads).toEqual([
      {
        channel: "chat-1",
        thread: "101",
        filename: "opencorvus-gui.png",
        title: "Captured OpenCorvus GUI.",
      },
    ])
  })

  test("publishes orchestrator evaluation updates back to the bound discord thread", async () => {
    const sent: string[] = []
    const uploads: Array<{ channel: string; thread: string; filename: string; title?: string }> = []
    const a = adapter("discord", sent, uploads)
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      client: {
        channel: {
          message(input: unknown): Promise<{
            error?: unknown
            data: {
              kind: "created"
              message: string
              task_id: string
            }
          }>
        }
      }
      handleMessage(msg: IncomingMessage): Promise<void>
      handleEvent(event: unknown): Promise<void>
    }

    core.adapters = [a]
    core.client = {
      channel: {
        message: async () => ({
          data: {
            kind: "created",
            message: "Task accepted: `task_2`",
            task_id: "task_2",
          },
        }),
      },
    }

    await core.handleMessage(incoming("discord", "run evaluation"))
    await core.handleEvent({
      // SDK Event uses the unprefixed "evaluation.completed" — the SSE route
      // strips "engine." before sending. The test must match the SDK shape.
      type: "evaluation.completed",
      properties: {
        taskID: "task_2",
        runID: "run_1",
        evaluationID: "evaluation_1",
        status: "passed",
        verdict: "accepted",
        summary: "All checks passed",
      },
    })

    expect(sent).toEqual(["ch-1:root-1:Task accepted: `task_2`", "ch-1:root-1:Evaluation accepted: All checks passed"])
    expect(uploads).toHaveLength(0)
  })

  test("routes feishu messages through the shared channel protocol", async () => {
    const sent: string[] = []
    const uploads: Array<{ channel: string; thread: string; filename: string; title?: string }> = []
    const calls: Array<unknown> = []
    const a = adapter("feishu", sent, uploads)
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      client: {
        channel: {
          message(input: unknown): Promise<{
            error?: unknown
            data: {
              kind: "panel_response"
              message: string
              attachments: Array<{ mime: string; url: string; filename?: string }>
            }
          }>
        }
      }
      handleMessage(msg: IncomingMessage): Promise<void>
    }

    core.adapters = [a]
    core.client = {
      channel: {
        message: async (input) => {
          calls.push(input)
          return {
            data: {
              kind: "panel_response",
              message: "Captured OpenCorvus GUI.",
              attachments: [
                {
                  mime: "image/png",
                  filename: "overlay.png",
                  url: "data:image/png;base64,aGVsbG8=",
                },
              ],
            },
          }
        },
      },
    }

    await core.handleMessage({
      platform: "feishu",
      channel: "oc_1",
      thread: "om_1",
      user: "ou_1",
      text: "send gui",
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      platform: "feishu",
      channel: "oc_1",
      thread: "om_1",
      text: "send gui",
      user_id: "ou_1",
      source: "feishu",
      allow_create: true,
    })
    expect(sent).toEqual(["oc_1:om_1:Captured OpenCorvus GUI."])
    expect(uploads).toEqual([
      {
        channel: "oc_1",
        thread: "om_1",
        filename: "overlay.png",
        title: "Captured OpenCorvus GUI.",
      },
    ])
  })

  test("publishes URL attachments for channels that require remote image URLs", async () => {
    const sent: string[] = []
    const uploads: Array<{ channel: string; thread: string; filename: string; title?: string }> = []
    const urlUploads: Array<{ channel: string; thread: string; url: string; filename: string; title?: string }> = []
    const calls: Array<unknown> = []
    const a = adapter("googlechat", sent, uploads, urlUploads)
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      serverUrl: string
      client: {
        channel: {
          message(input: unknown): Promise<{
            error?: unknown
            data: {
              kind: "panel_response"
              message: string
              attachments: Array<{ mime: string; url: string; filename?: string }>
            }
          }>
        }
      }
      handleMessage(msg: IncomingMessage): Promise<void>
    }

    core.adapters = [a]
    core.serverUrl = "http://127.0.0.1:7878"
    core.client = {
      channel: {
        message: async (input) => {
          calls.push(input)
          return {
            data: {
              kind: "panel_response",
              message: "Captured OpenCorvus GUI.",
              attachments: [
                {
                  mime: "image/png",
                  filename: "overlay.png",
                  url: "data:image/png;base64,aGVsbG8=",
                },
              ],
            },
          }
        },
      },
    }
    installFetchMock(async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:7878/channel/attachment")
      expect(init?.method).toBe("POST")
      return Response.json({
        id: "att_test",
        url: "https://public.opencorvus.dev/channel/attachment/att_test?e=1&s=1",
        mime: "image/png",
        filename: "overlay.png",
        expires_at: 1,
      })
    })

    await core.handleMessage(incoming("googlechat", "send gui"))

    expect(calls).toHaveLength(1)
    expect(sent).toEqual(["spaces/AAA:spaces/AAA/threads/t-1:Captured OpenCorvus GUI."])
    expect(uploads).toHaveLength(0)
    expect(urlUploads).toEqual([
      {
        channel: "spaces/AAA",
        thread: "spaces/AAA/threads/t-1",
        url: "https://public.opencorvus.dev/channel/attachment/att_test?e=1&s=1",
        filename: "overlay.png",
        title: "Captured OpenCorvus GUI.",
      },
    ])
  })

  test("surfaces URL attachment upload failures instead of uploading binary copy", async () => {
    const sent: string[] = []
    const uploads: Array<{ channel: string; thread: string; filename: string; title?: string }> = []
    const a: ChannelAdapter = {
      ...adapter("googlechat", sent, uploads),
      uploadImageUrl: async () => {
        throw new Error("url upload failed")
      },
    }
    const core = new ChannelRuntime() as unknown as {
      adapters: ChannelAdapter[]
      serverUrl: string
      client: {
        channel: {
          message(input: unknown): Promise<{
            data: {
              kind: "panel_response"
              message: string
              attachments: Array<{ mime: string; url: string; filename?: string }>
            }
          }>
        }
      }
      handleMessage(msg: IncomingMessage): Promise<void>
    }

    core.adapters = [a]
    core.serverUrl = "http://127.0.0.1:7878"
    core.client = {
      channel: {
        message: async () => ({
          data: {
            kind: "panel_response",
            message: "Captured OpenCorvus GUI.",
            attachments: [
              {
                mime: "image/png",
                filename: "overlay.png",
                url: "data:image/png;base64,aGVsbG8=",
              },
            ],
          },
        }),
      },
    }
    installFetchMock(async () =>
      Response.json({
        id: "att_test",
        url: "https://public.opencorvus.dev/channel/attachment/att_test?e=1&s=1",
        mime: "image/png",
        filename: "overlay.png",
        expires_at: 1,
      }))

    await expect(core.handleMessage(incoming("googlechat", "send gui"))).rejects.toThrow("url upload failed")
    expect(uploads).toHaveLength(0)
  })
})
