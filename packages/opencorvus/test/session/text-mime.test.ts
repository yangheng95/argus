import { describe, expect, test } from "bun:test"
import { decodeDataUrlBase64, decodeDataUrlBase64Bytes, decodeDataUrlText } from "../../src/session/text-mime"

/**
 * Spec: overlay-image-ingestion-fidelity-2026-05-07.md §helper.
 *
 * `decodeDataUrlBase64` is the strict counterpart to `decodeDataUrlText`:
 * it powers panel.create_task / panel.send_task_message / ChannelIngress
 * binary-attachment forwarding, and must reject anything other than a
 * `data:<mime>;base64,<bytes>` URL. Pre-fix the panel tool used a lenient
 * `url.includes(",") ? url.split(",")[1] : url` cast that quietly turned
 * server-relative `/attachment/<sha>...` URLs and HTTP URLs into "base64"
 * inputs to `Buffer.from(..., "base64")` — bytes were corrupted but the
 * write succeeded, so the build agent silently received a broken visual
 * reference.
 */
describe("decodeDataUrlBase64", () => {
  test("returns the raw base64 payload from a well-formed data URL", () => {
    const raw = decodeDataUrlBase64("data:image/png;base64,SGVsbG8=", "test")
    expect(raw).toBe("SGVsbG8=")
  })

  test("supports common image MIMEs", () => {
    expect(decodeDataUrlBase64("data:image/jpeg;base64,/9j/4AAQ", "test")).toBe("/9j/4AAQ")
    expect(decodeDataUrlBase64("data:application/pdf;base64,JVBERi0=", "test")).toBe("JVBERi0=")
  })

  test("throws on server-relative URL", () => {
    expect(() => decodeDataUrlBase64("/attachment/proj/sha.png", "panel.create_task")).toThrow(/data URL/)
  })

  test("throws on http(s) URL", () => {
    expect(() => decodeDataUrlBase64("https://example.com/files/a.png", "panel.create_task")).toThrow(/data URL/)
  })

  test("throws on data URL without base64 marker (URL-encoded payload)", () => {
    expect(() => decodeDataUrlBase64("data:text/plain,hello%20world", "ChannelIngress")).toThrow(/data URL/)
  })

  test("throws on empty / non-string input", () => {
    expect(() => decodeDataUrlBase64("", "test")).toThrow(/data URL/)
    // @ts-expect-error — runtime guard validates non-string input too.
    expect(() => decodeDataUrlBase64(undefined, "test")).toThrow(/data URL/)
  })

  test("throws on malformed base64 payloads instead of returning corrupt bytes", () => {
    expect(() => decodeDataUrlBase64("data:image/png;base64,not base64!*", "test")).toThrow(/invalid base64/)
    expect(() => decodeDataUrlBase64("data:image/png;base64,A", "test")).toThrow(/invalid base64/)
    expect(() => decodeDataUrlBase64Bytes("data:image/png;base64,not base64!*", "test")).toThrow(/invalid base64/)
  })

  test("error message includes both context and a preview of the bad input", () => {
    let err: Error | undefined
    try {
      decodeDataUrlBase64("/attachment/proj/sha.png", "panel.create_task attachment 'design.png'")
    } catch (caught) {
      err = caught as Error
    }
    expect(err?.message).toContain("panel.create_task")
    expect(err?.message).toContain("design.png")
    expect(err?.message).toContain("/attachment/proj/sha.png")
  })

  test("text decoder uses the same strict data URL payload contract", () => {
    expect(decodeDataUrlText("data:text/markdown;base64,IyBIZWxsbw==")).toBe("# Hello")
    expect(() => decodeDataUrlText("not a data url")).toThrow(/data URL/)
    expect(() => decodeDataUrlText("data:text/markdown;base64,not base64!*")).toThrow(/invalid base64/)
  })
})
