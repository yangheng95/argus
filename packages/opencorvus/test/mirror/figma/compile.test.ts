import { describe, test, expect } from "bun:test"

import { compileDesignToXML, compileDesignToXmlString } from "../../../src/mirror/figma/compile"
import { XmlIRSchema } from "../../../src/mirror/ir/xml-ir"
import type { CompressedDesign, CompressedNode } from "../../../src/mirror/ir/compressed-design"

// Golden parity — mirror original
import { figmaCompileService as mirrorCompile } from "D:/myhexin-local/opencode-private/packages/mirror/src/service/figma-compile.ts"

const mirrorCtx = { worktree: ".", onProgress: undefined, onEvent: undefined } as any

function emptyDesign(): CompressedDesign {
  return {
    fileName: "Test",
    lastModified: "2026-04-01",
    figmaUrl: "https://figma.com/file/abc",
    pages: [{ name: "P", frames: [] }],
    components: {},
    componentSets: {},
    tokens: { colors: {}, gradients: [], fonts: [], textStyles: [], effects: [] },
    images: {},
    comments: [],
    stats: { totalNodes: 0, compressedNodes: 0, imageCount: 0, compressionRatio: "1" },
  }
}

function node(id: string, name: string, extras: Partial<CompressedNode> = {}): CompressedNode {
  return { id, name, type: "FRAME", ...extras }
}

// ─── Shape + XmlIR wrapper ────────────────────────────────────────────────

describe("compileDesignToXML — XmlIR shape", () => {
  test("wraps string form in Zod-validated XmlIR", () => {
    const d = emptyDesign()
    const ir = compileDesignToXML(d)
    expect(() => XmlIRSchema.parse(ir)).not.toThrow()
    expect(ir.source).toBe("figma")
    expect(ir.bytes).toBe(Buffer.byteLength(ir.xml, "utf8"))
    expect(ir.estimatedTokens).toBeGreaterThan(0)
    expect(ir.xml).toContain(`<!-- Design: Test`)
  })

  test("empty design still contains metadata header", () => {
    const xml = compileDesignToXmlString(emptyDesign())
    expect(xml).toContain("<!-- Design: Test | Modified: 2026-04-01 -->")
  })
})

// ─── GOLDEN PARITY — byte-level with mirror ───────────────────────────────

describe("compileDesignToXmlString — GOLDEN PARITY byte-level", () => {
  const cases: Array<{ name: string; build: () => CompressedDesign }> = [
    {
      name: "empty design",
      build: () => emptyDesign(),
    },
    {
      name: "single empty frame",
      build: () => {
        const d = emptyDesign()
        d.pages[0].frames = [node("1:1", "Header", { bounds: { x: 0, y: 0, w: 1440, h: 64 } })]
        return d
      },
    },
    {
      name: "mobile viewport hint (width ≤ 768)",
      build: () => {
        const d = emptyDesign()
        d.pages[0].frames = [node("1:1", "MobileFrame", { bounds: { x: 0, y: 0, w: 375, h: 812 } })]
        return d
      },
    },
    {
      name: "text node",
      build: () => {
        const d = emptyDesign()
        d.pages[0].frames = [
          node("1:1", "Frame", {
            bounds: { x: 0, y: 0, w: 320, h: 40 },
            children: [
              {
                id: "1:2",
                name: "Label",
                type: "TEXT",
                text: { content: "Hello World", font: "Inter", size: 16, weight: 700, color: "#000" },
              },
            ],
          }),
        ]
        return d
      },
    },
    {
      name: "image leaf + box leaf",
      build: () => {
        const d = emptyDesign()
        d.pages[0].frames = [
          node("1:1", "Frame", {
            bounds: { x: 0, y: 0, w: 400, h: 400 },
            children: [
              { id: "1:2", name: "Hero", type: "RECT", imageUrl: "https://cdn/x.png", bounds: { x: 0, y: 0, w: 400, h: 200 } },
              { id: "1:3", name: "Block", type: "RECT", bounds: { x: 0, y: 200, w: 400, h: 200 }, style: { bg: "#f5f5f5" } },
            ],
          }),
        ]
        return d
      },
    },
    {
      name: "bottom-anchored tab bar (fixed-bottom)",
      build: () => {
        const d = emptyDesign()
        d.pages[0].frames = [
          node("1:1", "Frame", {
            bounds: { x: 0, y: 0, w: 375, h: 812 },
            children: [
              { id: "1:2", name: "Content", type: "FRAME", bounds: { x: 0, y: 0, w: 375, h: 720 } },
              { id: "1:3", name: "tab_bar", type: "FRAME", bounds: { x: 0, y: 730, w: 375, h: 82 } },
            ],
          }),
        ]
        return d
      },
    },
    {
      name: "sticky header at y=0",
      build: () => {
        const d = emptyDesign()
        d.pages[0].frames = [
          node("1:1", "Frame", {
            bounds: { x: 0, y: 0, w: 1440, h: 900 },
            children: [
              { id: "1:2", name: "header", type: "FRAME", bounds: { x: 0, y: 0, w: 1440, h: 64 } },
              { id: "1:3", name: "main", type: "FRAME", bounds: { x: 0, y: 64, w: 1440, h: 836 } },
            ],
          }),
        ]
        return d
      },
    },
    {
      name: "CJK variant name gets hashed",
      build: () => {
        const d = emptyDesign()
        d.pages[0].frames = [node("1:1", "State=选中态", { bounds: { x: 0, y: 0, w: 100, h: 40 } })]
        return d
      },
    },
    {
      name: "full tokens + components + images",
      build: () => {
        const d = emptyDesign()
        d.tokens = {
          colors: { primary: "#3366ff", surface: "#ffffff" },
          gradients: ["linear-gradient(45deg, #f00, #00f)"],
          fonts: ["Inter", "Roboto"],
          textStyles: [
            { name: "Heading", font: "Inter", size: 32, weight: 700, color: "#000", lineHeight: 40 },
          ],
          effects: [{ name: "shadow-1", type: "DROP_SHADOW", value: "0 2px 8px rgba(0,0,0,0.1)" }],
        }
        d.components = { "c1": { name: "Button", description: "Primary CTA", key: "k1" } }
        d.images = { "1:42": "https://cdn/hero.png" }
        d.pages[0].frames = [node("1:1", "App", { bounds: { x: 0, y: 0, w: 1440, h: 900 } })]
        return d
      },
    },
    {
      name: "node with annotations",
      build: () => {
        const d = emptyDesign()
        d.pages[0].frames = [
          node("1:1", "Frame", {
            bounds: { x: 0, y: 0, w: 400, h: 400 },
            annotations: ["[interaction: tap opens modal]", "[external-component: lib/btn]"],
            children: [node("1:2", "Inner")],
          }),
        ]
        return d
      },
    },
    {
      name: "styled container (bg, radius, shadow, padding, layout, opacity)",
      build: () => {
        const d = emptyDesign()
        d.pages[0].frames = [
          node("1:1", "Card", {
            bounds: { x: 0, y: 0, w: 300, h: 200 },
            layout: {
              mode: "HORIZONTAL",
              primaryAlign: "CENTER",
              counterAlign: "MIN",
              gap: 12,
              padding: [8, 16, 8, 16],
              sizingH: "FIXED",
              sizingV: "FIXED",
            },
            style: {
              bg: "#ffffff",
              border: "1px solid #e5e5e5",
              borderRadius: [8, 8, 0, 0],
              shadow: "0 2px 4px rgba(0,0,0,0.1)",
              opacity: 0.95,
            },
          }),
        ]
        return d
      },
    },
  ]

  for (const c of cases) {
    test(c.name, async () => {
      const d = c.build()
      const ours = compileDesignToXmlString(d)
      const theirs = await mirrorCompile.execute({ design: d }, mirrorCtx)
      expect(ours).toBe(theirs)
    })
  }
})
