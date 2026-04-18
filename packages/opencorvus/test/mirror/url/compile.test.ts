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

// Golden parity — mirror original
import { urlCompileService as mirrorCompile } from "D:/myhexin-local/opencode-private/packages/mirror/src/service/url-compile.ts"
import {
  siblingFingerprint as mirrorSiblingFingerprint,
  detectRepeats as mirrorDetectRepeats,
  adaptiveRepeatThreshold as mirrorAdaptiveRepeatThreshold,
  extractRepeatItem as mirrorExtractRepeatItem,
  hasVariedContent as mirrorHasVariedContent,
  normalizeUrl as mirrorNormalizeUrl,
  compileElement as mirrorCompileElement,
} from "D:/myhexin-local/opencode-private/packages/mirror/src/service/url-compile.ts"

const mirrorCtx = { worktree: ".", onProgress: undefined, onEvent: undefined } as any

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

// ─── GOLDEN PARITY on pure helpers ────────────────────────────────────────

describe("url/compile — GOLDEN PARITY on pure helpers", () => {
  const urls = [
    "",
    "blob:http://example.test/abc",
    "//cdn.example.test/logo.png",
    "https://example.test/logo.png",
    "data:image/png;base64,AAA",
  ]
  test.each(urls)("normalizeUrl(%p) matches mirror", (u) => {
    expect(normalizeUrl(u)).toBe(mirrorNormalizeUrl(u))
  })

  test("siblingFingerprint matches mirror on same element", () => {
    const e: ExtractedElement = el({
      tag: "li",
      role: "card",
      bounds: { x: 0, y: 0, w: 200, h: 100 },
      styles: { display: "flex", flexDirection: "row" },
      children: [el({ tag: "h2", bounds: { x: 0, y: 0, w: 100, h: 20 } }), el({ tag: "p" })],
    })
    expect(siblingFingerprint(e)).toBe(mirrorSiblingFingerprint(e))
  })

  test("adaptiveRepeatThreshold parity across sibling counts", () => {
    for (const count of [0, 1, 10, 15, 16, 100]) {
      for (const base of [2, 3, 4, 10]) {
        expect(adaptiveRepeatThreshold(count, base)).toBe(mirrorAdaptiveRepeatThreshold(count, base))
      }
    }
  })

  test("detectRepeats groups identical structures", () => {
    const children: ExtractedElement[] = [
      el({ tag: "li", text: "item 1", bounds: { x: 0, y: 0, w: 100, h: 40 } }),
      el({ tag: "li", text: "item 2", bounds: { x: 0, y: 40, w: 100, h: 40 } }),
      el({ tag: "li", text: "item 3", bounds: { x: 0, y: 80, w: 100, h: 40 } }),
      el({ tag: "h1", text: "heading", bounds: { x: 0, y: 120, w: 200, h: 40 } }),
    ]
    const ours = detectRepeats(children, 3)
    const theirs = mirrorDetectRepeats(children, 3)
    expect(ours.length).toBe(theirs.length)
    // Structural compare
    for (let i = 0; i < ours.length; i++) {
      expect(JSON.stringify(ours[i])).toBe(JSON.stringify(theirs[i]))
    }
  })

  test("extractRepeatItem and hasVariedContent parity", () => {
    const e = el({
      children: [
        el({ tag: "img", imageSrc: "https://cdn/a.png" }),
        el({ tag: "h3", text: "title a" }),
        el({ tag: "a", href: "https://example.test/a" }),
      ],
    })
    const ours = extractRepeatItem(e)
    const theirs = mirrorExtractRepeatItem(e)
    expect(ours).toEqual(theirs)
    const items = [ours, theirs]
    expect(hasVariedContent(items)).toBe(mirrorHasVariedContent(items))
  })
})

// ─── compileElement — GOLDEN PARITY on subtrees ───────────────────────────

describe("compileElement — GOLDEN PARITY byte-level", () => {
  const cases: Array<{ name: string; el: ExtractedElement }> = [
    { name: "bare box", el: el({ bounds: { x: 0, y: 0, w: 50, h: 50 } }) },
    {
      name: "text leaf",
      el: el({
        tag: "p",
        text: "Hello World",
        bounds: { x: 0, y: 0, w: 200, h: 24 },
        styles: { fontFamily: "Inter", fontSize: "16px", fontWeight: "500", color: "rgb(0,0,0)" },
      }),
    },
    {
      name: "image leaf",
      el: el({
        tag: "img",
        imageSrc: "https://cdn/hero.png",
        imageAlt: "hero",
        bounds: { x: 0, y: 0, w: 400, h: 200 },
      }),
    },
    {
      name: "icon-font <i class='fa-home'>",
      el: el({
        tag: "i",
        classes: ["fa", "fa-home"],
        bounds: { x: 0, y: 0, w: 16, h: 16 },
      }),
    },
    {
      name: "decorative dot (below 8x8)",
      el: el({ tag: "span", bounds: { x: 0, y: 0, w: 4, h: 4 }, styles: {} }),
    },
    {
      name: "flex-row container with style + border-radius",
      el: el({
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
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        },
        children: [
          el({ tag: "img", imageSrc: "https://cdn/icon.png", bounds: { x: 0, y: 0, w: 32, h: 32 } }),
          el({ tag: "p", text: "Description", bounds: { x: 0, y: 0, w: 200, h: 24 } }),
        ],
      }),
    },
    {
      name: "anchor container with href",
      el: el({
        tag: "a",
        href: "//cdn.example.test/page",
        bounds: { x: 0, y: 0, w: 100, h: 24 },
        children: [el({ tag: "span", text: "Click here" })],
      }),
    },
    {
      name: "mixed-content text with inline children",
      el: el({
        tag: "h2",
        text: "Hello  World  Rocks",
        styles: { fontSize: "24px" },
        children: [
          el({
            tag: "span",
            text: "Amazing",
            styles: { display: "inline", fontWeight: "700" },
          }),
          el({
            tag: "span",
            text: "Bold",
            styles: { display: "inline", fontWeight: "900" },
          }),
        ],
      }),
    },
  ]

  for (const c of cases) {
    test(c.name, () => {
      const ours = compileElement(c.el, 0, 99, undefined, { maxSiblings: Infinity, repeatThreshold: Infinity })
      const theirs = mirrorCompileElement(c.el, 0, 99, undefined, { maxSiblings: Infinity, repeatThreshold: Infinity })
      expect(ours).toBe(theirs)
    })
  }
})

// ─── compilePageToXmlString — GOLDEN PARITY whole page ────────────────────

describe("compilePageToXmlString — GOLDEN PARITY byte-level", () => {
  const cases: Array<{ name: string; build: () => ExtractedPage }> = [
    {
      name: "empty page with title + viewport",
      build: () => page([]),
    },
    {
      name: "page with tokens + fonts + custom props",
      build: () =>
        page([], {
          tokens: {
            colors: { primary: "#3366ff", surface: "#ffffff" },
            fonts: ["Inter", "Roboto"],
            customProperties: { "--spacing-base": "8px" },
          },
        }),
    },
    {
      name: "page with image assets (dedup test)",
      build: () =>
        page(
          [el({ tag: "img", imageSrc: "https://cdn/logo.png", bounds: { x: 0, y: 0, w: 64, h: 64 } })],
          {
            assets: {
              images: [
                { src: "https://cdn/logo.png", alt: "logo" },
                { src: "https://cdn/logo.png", alt: "logo" }, // dup
                { src: "https://cdn/hero.png", alt: "hero" },
              ],
              icons: [],
            },
          },
        ),
    },
    {
      name: "typical landing-page subset (header + hero + cards)",
      build: () =>
        page(
          [
            el({
              tag: "header",
              role: "header",
              bounds: { x: 0, y: 0, w: 1440, h: 64 },
              styles: { display: "flex", justifyContent: "space-between", padding: "16px 24px" },
              children: [
                el({ tag: "a", text: "Home", href: "/home", bounds: { x: 0, y: 0, w: 64, h: 24 } }),
                el({ tag: "a", text: "About", href: "/about", bounds: { x: 0, y: 0, w: 64, h: 24 } }),
              ],
            }),
            el({
              tag: "section",
              role: "hero",
              bounds: { x: 0, y: 64, w: 1440, h: 400 },
              styles: {
                padding: "48px 24px",
                backgroundImage: "linear-gradient(135deg, rgb(51,102,255), rgb(0,212,255))",
              },
              children: [
                el({ tag: "h1", text: "Welcome", bounds: { x: 0, y: 0, w: 400, h: 40 } }),
                el({ tag: "p", text: "Tagline here", bounds: { x: 0, y: 40, w: 400, h: 24 } }),
              ],
            }),
            el({
              tag: "section",
              role: "card",
              bounds: { x: 0, y: 464, w: 1440, h: 400 },
              styles: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", padding: "24px" },
              children: [
                el({
                  tag: "div",
                  role: "card",
                  bounds: { x: 0, y: 0, w: 700, h: 200 },
                  styles: { backgroundColor: "rgb(255,255,255)", borderRadius: "8px", padding: "16px" },
                  children: [
                    el({ tag: "h2", text: "Feature A", bounds: { x: 0, y: 0, w: 600, h: 24 } }),
                    el({ tag: "p", text: "Description A", bounds: { x: 0, y: 24, w: 600, h: 24 } }),
                  ],
                }),
                el({
                  tag: "div",
                  role: "card",
                  bounds: { x: 0, y: 0, w: 700, h: 200 },
                  styles: { backgroundColor: "rgb(255,255,255)", borderRadius: "8px", padding: "16px" },
                  children: [
                    el({ tag: "h2", text: "Feature B", bounds: { x: 0, y: 0, w: 600, h: 24 } }),
                    el({ tag: "p", text: "Description B", bounds: { x: 0, y: 24, w: 600, h: 24 } }),
                  ],
                }),
              ],
            }),
          ],
          {
            tokens: {
              colors: { primary: "rgb(51,102,255)" },
              fonts: ["Inter"],
              customProperties: {},
            },
          },
        ),
    },
    {
      name: "list with 4 repeating items (triggers Repeat group)",
      build: () => {
        const items = Array.from({ length: 5 }, (_, i) =>
          el({
            tag: "li",
            text: `Item ${i + 1}`,
            bounds: { x: 0, y: i * 40, w: 200, h: 40 },
          }),
        )
        return page([
          el({
            tag: "ul",
            role: "list",
            bounds: { x: 0, y: 0, w: 200, h: 200 },
            children: items,
          }),
        ])
      },
    },
  ]

  for (const c of cases) {
    test(c.name, async () => {
      const p = c.build()
      const ours = compilePageToXmlString({ page: p })
      const theirs = await mirrorCompile.execute({ page: p }, mirrorCtx)
      expect(ours).toBe(theirs)
    })
  }
})

// ─── compilePageToXML — wraps as XmlIR ────────────────────────────────────

describe("compilePageToXML — XmlIR wrapper", () => {
  test("output validates as XmlIR with source='url'", () => {
    const p = page([])
    const ir = compilePageToXML({ page: p })
    expect(() => XmlIRSchema.parse(ir)).not.toThrow()
    expect(ir.source).toBe("url")
    expect(ir.bytes).toBe(Buffer.byteLength(ir.xml, "utf8"))
    expect(ir.estimatedTokens).toBeGreaterThan(0)
  })
})
