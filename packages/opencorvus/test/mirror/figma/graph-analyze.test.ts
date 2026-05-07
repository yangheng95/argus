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

// Golden parity — mirror originals
import {
  analyzeGraph as mirrorAnalyze,
  createSubDesign as mirrorCreateSubDesign,
  collectReuseRefs as mirrorCollectReuseRefs,
  collectTextSpecs as mirrorCollectTextSpecs,
  toSlug as mirrorToSlug,
  toStubName as mirrorToStubName,
  CONNECTION_RE as mirrorConnRe,
  ANNOTATION_RE as mirrorAnnRe,
  REUSE_RE as mirrorReuseRe,
} from "D:/myhexin-local/opencode-private/packages/mirror/src/service/figma-graph-analyze.ts"

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

// ─── Regex parity ─────────────────────────────────────────────────────────

describe("regex parity with mirror", () => {
  test("CONNECTION_RE source matches mirror", () => {
    expect(CONNECTION_RE.source).toBe(mirrorConnRe.source)
  })
  test("ANNOTATION_RE source matches mirror", () => {
    expect(ANNOTATION_RE.source).toBe(mirrorAnnRe.source)
  })
  test("REUSE_RE source matches mirror", () => {
    expect(REUSE_RE.source).toBe(mirrorReuseRe.source)
  })
})

// ─── Pure helper parity ───────────────────────────────────────────────────

describe("pure helpers — GOLDEN PARITY", () => {
  const slugs = ["Home Tab", "用户中心", "Mixed 混合 123", "-leading-trailing-", "!!!", ""]
  test.each(slugs)("toSlug(%p) matches mirror", (s) => {
    expect(toSlug(s)).toBe(mirrorToSlug(s))
  })

  const stubCases: Array<[string, string]> = [
    ["ainvest", "table"],
    ["my-lib", "Data Grid"],
    ["股票库", "列表"], // pure Chinese — both sides strip to ""
    ["", ""],
    ["a-b-c", "some.thing"],
  ]
  test.each(stubCases)("toStubName(%p, %p) matches mirror", (lib, comp) => {
    expect(toStubName(lib, comp)).toBe(mirrorToStubName(lib, comp))
  })

  test("collectTextSpecs matches mirror", () => {
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
    expect(collectTextSpecs(tree)).toEqual(mirrorCollectTextSpecs(tree))
  })

  test("collectReuseRefs matches mirror", () => {
    const tree: CompressedNode = {
      id: "1",
      name: "@reuse@ainvest/table:股票-默认",
      type: "FRAME",
      children: [
        { id: "2", name: "@reuse@ui/button:primary", type: "INSTANCE" },
        { id: "3", name: "plain-group", type: "GROUP" },
      ],
    }
    expect(collectReuseRefs(tree)).toEqual(mirrorCollectReuseRefs(tree))
  })
})

// ─── analyzeGraphStructure — shape validation ─────────────────────────────

describe("analyzeGraphStructure — shape", () => {
  test("empty design → passthrough, no graph structure", () => {
    const d = emptyDesign()
    const r = analyzeGraphStructure(d)
    expect(r.pageGraph.hasGraphStructure).toBe(false)
    expect(r.pageGraph.pages).toEqual([])
    expect(r.design).toBe(d) // passthrough identity when no markers
  })

  test("design with only @reuse@ refs → hasGraphStructure:false, reuseRefs populated", () => {
    const d = emptyDesign()
    d.pages[0].frames = [node("1", "@reuse@ainvest/table:v1")]
    const r = analyzeGraphStructure(d)
    expect(r.pageGraph.hasGraphStructure).toBe(false) // no connections
    expect(r.pageGraph.reuseRefs).toHaveLength(1)
    expect(r.pageGraph.externalComponents).toHaveLength(1)
    expect(r.pageGraph.externalComponents[0].stubName).toBe("AinvestTable")
  })

  test("connection group triggers tab page with slug", () => {
    const d = emptyDesign()
    d.pages[0].frames = [
      {
        id: "g1",
        name: "连接线组-1/Tab1/1:10 -> Content1/1:20",
        type: "GROUP",
      },
      node("1:10", "Tab1", [textNode("t", "Home Tab")]),
      node("1:20", "Content1"),
    ]
    const r = analyzeGraphStructure(d)
    expect(r.pageGraph.hasGraphStructure).toBe(true)
    expect(r.pageGraph.connections).toHaveLength(1)
    expect(r.pageGraph.pages).toHaveLength(1)
    expect(r.pageGraph.pages[0].label).toBe("Home Tab") // from source text
    expect(r.pageGraph.pages[0].id).toBe("home-tab")
    expect(r.pageGraph.pages[0].isDefault).toBe(true) // min groupId
  })

  test("removes graph-marker frames from cleaned design", () => {
    const d = emptyDesign()
    d.pages[0].frames = [
      { id: "g1", name: "连接线组-1/a/1:1 -> b/1:2", type: "GROUP" },
      node("1:1", "a"),
      node("1:2", "b"),
      node("1:3", "plain"),
    ]
    const r = analyzeGraphStructure(d)
    expect(r.design.pages[0].frames.map((f) => f.name)).toEqual(["a", "b", "plain"])
  })

  test("injects [interaction: …] annotation into target node", () => {
    const d = emptyDesign()
    d.pages[0].frames = [
      {
        id: "ann",
        name: "基础标注组-1/target/1:99",
        type: "GROUP",
        children: [textNode("t", "click to open")],
      },
      node("1:99", "target"),
    ]
    const r = analyzeGraphStructure(d)
    const target = r.design.pages[0].frames.find((f) => f.id === "1:99")
    expect(target?.annotations).toBeDefined()
    expect(target?.annotations?.[0]).toContain("[interaction:")
    expect(target?.annotations?.[0]).toContain("click to open")
  })
})

// ─── GOLDEN PARITY on analyzeGraphStructure ───────────────────────────────

describe("analyzeGraphStructure — GOLDEN PARITY byte-level", () => {
  const cases: Array<{ name: string; design: CompressedDesign }> = [
    {
      name: "empty",
      design: emptyDesign(),
    },
    {
      name: "plain frames only",
      design: (() => {
        const d = emptyDesign()
        d.pages[0].frames = [node("1:1", "Header"), node("1:2", "Footer")]
        return d
      })(),
    },
    {
      name: "single @reuse@ ref",
      design: (() => {
        const d = emptyDesign()
        d.pages[0].frames = [node("1:1", "@reuse@lib/table:v1")]
        return d
      })(),
    },
    {
      name: "multiple @reuse@ variants sharing component",
      design: (() => {
        const d = emptyDesign()
        d.pages[0].frames = [
          node("1:1", "@reuse@lib/table:v1"),
          node("1:2", "@reuse@lib/table:v2"),
          node("1:3", "@reuse@lib/button:primary"),
        ]
        return d
      })(),
    },
    {
      name: "full tab graph (connection + annotation + reuse)",
      design: (() => {
        const d = emptyDesign()
        d.pages[0].frames = [
          { id: "g1", name: "连接线组-1/Tab1/1:10 -> Content1/1:20", type: "GROUP" },
          { id: "g2", name: "连接线组-2/Tab2/1:11 -> Content2/1:21", type: "GROUP" },
          {
            id: "a1",
            name: "基础标注组-1/target/1:20",
            type: "GROUP",
            children: [textNode("at1", "hover state")],
          },
          {
            id: "1:10",
            name: "Tab1",
            type: "FRAME",
            children: [textNode("tx1", "首页")],
          },
          {
            id: "1:11",
            name: "Tab2",
            type: "FRAME",
            children: [textNode("tx2", "Settings")],
          },
          node("1:20", "Content1", [node("r1", "@reuse@lib/card:default")]),
          node("1:21", "Content2"),
          node("1:30", "Header"), // shared node
        ]
        return d
      })(),
    },
  ]

  for (const c of cases) {
    test(c.name, () => {
      // mirror mutates input indirectly (cleanDesign clones first); still, clone each side to be safe.
      const oursIn: CompressedDesign = JSON.parse(JSON.stringify(c.design))
      const theirsIn: CompressedDesign = JSON.parse(JSON.stringify(c.design))
      const ours = analyzeGraphStructure(oursIn)
      const theirs = mirrorAnalyze(theirsIn)
      expect(ours).toEqual(theirs)
    })
  }
})

// ─── createSubDesign parity ───────────────────────────────────────────────

describe("createSubDesign — GOLDEN PARITY", () => {
  test("strips @reuse@ from names and components", () => {
    const source = emptyDesign()
    source.components = { x: { name: "@reuse@lib/table:v1", description: "", key: "x" } }
    source.componentSets = { y: { name: "@reuse@lib/grid:主表", description: "" } }
    const nodes: CompressedNode[] = [
      {
        id: "1:1",
        name: "@reuse@lib/card:默认",
        type: "INSTANCE",
        componentName: "@reuse@lib/card:默认",
        annotations: ["[external-component: lib/card:默认]", "keep-me"],
      },
    ]
    const ours = createSubDesign(source, nodes, "SubPage")
    const theirs = mirrorCreateSubDesign(source, nodes, "SubPage")
    expect(ours).toEqual(theirs)
  })

  test("deep-clones nodes (mutation on sub does not leak to source)", () => {
    const source = emptyDesign()
    const nodes: CompressedNode[] = [node("1:1", "A"), node("1:2", "B")]
    const sub = createSubDesign(source, nodes)
    sub.pages[0].frames[0].name = "MUTATED"
    expect(nodes[0].name).toBe("A")
  })
})
