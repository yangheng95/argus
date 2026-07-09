import { describe, expect, test } from "bun:test"
import { ControlMessageInput } from "../../src/control/message-schema"
import { controlMessageToolExtra } from "../../src/control/message"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("control message channel binding context", () => {
  test("passes server-derived channel binding into panel tool context", () => {
    const input = ControlMessageInput.parse({
      surface: "slack",
      channel: "C-root",
      thread: "T-root",
      text: "Create a task from channel.",
    })

    expect(controlMessageToolExtra(input)).toMatchObject({
      surface: "slack",
      source: "channel:slack",
      channelBinding: {
        platform: "slack",
        channel: "C-root",
        thread: "T-root",
      },
    })
  })

  test("rejects channel surfaces without complete channel identity before prompting", () => {
    const input = ControlMessageInput.parse({
      surface: "slack",
      channel: "C-root",
      text: "Create a task from a broken channel payload.",
    })

    expect(() => controlMessageToolExtra(input)).toThrow('Control channel surface "slack" requires channel and thread')
  })
})
