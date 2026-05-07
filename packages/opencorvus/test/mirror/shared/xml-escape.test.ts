import { describe, test, expect } from "bun:test"
import { escapeXmlAttr, escapeXmlText } from "../../../src/mirror/shared/xml-escape"

describe("escapeXmlAttr", () => {
  test("escapes all five XML special characters", () => {
    expect(escapeXmlAttr(`a & b < c > d " e`)).toBe("a &amp; b &lt; c &gt; d &quot; e")
  })

  test("escapes ampersand first so later replacements do not double-encode", () => {
    // If & were escaped after <, the resulting &lt; would become &amp;lt;
    expect(escapeXmlAttr("<")).toBe("&lt;")
    expect(escapeXmlAttr("&")).toBe("&amp;")
    expect(escapeXmlAttr("&<")).toBe("&amp;&lt;")
  })

  test("returns empty string unchanged", () => {
    expect(escapeXmlAttr("")).toBe("")
  })

  test("leaves safe characters untouched", () => {
    expect(escapeXmlAttr("hello world 123")).toBe("hello world 123")
  })
})

describe("escapeXmlText", () => {
  test("escapes &, <, > but leaves quotes alone", () => {
    expect(escapeXmlText(`a & b < c > d " e`)).toBe(`a &amp; b &lt; c &gt; d " e`)
  })

  test("returns empty string unchanged", () => {
    expect(escapeXmlText("")).toBe("")
  })
})
