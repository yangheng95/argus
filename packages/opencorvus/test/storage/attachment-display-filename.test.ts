import { describe, expect, test } from "bun:test"
import { AttachmentStore } from "../../src/storage/attachment-store"

// Regression rationale (rule 36): the user observed sub-agents
// receiving 64-character sha names like
// `529bae80ab6f536429433755ed5710e9bba81299a98ceaa34aaf30c85969b690.png`
// in the attachment inventory. Root cause was three call sites each
// implementing their own `filename ?? sha` substitute — when the upload
// path lost the original name, the sha leaked through. These tests
// pin the single-source helper down so any future caller (rule 9)
// gets a readable handle without re-inventing another naming policy.

describe("AttachmentStore.displayFilename", () => {
  test("returns the original name when it is shell-safe", () => {
    expect(
      AttachmentStore.displayFilename({
        filename: "screenshot.png",
        mime: "image/png",
        sha: "deadbeefdeadbeef",
        index: 0,
      }),
    ).toBe("screenshot.png")
  })

  test("accepts CJK + space (matches stageToWorktree's safe regex)", () => {
    expect(
      AttachmentStore.displayFilename({
        filename: "另一个 截图.png",
        mime: "image/png",
        sha: "abcd1234",
        index: 1,
      }),
    ).toBe("另一个 截图.png")
  })

  test("generates attachment-<i>-<sha8>.<ext> when name is missing", () => {
    expect(
      AttachmentStore.displayFilename({
        filename: undefined,
        mime: "image/png",
        sha: "529bae80ab6f5364",
        index: 0,
      }),
    ).toBe("attachment-1-529bae80.png")
  })

  test("generates a display name when name contains shell-unsafe characters", () => {
    expect(
      AttachmentStore.displayFilename({
        filename: "evil$name|with;chars.png",
        mime: "image/png",
        sha: "0123456789abcdef",
        index: 2,
      }),
    ).toBe("attachment-3-01234567.png")
  })

  test("generates a display name when name contains a path separator", () => {
    expect(
      AttachmentStore.displayFilename({
        filename: "../etc/passwd",
        mime: "text/plain",
        sha: "abc123def456",
        index: 0,
      }),
    ).toBe("attachment-1-abc123de.txt")
  })

  test("uses 'noref' when sha is also missing — never invents a hex handle", () => {
    expect(
      AttachmentStore.displayFilename({
        filename: "",
        mime: "image/png",
        sha: undefined,
        index: 0,
      }),
    ).toBe("attachment-1-noref.png")
  })

  test("treats omitted index as the first attachment", () => {
    expect(
      AttachmentStore.displayFilename({
        filename: undefined,
        mime: "image/jpeg",
        sha: "abcd0000",
      }),
    ).toBe("attachment-1-abcd0000.jpg")
  })

  test("never returns a bare 64-char sha — that was the original bug", () => {
    const sha = "529bae80ab6f536429433755ed5710e9bba81299a98ceaa34aaf30c85969b690"
    const out = AttachmentStore.displayFilename({
      filename: undefined,
      mime: "image/png",
      sha,
      index: 0,
    })
    expect(out).not.toBe(`${sha}.png`)
    expect(out).toBe("attachment-1-529bae80.png")
  })
})

describe("AttachmentStore.renderAttachmentInventory", () => {
  test("substitutes a readable handle when the upload dropped the filename", () => {
    const inventory = AttachmentStore.renderAttachmentInventory([
      {
        sha: "529bae80ab6f536429433755ed5710e9bba81299a98ceaa34aaf30c85969b690",
        mime: "image/png",
        size: 12_345,
        url: "/attachment/proj/anything.png",
        // filename intentionally omitted — emulates the paste path
        // before the overlay client-side fix.
      } as any,
    ])
    expect(inventory).toContain("attachment-1-529bae80.png")
    // The bare sha must NEVER appear as the rendered name (it may
    // still appear inside the url; that's expected).
    const lines = inventory.split("\n")
    const itemLine = lines.find((l) => l.startsWith("- ")) ?? ""
    const beforeUrl = itemLine.split(" url: ")[0]
    expect(beforeUrl).not.toContain("529bae80ab6f536429433755ed5710e9bba81299a98ceaa34aaf30c85969b690.png")
  })

  test("preserves the original filename when it is shell-safe", () => {
    const inventory = AttachmentStore.renderAttachmentInventory([
      {
        sha: "abc123def456",
        mime: "image/png",
        size: 1024,
        url: "/attachment/proj/screenshot.png",
        filename: "screenshot.png",
      } as any,
    ])
    expect(inventory).toContain("screenshot.png")
  })
})
