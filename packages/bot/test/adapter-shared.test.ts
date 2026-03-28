import { describe, expect, test } from "bun:test"
import { emit, threadId } from "../src/adapters/shared"

describe("adapter shared helpers", () => {
  test("threadId returns the first usable value", () => {
    expect(threadId(undefined, "", "reply-1", "reply-2")).toBe("reply-1")
  })

  test("threadId falls back when no value exists", () => {
    expect(threadId()).toMatch(/^\d+$/)
  })

  test("emit normalizes ids and allows audio-only messages", async () => {
    const seen: Array<Record<string, unknown>> = []

    const handled = await emit(async (msg) => {
      seen.push(msg as unknown as Record<string, unknown>)
    }, {
      platform: "telegram",
      channel: 1,
      thread: [undefined, 2],
      user: 3,
      text: "",
      audio: {
        data: Buffer.from("voice"),
        mime: "audio/ogg",
        size: 5,
      },
    })

    expect(handled).toBe(true)
    expect(seen).toEqual([
      {
        platform: "telegram",
        channel: "1",
        thread: "2",
        user: "3",
        text: "",
        audio: {
          data: Buffer.from("voice"),
          mime: "audio/ogg",
          size: 5,
        },
      },
    ])
  })
})
