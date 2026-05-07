import { describe, test, expect } from "bun:test"
import {
  extractDesignLanguage,
  renderDesignLanguageMarkdown,
  type ElementLike,
  type PageLike,
} from "../../../src/mirror/shared/design-language"

function el(styles: ElementLike["styles"], ...children: ElementLike[]): ElementLike {
  return { styles, children }
}

function page(tree: ElementLike[]): PageLike {
  return { url: "https://example.test", tree }
}

describe("extractDesignLanguage", () => {
  test("empty page → empty counters but structure present", () => {
    const dl = extractDesignLanguage(page([]))
    expect(dl.colors.backgrounds).toEqual([])
    expect(dl.typography).toEqual([])
    expect(dl.fontFamilies).toEqual([])
    expect(dl.sourceUrl).toBe("https://example.test")
  })

  test("classifies saturated colour as accent, neutral as background", () => {
    const tree = [
      el({ backgroundColor: "#ff0000" }), // saturated red → accent
      el({ backgroundColor: "#ff0000" }),
      el({ backgroundColor: "#f5f5f5" }), // neutral grey → background
      el({ backgroundColor: "#ffffff" }), // neutral white → background
    ]
    const dl = extractDesignLanguage(page(tree))
    expect(dl.colors.accents.map((c) => c.value)).toContain("#ff0000")
    expect(dl.colors.backgrounds.map((c) => c.value)).toContain("#f5f5f5")
  })

  test("normalises rgb() to hex", () => {
    const dl = extractDesignLanguage(page([
      el({ color: "rgb(255, 0, 0)" }),
      el({ color: "rgb(255, 0, 0)" }),
    ]))
    expect(dl.colors.text.map((c) => c.value)).toContain("#ff0000")
  })

  test("skips transparent and empty colours", () => {
    const tree = [
      el({ backgroundColor: "rgba(0, 0, 0, 0)" }),
      el({ backgroundColor: "transparent" }),
      el({ backgroundColor: "" }),
    ]
    const dl = extractDesignLanguage(page(tree))
    expect(dl.colors.backgrounds).toHaveLength(0)
    expect(dl.colors.accents).toHaveLength(0)
  })

  test("builds typography scale sorted by px descending", () => {
    const tree = [
      el({ fontSize: "32px" }),
      el({ fontSize: "32px" }),
      el({ fontSize: "16px" }),
      el({ fontSize: "14px" }),
    ]
    const dl = extractDesignLanguage(page(tree))
    const sizes = dl.typography.map((t) => t.fontSize)
    expect(sizes[0]).toBe("32px")
    expect(sizes).toEqual(["32px", "16px", "14px"])
  })

  test("assigns heading weights to top sizes", () => {
    const tree = [
      el({ fontSize: "40px" }),
      el({ fontSize: "24px" }),
      el({ fontSize: "18px" }),
      el({ fontSize: "16px" }),
    ]
    const dl = extractDesignLanguage(page(tree))
    expect(dl.typography[0].fontWeight).toBe("700") // h1
    expect(dl.typography[1].fontWeight).toBe("700") // h2
    expect(dl.typography[2].fontWeight).toBe("700") // h3
    expect(dl.typography[3].fontWeight).toBe("600") // h4
  })

  test("detects flex-row / flex-col / grid", () => {
    const tree = [
      el({ display: "flex", flexDirection: "row" }),
      el({ display: "flex", flexDirection: "column" }),
      el({ display: "grid", gridTemplateColumns: "1fr 1fr" }),
    ]
    const dl = extractDesignLanguage(page(tree))
    const types = dl.layoutPatterns.map((l) => l.type).sort()
    expect(types).toEqual(["flex-col", "flex-row", "grid"])
    const grid = dl.layoutPatterns.find((l) => l.type === "grid")
    expect(grid?.details).toBe("1fr 1fr")
  })

  test("extracts primary font family (first in stack)", () => {
    const dl = extractDesignLanguage(page([
      el({ fontFamily: "'Inter', system-ui, sans-serif" }),
      el({ fontFamily: '"Inter", ui-sans-serif' }),
    ]))
    expect(dl.fontFamilies).toContain("Inter")
  })

  test("skips 0px padding/margin", () => {
    const tree = [
      el({ padding: "0px", margin: "0px 0px" }),
      el({ padding: "16px" }),
    ]
    const dl = extractDesignLanguage(page(tree))
    const values = dl.spacing.map((s) => s.value)
    expect(values).toContain("16px")
    expect(values).not.toContain("0px")
    expect(values).not.toContain("0px 0px")
  })
})

describe("renderDesignLanguageMarkdown", () => {
  test("emits sections for non-empty categories", () => {
    const dl = extractDesignLanguage(page([
      el({ backgroundColor: "#ff0000", fontSize: "16px", fontFamily: "Inter" }),
      el({ borderRadius: "8px", display: "flex", flexDirection: "row" }),
    ]))
    const md = renderDesignLanguageMarkdown(dl)
    expect(md).toContain("设计语言规范")
    expect(md).toContain("色彩体系")
    expect(md).toContain("字体排版阶梯")
    expect(md).toContain("Inter")
    expect(md).toContain("组件造型风格")
    expect(md).toContain("8px")
    expect(md).toContain("flex-row")
  })

  test("omits empty sections (no typography → no heading)", () => {
    const dl = extractDesignLanguage(page([]))
    const md = renderDesignLanguageMarkdown(dl)
    expect(md).not.toContain("字体排版阶梯")
    expect(md).not.toContain("间距系统")
  })
})
