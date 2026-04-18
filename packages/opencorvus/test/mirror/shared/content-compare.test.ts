import { describe, test, expect } from "bun:test"
import {
  tokenize,
  compareText,
  compareIcons,
  compareContent,
  extractTextFromTree,
  countIcons,
  countRenderedIcons,
} from "../../../src/mirror/shared/content-compare"

describe("tokenize", () => {
  test("empty string → empty array", () => {
    expect(tokenize("")).toEqual([])
  })

  test("splits Latin on whitespace and punctuation, lowercases", () => {
    expect(tokenize("Hello, World!")).toEqual(["hello", "world"])
  })

  test("CJK characters become individual tokens", () => {
    expect(tokenize("设计语言")).toEqual(["设", "计", "语", "言"])
  })

  test("mixed Latin + CJK preserves both", () => {
    expect(tokenize("hello 世界")).toEqual(["hello", "世", "界"])
  })

  test("drops pure-digit tokens (prices/sizes)", () => {
    expect(tokenize("buy 100 now")).toEqual(["buy", "now"])
  })

  test("keeps single Latin letters but drops single digits", () => {
    expect(tokenize("a b 1")).toEqual(["a", "b"])
  })
})

describe("compareText", () => {
  test("identical texts → score 100, jaccard 1", () => {
    const r = compareText("hello world", "hello world")
    expect(r.score).toBe(100)
    expect(r.jaccardSimilarity).toBe(1)
    expect(r.coverageRate).toBe(1)
    expect(r.missingTokens).toEqual([])
  })

  test("disjoint texts → score low, missing populated", () => {
    const r = compareText("alpha beta", "gamma delta")
    expect(r.score).toBeLessThan(20)
    expect(r.missingTokens).toContain("alpha")
    expect(r.missingTokens).toContain("beta")
  })

  test("partial overlap — coverage weighted 70%, jaccard 30%", () => {
    const r = compareText("alpha beta gamma", "alpha beta")
    // coverage = 2/3, jaccard = 2/3
    // score = round(0.667 * 70 + 0.667 * 30) = round(66.7) = 67
    expect(r.coverageRate).toBeCloseTo(2 / 3, 3)
    expect(r.score).toBe(67)
  })

  test("empty reference and empty rendered → perfect", () => {
    const r = compareText("", "")
    expect(r.score).toBe(100)
    expect(r.referenceTokens).toBe(0)
  })

  test("empty reference with non-empty rendered still scores 100", () => {
    const r = compareText("", "extra content")
    expect(r.coverageRate).toBe(1)
    expect(r.score).toBe(100)
  })

  test("caps missing tokens at 20", () => {
    const many = Array.from({ length: 50 }, (_, i) => `tok${i}`).join(" ")
    const r = compareText(many, "")
    expect(r.missingTokens).toHaveLength(20)
  })
})

describe("compareIcons", () => {
  test("both zero → perfect", () => {
    expect(compareIcons(0, 0).score).toBe(100)
  })

  test("matching counts → 100", () => {
    expect(compareIcons(5, 5).score).toBe(100)
  })

  test("mismatch — coverage = min/max", () => {
    const r = compareIcons(10, 5)
    expect(r.coverageRate).toBe(0.5)
    expect(r.score).toBe(50)
  })
})

describe("compareContent", () => {
  test("blends text 70% + icons 30%", () => {
    // Text 100, icons 0 → 100*0.7 + 0*0.3 = 70
    const r = compareContent("same", "same", 10, 0)
    expect(r.overallScore).toBe(70)
  })
})

describe("extractTextFromTree", () => {
  test("handles ExtractedElement shape (text: string)", () => {
    const tree = [{ text: "a" }, { text: "b", children: [{ text: "c" }] }]
    expect(extractTextFromTree(tree)).toBe("a b c")
  })

  test("handles CompressedNode shape (text: { content })", () => {
    const tree = [{ text: { content: "x" } }, { children: [{ text: { content: "y" } }] }]
    expect(extractTextFromTree(tree)).toBe("x y")
  })
})

describe("countRenderedIcons", () => {
  test("counts inline <svg> + icon-font classes", () => {
    const html = `
      <svg></svg>
      <svg></svg>
      <i class="fa-home"></i>
      <span class="icon close"></span>
      <div>no icon here</div>
    `
    expect(countRenderedIcons(html)).toBe(4)
  })
})

describe("countIcons (page.assets)", () => {
  test("returns length", () => {
    expect(countIcons([{ src: "a", type: "svg" }, { src: "b", type: "png" }])).toBe(2)
  })

  test("undefined → 0", () => {
    expect(countIcons(undefined)).toBe(0)
  })
})
