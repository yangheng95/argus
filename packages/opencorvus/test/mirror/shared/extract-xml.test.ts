import { describe, test, expect } from "bun:test"
import {
  extractTag,
  extractAllTags,
  extractTagWithAttrs,
  extractAllTagsWithAttrs,
  extractFencedCode,
  extractCode,
  extractCodeWithReason,
  extractPlan,
  extractProject,
  parseJSON,
} from "../../../src/mirror/shared/extract-xml"

describe("extractTag", () => {
  test("returns content between matching tags", () => {
    expect(extractTag("<foo>bar</foo>", "foo")).toBe("bar")
  })

  test("handles hyphenated tag names", () => {
    expect(extractTag("<source-code>x</source-code>", "source-code")).toBe("x")
  })

  test("returns undefined when tag absent", () => {
    expect(extractTag("nothing here", "foo")).toBeUndefined()
  })

  test("auto-closes truncated tag — salvages content up to EOF", () => {
    // Parser.end() closes the unclosed tag, exposing what we have so far.
    const result = extractTag("<foo>partial content", "foo")
    expect(result).toBe("partial content")
  })

  test("preserves inner verbatim (including JSX)", () => {
    const verbatim = `<div className="a">{x && <span>ok</span>}</div>`
    expect(extractTag(`<source>${verbatim}</source>`, "source")).toBe(verbatim)
  })

  test("shields fenced </tag> from false-closing outer tag", () => {
    const input = "<source-code>```tsx\nconst x = </source-code>\n```\n</source-code>"
    // Without shielding, parser would close at the first </source-code> inside the fence.
    const out = extractTag(input, "source-code")
    expect(out).toContain("```tsx")
    expect(out).toContain("</source-code>") // the fenced one survives intact
  })

  test("returns first of multiple matches", () => {
    expect(extractTag("<a>1</a><a>2</a>", "a")).toBe("1")
  })
})

describe("extractAllTags", () => {
  test("returns all matches in order", () => {
    expect(extractAllTags("<a>1</a><a>2</a><a>3</a>", "a")).toEqual(["1", "2", "3"])
  })

  test("returns empty array when absent", () => {
    expect(extractAllTags("nothing", "a")).toEqual([])
  })
})

describe("extractTagWithAttrs / extractAllTagsWithAttrs", () => {
  test("captures opening-tag attributes", () => {
    const result = extractTagWithAttrs(`<file-audit path="a.ts" status="ok">body</file-audit>`, "file-audit")
    expect(result?.content).toBe("body")
    expect(result?.attrs).toEqual({ path: "a.ts", status: "ok" })
  })

  test("preserves attrs per occurrence", () => {
    const text = `<file-audit path="a.ts">A</file-audit><file-audit path="b.ts">B</file-audit>`
    const all = extractAllTagsWithAttrs(text, "file-audit")
    expect(all).toHaveLength(2)
    expect(all[0].attrs.path).toBe("a.ts")
    expect(all[1].attrs.path).toBe("b.ts")
  })
})

describe("extractFencedCode", () => {
  test("picks the LAST fenced block", () => {
    const text = "intro\n```\nfirst\n```\nmiddle\n```\nsecond\n```\n"
    expect(extractFencedCode(text)).toBe("second")
  })

  test("accepts language tag", () => {
    expect(extractFencedCode("```tsx\nconst x = 1\n```")).toBe("const x = 1")
  })

  test("normalizes \\r\\n", () => {
    expect(extractFencedCode("```\r\nline\r\n```")).toBe("line")
  })

  test("returns undefined when no fence", () => {
    expect(extractFencedCode("no fences here")).toBeUndefined()
  })
})

describe("extractCode", () => {
  test("extracts <source-code> wrapped fence", () => {
    const input = "prose\n<source-code>\n```tsx\nexport const x = 1\n```\n</source-code>\n"
    expect(extractCode(input)).toBe("export const x = 1")
  })

  test("falls back to direct fenced block when no <source-code>", () => {
    const input = "intro\n```\nexport const x = 1\n```\n"
    expect(extractCode(input)).toBe("export const x = 1")
  })

  test("strips <think> reasoning block before matching", () => {
    const input = "<think>a wild reasoning appeared</think>\n<source-code>```ts\nok\n```</source-code>"
    expect(extractCode(input)).toBe("ok")
  })

  test("empty tag body yields empty_content reason", () => {
    const result = extractCodeWithReason("<source-code></source-code>")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("empty_content")
  })

  test("no tag and no fence yields no_fence reason", () => {
    const result = extractCodeWithReason("nothing structured here")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_fence")
  })
})

describe("parseJSON", () => {
  test("strict JSON fast path", () => {
    expect(parseJSON('{"a":1}')).toEqual({ a: 1 })
  })

  test("JSON5 features — trailing comma, single quotes, unquoted keys", () => {
    expect(parseJSON("{ a: 1, b: 'two', }")).toEqual({ a: 1, b: "two" })
  })

  test("repairs truncated object by closing brackets", () => {
    const result = parseJSON('{"a":1,"b":{"c":2') as { a: number; b: { c: number } }
    expect(result.a).toBe(1)
    expect(result.b.c).toBe(2)
  })

  test("strips trailing comma before close", () => {
    expect(parseJSON('{"a":1,}')).toEqual({ a: 1 })
  })

  test("returns undefined for unrecoverable garbage", () => {
    expect(parseJSON("not json at all")).toBeUndefined()
  })

  test("sanitizes raw newlines inside string values", () => {
    // JSON.parse would reject this; sanitiser converts \n → \\n.
    expect(parseJSON('{"a":"line1\nline2"}')).toEqual({ a: "line1\nline2" })
  })
})

describe("extractPlan", () => {
  test("extracts JSON array from <project-framework>", () => {
    const text = `<project-framework>[{"file_path":"a.ts"}]</project-framework>`
    expect(extractPlan(text)).toEqual([{ file_path: "a.ts" }])
  })

  test("falls back to last JSON array when no tag", () => {
    const text = `some prose\n\`\`\`json\n[{"file_path":"a.ts"}]\n\`\`\`\ntrailing`
    expect(extractPlan(text)).toEqual([{ file_path: "a.ts" }])
  })

  test("requires file_path key in fallback (rejects random arrays)", () => {
    expect(extractPlan("[1,2,3]")).toBeUndefined()
  })

  test("returns undefined when nothing parseable", () => {
    expect(extractPlan("just prose")).toBeUndefined()
  })
})

describe("extractProject", () => {
  test("extracts JSON from <project> tag", () => {
    expect(extractProject("<project>{\"name\":\"x\"}</project>")).toEqual({ name: "x" })
  })
})
