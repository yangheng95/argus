import { describe, test, expect } from "bun:test"

import {
  analyzeGraphStructure,
  createSubDesign,
  collectReuseRefs,
  collectTextSpecs,
  toSlug,
  toStubName,
  CONNECTION_RE,
  ANNOTATION_RE,
  REUSE_RE,
} from "../../../src/mirror/figma/graph-analyze"
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

function node(id: string, name: string, children?: CompressedNode[]): CompressedNode {
  return { id, name, type: "FRAME", children }
}

function textNode(id: string, content: string): CompressedNode {
  return { id, name: id, type: "TEXT", text: { content } }
}

describe("graph marker regexes", () => {
  test("match connection, annotation, and reuse markers", () => {
    expect(CONNECTION_RE.test("连接线组-1/Tab/1:10 -> Content/1:20")).toBe(true)
    expect(ANNOTATION_RE.test("基础标注组-1/target/1:99")).toBe(true)
    expect(REUSE_RE.test("@reuse@ui/button:primary")).toBe(true)
  })
})

describe("graph helper functions", () => {
  test("normalizes slugs and stub names", () => {
    expect(toSlug("Home Tab")).toBe("home-tab")
    expect(toSlug("-leading-trailing-")).toBe("leading-trailing")
    expect(toStubName("my-lib", "Data Grid")).toBe("MyLibDataGrid")
  })

  test("collects text specs recursively", () => {
    const tree: CompressedNode = {
      id: "1",
      name: "root",
      type: "FRAME",
      text: { content: "hello" },
      children: [
        textNode("2", "world"),
        { id: "3", name: "n", type: "FRAME", children: [textNode("4", "nested")] },
      ],
    }
    expect(collectTextSpecs(tree)).toEqual(["hello", "world", "nested"])
  })

  test("collects reuse references recursively", () => {
    const tree: CompressedNode = {
      id: "1",
      name: "@reuse@ainvest/table:default",
      type: "FRAME",
      children: [
        { id: "2", name: "@reuse@ui/button:primary", type: "INSTANCE" },
        { id: "3", name: "plain-group", type: "GROUP" },
      ],
    }
    expect(collectReuseRefs(tree).map((ref) => toStubName(ref.library, ref.component))).toEqual(["AinvestTable", "UiButton"])
  })
})

describe("analyzeGraphStructure", () => {
  test("empty design passes through without graph structure", () => {
    const design = emptyDesign()
    const result = analyzeGraphStructure(design)
    expect(result.pageGraph.hasGraphStructure).toBe(false)
    expect(result.pageGraph.pages).toEqual([])
    expect(result.design).toBe(design)
  })

  test("reuse refs populate external component metadata", () => {
    const design = emptyDesign()
    design.pages[0].frames = [node("1", "@reuse@ainvest/table:v1")]
    const result = analyzeGraphStructure(design)
    expect(result.pageGraph.hasGraphStructure).toBe(false)
    expect(result.pageGraph.reuseRefs).toHaveLength(1)
    expect(result.pageGraph.externalComponents[0].stubName).toBe("AinvestTable")
  })

  test("connection group triggers tab page with slug", () => {
    const design = emptyDesign()
    design.pages[0].frames = [
      { id: "g1", name: "连接线组-1/Tab1/1:10 -> Content1/1:20", type: "GROUP" },
      node("1:10", "Tab1", [textNode("t", "Home Tab")]),
      node("1:20", "Content1"),
    ]
    const result = analyzeGraphStructure(design)
    expect(result.pageGraph.hasGraphStructure).toBe(true)
    expect(result.pageGraph.connections).toHaveLength(1)
    expect(result.pageGraph.pages[0].label).toBe("Home Tab")
    expect(result.pageGraph.pages[0].id).toBe("home-tab")
    expect(result.pageGraph.pages[0].isDefault).toBe(true)
  })

  test("removes graph-marker frames from cleaned design", () => {
    const design = emptyDesign()
    design.pages[0].frames = [
      { id: "g1", name: "连接线组-1/a/1:1 -> b/1:2", type: "GROUP" },
      node("1:1", "a"),
      node("1:2", "b"),
      node("1:3", "plain"),
    ]
    const result = analyzeGraphStructure(design)
    expect(result.design.pages[0].frames.map((frame) => frame.name)).toEqual(["a", "b", "plain"])
  })

  test("injects interaction annotation into target node", () => {
    const design = emptyDesign()
    design.pages[0].frames = [
      {
        id: "ann",
        name: "基础标注组-1/target/1:99",
        type: "GROUP",
        children: [textNode("t", "click to open")],
      },
      node("1:99", "target"),
    ]
    const result = analyzeGraphStructure(design)
    const target = result.design.pages[0].frames.find((frame) => frame.id === "1:99")
    expect(target?.annotations?.[0]).toContain("[interaction:")
    expect(target?.annotations?.[0]).toContain("click to open")
  })
})

describe("createSubDesign", () => {
  test("strips reuse annotations and deep-clones nodes", () => {
    const source = emptyDesign()
    source.components = { x: { name: "@reuse@lib/table:v1", description: "", key: "x" } }
    source.componentSets = { y: { name: "@reuse@lib/grid:main", description: "" } }
    const nodes: CompressedNode[] = [
      {
        id: "1:1",
        name: "@reuse@lib/card:default",
        type: "INSTANCE",
        componentName: "@reuse@lib/card:default",
        annotations: ["[external-component: lib/card:default]", "keep-me"],
      },
    ]

    const sub = createSubDesign(source, nodes, "SubPage")
    sub.pages[0].frames[0].name = "MUTATED"

    expect(nodes[0].name).toBe("@reuse@lib/card:default")
    expect(sub.fileName).toBe("Test")
    expect(sub.pages[0].name).toBe("SubPage")
    expect(sub.pages[0].frames[0].annotations).toEqual(["keep-me"])
    expect(sub.components.x.name).toBe("table")
    expect(sub.componentSets.y.name).toBe("grid")
  })
})
