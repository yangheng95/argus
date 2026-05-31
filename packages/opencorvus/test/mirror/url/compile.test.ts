import { describe, test, expect } from "bun:test"

import {
  compilePageToXML,
  compilePageToXmlString,
  compileElement,
  normalizeUrl,
  siblingFingerprint,
  detectRepeats,
  adaptiveRepeatThreshold,
  extractRepeatItem,
  hasVariedContent,
} from "../../../src/mirror/url/compile"
import type { ExtractedElement, ExtractedPage } from "../../../src/mirror/ir/extracted-page"
import { XmlIRSchema } from "../../../src/mirror/ir/xml-ir"

function el(extra: Partial<ExtractedElement> = {}): ExtractedElement {
  return {
    selector: "div",
    tag: "div",
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    styles: {},
    ...extra,
  } as ExtractedElement
}

function page(tree: ExtractedElement[], extra: Partial<ExtractedPage> = {}): ExtractedPage {
  return {
    url: "https://example.test/",
    title: "Test",
    viewport: { width: 1440, height: 900 },
    screenshotUrl: "",
    tree,
    tokens: { colors: {}, fonts: [], customProperties: {} },
    assets: { images: [], icons: [] },
    stats: { totalElements: tree.length, extractedElements: tree.length, imageCount: 0, extractionTimeMs: 0 },
    ...extra,
  }
}

describe("url/compile helpers", () => {
  test("normalizes non-portable URLs", () => {
    expect(normalizeUrl("")).toBe("")
    expect(normalizeUrl("blob:http://example.test/abc")).toBe("")
    expect(normalizeUrl("//cdn.example.test/logo.png")).toBe("https://cdn.example.test/logo.png")
    expect(normalizeUrl("https://example.test/logo.png")).toBe("https://example.test/logo.png")
    expect(normalizeUrl("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA")
  })

  test("detects repeated sibling structures", () => {
    const children: ExtractedElement[] = [
      el({ tag: "li", text: "item 1", bounds: { x: 0, y: 0, w: 100, h: 40 } }),
      el({ tag: "li", text: "item 2", bounds: { x: 0, y: 40, w: 100, h: 40 } }),
      el({ tag: "li", text: "item 3", bounds: { x: 0, y: 80, w: 100, h: 40 } }),
      el({ tag: "h1", text: "heading", bounds: { x: 0, y: 120, w: 200, h: 40 } }),
    ]

    expect(siblingFingerprint(children[0])).toBe(siblingFingerprint(children[1]))
    expect(adaptiveRepeatThreshold(16, 3)).toBe(4)
    expect(detectRepeats(children, 3).some((group) => group.count === 3)).toBe(true)
  })

  test("extracts repeat item content and detects variation", () => {
    const first = extractRepeatItem(
      el({
        children: [
          el({ tag: "img", imageSrc: "https://cdn/a.png" }),
          el({ tag: "h3", text: "title a" }),
          el({ tag: "a", href: "https://example.test/a" }),
        ],
      }),
    )
    const second = extractRepeatItem(
      el({
        children: [
          el({ tag: "img", imageSrc: "https://cdn/b.png" }),
          el({ tag: "h3", text: "title b" }),
          el({ tag: "a", href: "https://example.test/b" }),
        ],
      }),
    )

    expect(first).toEqual({
      texts: ["title a"],
      images: ["https://cdn/a.png"],
      hrefs: ["https://example.test/a"],
    })
    expect(hasVariedContent([first, second])).toBe(true)
  })
})

describe("compileElement", () => {
  test("compiles a styled container with text and image children", () => {
    const xml = compileElement(
      el({
        tag: "div",
        role: "card",
        bounds: { x: 0, y: 0, w: 320, h: 180 },
        styles: {
          display: "flex",
          flexDirection: "row",
          gap: "12px",
          padding: "16px",
          backgroundColor: "rgb(255,255,255)",
          borderRadius: "8px",
        },
        children: [
          el({ tag: "img", imageSrc: "https://cdn/icon.png", imageAlt: "icon", bounds: { x: 0, y: 0, w: 32, h: 32 } }),
          el({ tag: "p", text: "Description", bounds: { x: 0, y: 0, w: 200, h: 24 } }),
        ],
      }),
      0,
      99,
      undefined,
      { maxSiblings: Infinity, repeatThreshold: Infinity },
    )

    expect(xml).toContain("<Container")
    expect(xml).toContain('role="card"')
    expect(xml).toContain('layout="HORIZONTAL gap:12px"')
    expect(xml).toContain('src="https://cdn/icon.png"')
    expect(xml).toContain('>Description</Text>')
  })
})

describe("compilePageToXmlString", () => {
  test("includes metadata, tokens, assets, and structure", () => {
    const xml = compilePageToXmlString({
      page: page(
        [el({ tag: "h1", text: "Welcome", bounds: { x: 0, y: 0, w: 400, h: 40 } })],
        {
          tokens: {
            colors: { primary: "#3366ff", surface: "#ffffff" },
            fonts: ["Inter"],
            customProperties: { "--spacing-base": "8px" },
          },
          assets: {
            images: [{ src: "images/logo.png", alt: "logo" }],
            icons: [],
          },
        },
      ),
    })

    expect(xml).toContain("<!-- Page: Test")
    expect(xml).toContain("<!-- Design Tokens: Colors")
    expect(xml).toContain("primary: #3366ff")
    expect(xml).toContain("img-0: images/logo.png (logo)")
    expect(xml).toContain('>Welcome</Text>')
  })

  test("background image styles use mirror-local asset paths from imageMap", () => {
    const dataUrl = "data:image/png;base64,AAA"
    const xml = compilePageToXmlString({
      page: page(
        [
          el({
            tag: "div",
            bounds: { x: 0, y: 0, w: 20, h: 20 },
            styles: { backgroundImage: `url("${dataUrl}")` },
          }),
        ],
        {
          assets: {
            images: [{ src: "images/background/background-0.png", alt: "bg: div" }],
            icons: [],
            imageMap: { [dataUrl]: "images/background/background-0.png" },
          },
        },
      ),
    })

    expect(xml).toContain('bg-image="images/background/background-0.png"')
    expect(xml).not.toContain("data:image/png;base64")
  })
})

describe("compilePageToXML", () => {
  test("wraps the compiled XML as a valid XmlIR", () => {
    const ir = compilePageToXML({ page: page([]) })

    expect(() => XmlIRSchema.parse(ir)).not.toThrow()
    expect(ir.source).toBe("url")
    expect(ir.bytes).toBe(Buffer.byteLength(ir.xml, "utf8"))
    expect(ir.estimatedTokens).toBeGreaterThan(0)
  })
})
