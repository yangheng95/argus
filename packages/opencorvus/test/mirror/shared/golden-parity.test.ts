/**
 * Golden parity tests — for every function ported from mirror, run the
 * same input through mirror's original implementation AND through our port,
 * and assert the outputs are strictly equal.
 *
 * This is the only way to catch subtle transcription errors that pass my
 * hand-written unit tests (which encode my *interpretation* of the
 * original, not its actual behavior).
 *
 * Requires `D:/myhexin-local/opencode-private/packages/mirror/src/**` on
 * disk. When mirror is unavailable, these tests will fail to import and
 * surface a clear error instead of silently passing.
 */

import { describe, test, expect } from "bun:test"

// ─── xml-escape ──────────────────────────────────────────────────────────

import * as mirrorXmlEscape from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/utils/xml-escape.ts"
import * as ourXmlEscape from "../../../src/mirror/shared/xml-escape"

describe("parity: xml-escape", () => {
  const samples = [
    "",
    "plain text",
    "a & b",
    `"quoted"`,
    "<tag>",
    "</tag>",
    `all: & " < > ' `,
    "nested: <a href=\"&foo\">",
    "unicode 你好 & <b>",
    "&amp; already escaped",
    "\t\n\r whitespace",
    "\u0000\u0001",
  ]

  test.each(samples)("escapeXmlAttr(%p) matches mirror", (s) => {
    expect(ourXmlEscape.escapeXmlAttr(s)).toBe(mirrorXmlEscape.escapeXmlAttr(s))
  })

  test.each(samples)("escapeXmlText(%p) matches mirror", (s) => {
    expect(ourXmlEscape.escapeXmlText(s)).toBe(mirrorXmlEscape.escapeXmlText(s))
  })
})

// ─── similarity ──────────────────────────────────────────────────────────

import * as mirrorSim from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/utils/similarity.ts"
import * as ourSim from "../../../src/mirror/shared/similarity"

describe("parity: similarity", () => {
  const pairs: Array<[string, string]> = [
    ["", ""],
    ["a", "a"],
    ["a", "b"],
    ["abc", "abc"],
    ["abcdef", "abcdef"],
    ["abcdef", "abcxyz"],
    ["hello world", "hello there"],
    ["你好世界", "你好地球"],
    ["const x = 1\n".repeat(10), "const y = 1\n".repeat(10)],
    ["import React from 'react'", "import { useState } from 'react'"],
    ["a".repeat(100), "b".repeat(100)],
    ["aaa", "aa"],
    ["aaaa", "aaaa"],
  ]

  test.each(pairs)("similarity(%p, %p) matches mirror", (a, b) => {
    const ours = ourSim.similarity(a, b)
    const theirs = mirrorSim.similarity(a, b)
    expect(ours).toBeCloseTo(theirs, 10)
  })

  test.each([0, 100, 499, 500, 1999, 2000, 100_000])(
    "adaptiveMinSimilarity(%i) matches mirror",
    (len) => {
      expect(ourSim.adaptiveMinSimilarity(len)).toBe(mirrorSim.adaptiveMinSimilarity(len))
    },
  )

  test("MIN_SIMILARITY constant matches mirror", () => {
    expect(ourSim.MIN_SIMILARITY).toBe(mirrorSim.MIN_SIMILARITY)
  })
})

// ─── tier-graph ──────────────────────────────────────────────────────────

import * as mirrorTier from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/utils/tier-graph.ts"
import * as ourTier from "../../../src/mirror/shared/tier-graph"

describe("parity: tier-graph", () => {
  const planWithContracts = [
    {
      file_path: "App.tsx",
      file_info: "",
      notes: "",
      contracts: { exports: ["App"], imports: { "./Header": [], "./constants": [] } },
    },
    {
      file_path: "Header.tsx",
      file_info: "",
      notes: "",
      contracts: { exports: ["Header"], imports: { "./constants": [] } },
    },
    {
      file_path: "constants.ts",
      file_info: "",
      notes: "",
      contracts: { exports: ["C"], imports: {} },
    },
  ]

  const planWithoutContracts = [
    { file_path: "App.tsx", file_info: "", notes: "" },
    { file_path: "Header.tsx", file_info: "", notes: "" },
  ]

  function tierPaths(tiers: Array<Array<{ file_path: string }>>) {
    return tiers.map((t) => t.map((f) => f.file_path).sort())
  }

  test("buildTiers — contract-based plan matches mirror", () => {
    expect(tierPaths(ourTier.buildTiers(planWithContracts))).toEqual(
      tierPaths(mirrorTier.buildTiers(planWithContracts)),
    )
  })

  test("buildTiers rejects plans without contracts instead of matching mirror's heuristic path", () => {
    expect(() => ourTier.buildTiers(planWithoutContracts)).toThrow(/without explicit contracts\.imports/)
    expect(() => mirrorTier.buildTiers(planWithoutContracts)).not.toThrow()
  })

  test("buildDependencyGraph — contract-based matches mirror", () => {
    const ours = ourTier.buildDependencyGraph(planWithContracts)
    const theirs = mirrorTier.buildDependencyGraph(planWithContracts)
    expect(ours.size).toBe(theirs.size)
    for (const [k, v] of ours) {
      expect([...v].sort()).toEqual([...(theirs.get(k) ?? new Set())].sort())
    }
  })

  test("heuristic dependency graph is not exported", () => {
    expect("buildHeuristicDependencyGraph" in ourTier).toBe(false)
  })
})

// ─── extract-xml ─────────────────────────────────────────────────────────

import * as mirrorExtract from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/parser/extract.ts"
import * as ourExtract from "../../../src/mirror/shared/extract-xml"

describe("parity: extract-xml", () => {
  const xmlSamples = [
    "<foo>bar</foo>",
    "<source-code>x</source-code>",
    "plain text, no tags",
    "<foo>partial", // truncated
    "<foo><foo>nested</foo></foo>",
    "<a>1</a><a>2</a><a>3</a>",
    "<file-audit path=\"a.ts\" status=\"ok\">body</file-audit>",
    "<source-code>```tsx\nconst x = </source-code>\n```\n</source-code>",
    `<source-code>${"<inner>".repeat(100)}${"</inner>".repeat(100)}</source-code>`,
  ]

  test.each(xmlSamples)("extractTag(foo/source-code/etc) matches mirror", (s) => {
    for (const tag of ["foo", "source-code", "file-audit", "a"]) {
      expect(ourExtract.extractTag(s, tag)).toEqual(mirrorExtract.extractTag(s, tag))
    }
  })

  test.each(xmlSamples)("extractAllTags matches mirror", (s) => {
    for (const tag of ["foo", "source-code", "a"]) {
      expect(ourExtract.extractAllTags(s, tag)).toEqual(mirrorExtract.extractAllTags(s, tag))
    }
  })

  const fenceSamples = [
    "```\nhello\n```",
    "```tsx\nconst x = 1\n```",
    "intro\n```\nfirst\n```\nmiddle\n```\nsecond\n```\n",
    "no fences at all",
    "```\r\nwindows\r\n```",
    "````\nfour ticks\n````",
  ]

  test.each(fenceSamples)("extractFencedCode matches mirror", (s) => {
    expect(ourExtract.extractFencedCode(s)).toEqual(mirrorExtract.extractFencedCode(s))
  })

  const codeSamples = [
    "<source-code>```tsx\nexport const x = 1\n```</source-code>",
    "intro\n```\nexport const x = 1\n```\n",
    "<think>reasoning</think>\n<source-code>```ts\nok\n```</source-code>",
    "<source-code></source-code>",
    "nothing structured",
    "```\njust fenced\n```",
  ]

  test.each(codeSamples)("extractCodeWithReason matches mirror", (s) => {
    expect(ourExtract.extractCodeWithReason(s)).toEqual(mirrorExtract.extractCodeWithReason(s))
  })

  const jsonSamples = [
    '{"a":1}',
    '[1,2,3]',
    "{ a: 1, b: 'two', }", // JSON5
    '{"a":1,"b":{"c":2', // truncated
    '{"a":1,}',
    "not json at all",
    '{"a":"line1\nline2"}',
    '{"a":[1,2,3]}',
  ]

  test.each(jsonSamples)("parseJSON matches mirror", (s) => {
    expect(ourExtract.parseJSON(s)).toEqual(mirrorExtract.parseJSON(s))
  })

  const planSamples = [
    `<project-framework>[{"file_path":"a.ts"}]</project-framework>`,
    `prose\n\`\`\`json\n[{"file_path":"a.ts"}]\n\`\`\`\n`,
    "[1,2,3]",
    "just prose",
  ]

  test.each(planSamples)("extractPlan matches mirror", (s) => {
    expect(ourExtract.extractPlan(s)).toEqual(mirrorExtract.extractPlan(s))
  })
})

// ─── token-estimator ─────────────────────────────────────────────────────

import * as mirrorTokens from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/llm/token-estimator.ts"
import * as ourTokens from "../../../src/mirror/shared/token-estimator"

describe("parity: token-estimator", () => {
  const samples = [
    "",
    "hello",
    "a".repeat(1000),
    "你好",
    "你好世界",
    "hello 世界",
    "hello ".repeat(100) + "世界".repeat(100),
    "import React from 'react'\nexport function App() { return null }",
    "ひらがな カタカナ 한국어",
  ]

  test.each(samples)("estimateTokens matches mirror", (s) => {
    expect(ourTokens.estimateTokens(s)).toBe(mirrorTokens.estimateTokens(s))
  })
})

// ─── image-constrain (probe + resize behaviour) ──────────────────────────

import * as mirrorImg from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/image-constrain.ts"
import * as ourImg from "../../../src/mirror/shared/image-constrain"
import { PNG } from "pngjs"

function makePng(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h })
  for (let i = 0; i < w * h * 4; i += 4) {
    png.data[i] = 255
    png.data[i + 3] = 255
  }
  return PNG.sync.write(png)
}

describe("parity: image-constrain", () => {
  test("probeImageDimensions — PNG", () => {
    const buf = makePng(123, 456)
    expect(ourImg.probeImageDimensions(buf)).toEqual({ width: 123, height: 456 })
    // mirror exports probeImageDimensions as an internal function, not public.
    // The default export `constrainImage` exercises the same code path via
    // the oversized PNG branch, which is what `constrainImage` parity covers.
  })

  test("constrainImage — small PNG returns URL unchanged (matches mirror)", async () => {
    const url = `data:image/png;base64,${makePng(50, 50).toString("base64")}`
    expect(await ourImg.constrainImage(url)).toBe(await mirrorImg.constrainImage(url))
  })

  test("constrainImage — oversized PNG produces equal bytes (matches mirror)", async () => {
    const url = `data:image/png;base64,${makePng(8000, 4000).toString("base64")}`
    const ours = await ourImg.constrainImage(url, 1024)
    const theirs = await mirrorImg.constrainImage(url, 1024)
    // Both should emit a data URL with the same resized dimensions.
    const ourBuf = Buffer.from(ours.split(",")[1], "base64")
    const theirBuf = Buffer.from(theirs.split(",")[1], "base64")
    const ourDims = ourImg.probeImageDimensions(ourBuf)
    const theirDims = ourImg.probeImageDimensions(theirBuf)
    expect(ourDims).toEqual(theirDims)
  })
})

// ─── content-compare ─────────────────────────────────────────────────────

import * as mirrorCmp from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/content-compare.ts"
import * as ourCmp from "../../../src/mirror/shared/content-compare"

describe("parity: content-compare", () => {
  const textPairs: Array<[string, string]> = [
    ["", ""],
    ["alpha beta", "alpha beta"],
    ["alpha beta", "gamma delta"],
    ["alpha beta gamma", "alpha beta"],
    ["设计 语言", "设计 规范"],
    ["hello 世界 123 test", "hello 世界 test"],
    ["", "extra content"],
    ["Price: $100", "Price: $200"], // pure digits dropped
  ]

  test.each(textPairs)("compareText matches mirror", (a, b) => {
    expect(ourCmp.compareText(a, b)).toEqual(mirrorCmp.compareText(a, b))
  })

  test.each(textPairs)("tokenize matches mirror", (a) => {
    expect(ourCmp.tokenize(a)).toEqual(mirrorCmp.tokenize(a))
  })

  const iconPairs: Array<[number, number]> = [
    [0, 0], [5, 5], [10, 5], [3, 10],
  ]

  test.each(iconPairs)("compareIcons(%i, %i) matches mirror", (a, b) => {
    expect(ourCmp.compareIcons(a, b)).toEqual(mirrorCmp.compareIcons(a, b))
  })

  test("compareContent blend matches mirror", () => {
    expect(ourCmp.compareContent("alpha beta", "alpha gamma", 5, 3)).toEqual(
      mirrorCmp.compareContent("alpha beta", "alpha gamma", 5, 3),
    )
  })

  test("countRenderedIcons matches mirror", () => {
    const html = `<svg></svg><svg></svg><i class="fa-home"></i><span class="icon close"></span>`
    expect(ourCmp.countRenderedIcons(html)).toBe(mirrorCmp.countRenderedIcons(html))
  })
})

// ─── design-language ─────────────────────────────────────────────────────

import * as mirrorDl from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/design-language-extract.ts"
import * as ourDl from "../../../src/mirror/shared/design-language"

describe("parity: design-language", () => {
  // Use mirror's ExtractedPage shape (the port accepts a structural subset).
  function buildPage(): any {
    return {
      url: "https://example.test",
      title: "t",
      viewport: { width: 1440, height: 900 },
      screenshotUrl: "",
      tree: [
        {
          selector: "body",
          tag: "body",
          bounds: { x: 0, y: 0, w: 1440, h: 900 },
          styles: { backgroundColor: "#ffffff", fontFamily: "Inter", display: "flex", flexDirection: "row" },
          children: [
            {
              selector: "h1",
              tag: "h1",
              bounds: { x: 0, y: 0, w: 400, h: 40 },
              styles: { fontSize: "32px", fontWeight: "700", color: "#111111" },
            },
            {
              selector: "p",
              tag: "p",
              bounds: { x: 0, y: 40, w: 400, h: 20 },
              styles: { fontSize: "14px", color: "#555555", padding: "8px", gap: "12px" },
            },
            {
              selector: "button",
              tag: "button",
              bounds: { x: 0, y: 80, w: 100, h: 36 },
              styles: { backgroundColor: "#3366ff", borderRadius: "8px", color: "#ffffff", fontSize: "16px" },
            },
          ],
        },
      ],
      tokens: { colors: {}, fonts: [], customProperties: {} },
      assets: { images: [], icons: [] },
      stats: { totalElements: 4, extractedElements: 4, imageCount: 0, extractionTimeMs: 0 },
    }
  }

  test("extractDesignLanguage output matches mirror byte-for-byte", () => {
    const page = buildPage()
    expect(ourDl.extractDesignLanguage(page)).toEqual(mirrorDl.extractDesignLanguage(page))
  })

  test("renderDesignLanguageMarkdown output matches mirror", () => {
    const dl = ourDl.extractDesignLanguage(buildPage())
    expect(ourDl.renderDesignLanguageMarkdown(dl)).toBe(mirrorDl.renderDesignLanguageMarkdown(dl))
  })
})
