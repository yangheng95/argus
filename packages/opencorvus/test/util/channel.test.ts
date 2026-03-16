import { describe, expect, test } from "bun:test"
import { Channel } from "../../src/util/channel"

describe("util.channel", () => {
  test("recv returns null for a pre-aborted signal", async () => {
    const channel = new Channel<string>()
    const controller = new AbortController()
    controller.abort()

    expect(await channel.recv(controller.signal)).toBeNull()
  })
})
