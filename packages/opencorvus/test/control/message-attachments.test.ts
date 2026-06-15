import { describe, expect, test } from "bun:test"
import { ControlMessageInput, ControlMessageResult } from "../../src/control/message-schema"
import { AttachmentStore } from "../../src/storage/attachment-store"

describe("control message attachment references", () => {
  test("result attachments must be stored .opencorvus attachment references", () => {
    expect(() =>
      ControlMessageResult.parse({
        kind: "panel_response",
        message: "bad",
        attachments: [{ mime: "image/png", url: "data:image/png;base64,AAAA", filename: "inline.png" }],
      }),
    ).toThrow()

    expect(() =>
      ControlMessageResult.parse({
        kind: "panel_response",
        message: "bad",
        attachments: [{ mime: "image/png", url: "/api/local.png", filename: "local.png" }],
      }),
    ).toThrow()

    const parsed = ControlMessageResult.parse({
      kind: "panel_response",
      message: "ok",
      attachments: [{ mime: "image/png", url: "/attachment/project/sha.png", filename: "stored.png" }],
    })

    expect(parsed.attachments?.[0]?.url).toBe("/attachment/project/sha.png")
  })

  test("input attachments remain available for task APIs to materialize", () => {
    const parsed = ControlMessageInput.parse({
      surface: "panel",
      text: "create a task from this image",
      attachments: [{ mime: "image/png", url: "data:image/png;base64,AAAA", filename: "input.png" }],
    })

    expect(parsed.attachments?.[0]?.url).toBe("data:image/png;base64,AAAA")
  })

  test("attachment url parser matches the served route shape", () => {
    expect(AttachmentStore.nameFromUrl("/attachment/project/sha.png")).toEqual({ projectID: "project", name: "sha.png" })
    expect(AttachmentStore.nameFromUrl("/attachment/project/sha.png/extra")).toBeUndefined()
    expect(AttachmentStore.nameFromUrl("/attachment/project/sha.png?x=1")).toBeUndefined()
    expect(AttachmentStore.nameFromUrl("/attachment/project/sha.png#x")).toBeUndefined()
  })
})
