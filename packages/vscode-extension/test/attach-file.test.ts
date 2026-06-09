import { describe, expect, test } from "bun:test"
import { guessMime } from "../src/commands/attach-file-helpers"
import { PROTOCOL_VERSION, isExtensionMessage, type ExtensionUiCommandMessage } from "@opencorvus-ai/transport-protocol"

describe("guessMime", () => {
  test("recognises bundled image types", () => {
    expect(guessMime("logo.png", "")).toBe("image/png")
    expect(guessMime("photo.jpg", "")).toBe("image/jpeg")
    expect(guessMime("photo.JPEG", "")).toBe("image/jpeg")
    expect(guessMime("anim.gif", "")).toBe("image/gif")
    expect(guessMime("vector.svg", "")).toBe("image/svg+xml")
    expect(guessMime("modern.webp", "")).toBe("image/webp")
  })

  test("recognises common text formats", () => {
    expect(guessMime("doc.md", "")).toBe("text/markdown")
    expect(guessMime("page.html", "")).toBe("text/html")
    expect(guessMime("style.css", "")).toBe("text/css")
    expect(guessMime("config.json", "")).toBe("application/json")
  })

  test("uses languageId for json without extension", () => {
    expect(guessMime("settings", "json")).toBe("application/json")
  })

  test("unlisted VS Code text documents resolve to text/plain", () => {
    expect(guessMime("script.ts", "typescript")).toBe("text/plain")
    expect(guessMime("module.rs", "rust")).toBe("text/plain")
    expect(guessMime("noext", "")).toBe("text/plain")
  })
})

describe("ExtensionUiCommandMessage", () => {
  test("isExtensionMessage accepts a well-formed ui-command envelope", () => {
    const msg: ExtensionUiCommandMessage = {
      protocol: PROTOCOL_VERSION,
      type: "ui-command",
      kind: "composer.attach",
      payload: { filename: "x.ts", mime: "text/plain", dataUrl: "data:text/plain;base64,", sourcePath: "/x.ts" },
    }
    expect(isExtensionMessage(msg)).toBe(true)
  })

  test("isExtensionMessage rejects mismatched protocol version", () => {
    expect(
      isExtensionMessage({
        protocol: 999,
        type: "ui-command",
        kind: "composer.attach",
        payload: {},
      }),
    ).toBe(false)
  })
})
