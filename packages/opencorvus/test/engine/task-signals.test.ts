import { describe, expect, test } from "bun:test"
import { deriveUrlSignals } from "../../src/engine/task-signals"

describe("deriveUrlSignals", () => {
  test("partitions figma URLs out of the generic URL signal", () => {
    expect(deriveUrlSignals("复刻 https://www.figma.com/design/abc/title")).toEqual({
      request_contains_url: false,
      request_contains_figma_url: true,
    })
    expect(deriveUrlSignals("clone https://example.com/")).toEqual({
      request_contains_url: true,
      request_contains_figma_url: false,
    })
    expect(deriveUrlSignals("纯文本 - 无 URL")).toEqual({
      request_contains_url: false,
      request_contains_figma_url: false,
    })
  })

  test("text containing both a figma URL and another URL splits cleanly", () => {
    const out = deriveUrlSignals("Mockup at https://www.figma.com/file/xyz, also see https://example.com/spec")
    expect(out.request_contains_figma_url).toBe(true)
    expect(out.request_contains_url).toBe(true)
  })

  test("multiple figma URLs are all excluded from the generic URL signal", () => {
    const out = deriveUrlSignals(
      [
        "Compare https://www.figma.com/design/abc/title?node-id=1-2",
        "and https://figma.com/file/xyz/second?node-id=3-4",
      ].join(" "),
    )
    expect(out).toEqual({
      request_contains_url: false,
      request_contains_figma_url: true,
    })
  })

  test("recognises figma proto / board / design / file paths", () => {
    for (const path of ["file", "design", "proto", "board"]) {
      expect(deriveUrlSignals(`https://figma.com/${path}/abc/x`).request_contains_figma_url).toBe(true)
    }
  })

  test("undefined / empty input is fully false", () => {
    expect(deriveUrlSignals(undefined)).toEqual({
      request_contains_url: false,
      request_contains_figma_url: false,
    })
    expect(deriveUrlSignals("")).toEqual({
      request_contains_url: false,
      request_contains_figma_url: false,
    })
  })
})
