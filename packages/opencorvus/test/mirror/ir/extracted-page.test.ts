import { describe, test, expect } from "bun:test"
import {
  ExtractedPageSchema,
  ExtractedElementSchema,
  ExtractedStylesSchema,
  type ExtractedPage,
  type ExtractedElement,
} from "../../../src/mirror/ir/extracted-page"

function minimalPage(): ExtractedPage {
  return {
    url: "https://example.test/",
    title: "Example",
    viewport: { width: 1440, height: 900 },
    screenshotUrl: "data:image/png;base64,AAA",
    tree: [
      {
        selector: "body",
        tag: "body",
        bounds: { x: 0, y: 0, w: 1440, h: 900 },
        styles: {},
      },
    ],
    tokens: { colors: {}, fonts: [], customProperties: {} },
    assets: { images: [], icons: [] },
    stats: { totalElements: 1, extractedElements: 1, imageCount: 0, extractionTimeMs: 42 },
  }
}

describe("ExtractedPageSchema", () => {
  test("accepts minimal page", () => {
    const parsed = ExtractedPageSchema.parse(minimalPage())
    expect(parsed.title).toBe("Example")
  })

  test("rejects missing viewport", () => {
    const page = minimalPage() as unknown as Record<string, unknown>
    delete page.viewport
    expect(() => ExtractedPageSchema.parse(page)).toThrow()
  })

  test("accepts optional imageMap in assets", () => {
    const page = minimalPage()
    page.assets.imageMap = { "https://cdn/a.png": "images/img-0.png" }
    expect(() => ExtractedPageSchema.parse(page)).not.toThrow()
  })
})

describe("ExtractedElementSchema — recursive", () => {
  test("accepts deeply-nested children", () => {
    const el: ExtractedElement = {
      selector: "main",
      tag: "main",
      role: "main",
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      styles: {},
      children: [
        {
          selector: "main > h1",
          tag: "h1",
          bounds: { x: 0, y: 0, w: 100, h: 40 },
          styles: { fontSize: "32px" },
          text: "Hello",
        },
      ],
    }
    expect(() => ExtractedElementSchema.parse(el)).not.toThrow()
  })

  test("rejects invalid role enum", () => {
    expect(() =>
      ExtractedElementSchema.parse({
        selector: "div",
        tag: "div",
        role: "not-a-role",
        bounds: { x: 0, y: 0, w: 1, h: 1 },
        styles: {},
      }),
    ).toThrow()
  })
})

describe("ExtractedStylesSchema — pruned CSS bag", () => {
  test("accepts empty object", () => {
    expect(ExtractedStylesSchema.parse({})).toEqual({})
  })

  test("accepts the ~35 known CSS fields", () => {
    const styles = {
      display: "flex",
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: "8px",
      padding: "16px",
      margin: "0px",
      width: "100%",
      height: "64px",
      backgroundColor: "#fff",
      border: "1px solid #eee",
      borderRadius: "8px",
      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
      fontSize: "14px",
      fontWeight: "500",
      color: "#333",
      textAlign: "left",
    }
    expect(() => ExtractedStylesSchema.parse(styles)).not.toThrow()
  })

  test("ignores unknown fields (passthrough=false, excess stripped)", () => {
    const parsed = ExtractedStylesSchema.parse({ color: "#000", bogus: "ignored" })
    expect(parsed.color).toBe("#000")
    expect("bogus" in parsed).toBe(false)
  })
})
