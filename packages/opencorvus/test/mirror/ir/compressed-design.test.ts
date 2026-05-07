import { describe, test, expect } from "bun:test"
import {
  CompressedDesignSchema,
  CompressedNodeSchema,
  DesignTokensSchema,
  PageGraphSchema,
  type CompressedDesign,
  type CompressedNode,
} from "../../../src/mirror/ir/compressed-design"

function minimalDesign(): CompressedDesign {
  return {
    fileName: "Test File",
    lastModified: "2026-04-01T00:00:00Z",
    figmaUrl: "https://www.figma.com/file/ABC/Test",
    pages: [
      {
        name: "Page 1",
        frames: [
          {
            id: "1:1",
            name: "Frame",
            type: "FRAME",
          },
        ],
      },
    ],
    components: {},
    componentSets: {},
    tokens: {
      colors: {},
      gradients: [],
      fonts: [],
      textStyles: [],
      effects: [],
    },
    images: {},
    comments: [],
    stats: {
      totalNodes: 1,
      compressedNodes: 1,
      imageCount: 0,
      compressionRatio: "1.00",
    },
  }
}

describe("CompressedDesignSchema", () => {
  test("accepts minimal well-formed design", () => {
    const parsed = CompressedDesignSchema.parse(minimalDesign())
    expect(parsed.fileName).toBe("Test File")
    expect(parsed.pages[0].frames[0].id).toBe("1:1")
  })

  test("rejects missing required top-level field", () => {
    const bad = { ...minimalDesign() } as unknown as Record<string, unknown>
    delete bad.fileName
    expect(() => CompressedDesignSchema.parse(bad)).toThrow()
  })

  test("accepts optional pageGraph when well-formed", () => {
    const design = minimalDesign()
    design.pageGraph = {
      hasGraphStructure: false,
      connections: [],
      annotations: [],
      reuseRefs: [],
      pages: [],
      sharedNodes: [],
      externalComponents: [],
    }
    expect(() => CompressedDesignSchema.parse(design)).not.toThrow()
  })
})

describe("CompressedNodeSchema — recursive", () => {
  test("accepts deeply-nested children", () => {
    const node: CompressedNode = {
      id: "a",
      name: "A",
      type: "FRAME",
      children: [
        {
          id: "b",
          name: "B",
          type: "GROUP",
          children: [{ id: "c", name: "C", type: "TEXT", text: { content: "hi" } }],
        },
      ],
    }
    expect(CompressedNodeSchema.parse(node)).toEqual(node)
  })

  test("accepts bounds and style blobs", () => {
    const node: CompressedNode = {
      id: "a",
      name: "A",
      type: "FRAME",
      bounds: { x: 0, y: 0, w: 320, h: 64 },
      style: { bg: "#fff", borderRadius: 8, opacity: 0.9 },
    }
    expect(() => CompressedNodeSchema.parse(node)).not.toThrow()
  })

  test("accepts borderRadius as number OR number[]", () => {
    expect(() =>
      CompressedNodeSchema.parse({ id: "a", name: "A", type: "F", style: { borderRadius: 8 } }),
    ).not.toThrow()
    expect(() =>
      CompressedNodeSchema.parse({
        id: "a",
        name: "A",
        type: "F",
        style: { borderRadius: [8, 0, 8, 0] },
      }),
    ).not.toThrow()
  })

  test("rejects invalid category enum", () => {
    expect(() =>
      CompressedNodeSchema.parse({
        id: "a",
        name: "A",
        type: "F",
        category: "not-a-category",
      }),
    ).toThrow()
  })
})

describe("DesignTokensSchema", () => {
  test("accepts populated token bag", () => {
    const tokens = {
      colors: { primary: "#3366ff" },
      gradients: ["linear-gradient(45deg, #f00, #00f)"],
      fonts: ["Inter"],
      textStyles: [{ name: "Heading", font: "Inter", size: 32, weight: 700, color: "#000" }],
      effects: [{ name: "elevation-1", type: "shadow", value: "0 2px 8px rgba(0,0,0,0.1)" }],
    }
    expect(() => DesignTokensSchema.parse(tokens)).not.toThrow()
  })
})

describe("PageGraphSchema", () => {
  test("accepts empty graph", () => {
    const graph = {
      hasGraphStructure: false,
      connections: [],
      annotations: [],
      reuseRefs: [],
      pages: [],
      sharedNodes: [],
      externalComponents: [],
    }
    expect(() => PageGraphSchema.parse(graph)).not.toThrow()
  })
})
