import { describe, test, expect } from "bun:test"

import { compileDesignToXML, compileDesignToXmlString } from "../../../src/mirror/figma/compile"
import { XmlIRSchema } from "../../../src/mirror/ir/xml-ir"
import type { CompressedDesign, CompressedNode } from "../../../src/mirror/ir/compressed-design"

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

describe("compileDesignToXML", () => {
  test("wraps string form in Zod-validated XmlIR", () => {
    const ir = compileDesignToXML(emptyDesign())
    expect(() => XmlIRSchema.parse(ir)).not.toThrow()
    expect(ir.source).toBe("figma")
    expect(ir.bytes).toBe(Buffer.byteLength(ir.xml, "utf8"))
    expect(ir.estimatedTokens).toBeGreaterThan(0)
    expect(ir.xml).toContain("<!-- Design: Test")
  })

  test("empty design still contains metadata header", () => {
    const xml = compileDesignToXmlString(emptyDesign())
    expect(xml).toContain("<!-- Design: Test | Modified: 2026-04-01 -->")
  })

  test("compiles frames, text, image, and style attributes", () => {
    const design = emptyDesign()
    design.tokens = {
      colors: { primary: "#3366ff", surface: "#ffffff" },
      gradients: ["linear-gradient(45deg, #f00, #00f)"],
      fonts: ["Inter"],
      textStyles: [{ name: "Heading", font: "Inter", size: 32, weight: 700, color: "#000", lineHeight: 40 }],
      effects: [{ name: "shadow-1", type: "DROP_SHADOW", value: "0 2px 8px rgba(0,0,0,0.1)" }],
    }
    design.components = { c1: { name: "Button", description: "Primary CTA", key: "k1" } }
    design.images = { "1:2": "https://cdn/hero.png" }
    design.pages[0].frames = [
      node("1:1", "Card", {
        bounds: { x: 0, y: 0, w: 300, h: 200 },
        layout: { mode: "HORIZONTAL", gap: 12, padding: [8, 16, 8, 16], sizingH: "FIXED", sizingV: "FIXED" },
        style: { bg: "#ffffff", border: "1px solid #e5e5e5", borderRadius: [8, 8, 0, 0], opacity: 0.95 },
        children: [
          { id: "1:2", name: "Hero", type: "RECT", imageUrl: "https://cdn/hero.png", bounds: { x: 0, y: 0, w: 300, h: 120 } },
          {
            id: "1:3",
            name: "Label",
            type: "TEXT",
            text: { content: "Hello World", font: "Inter", size: 16, weight: 700, color: "#000" },
          },
        ],
      }),
    ]

    const xml = compileDesignToXmlString(design)
    expect(xml).toContain("<!-- Design Tokens: Colors")
    expect(xml).toContain("Card")
    expect(xml).toContain("https://cdn/hero.png")
    expect(xml).toContain("Hello World")
    expect(xml).toContain("radius")
  })
})
