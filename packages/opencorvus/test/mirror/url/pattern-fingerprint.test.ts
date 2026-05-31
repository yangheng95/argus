import { describe, test, expect } from "bun:test"

import {
  fingerprint,
  fingerprintBounded,
  fingerprintSimilarity,
  countElements,
  collectFingerprints,
} from "../../../src/mirror/url/pattern/fingerprint"
import type { ExtractedElement } from "../../../src/mirror/ir/extracted-page"

function el(tag: string, extras: Partial<ExtractedElement> = {}): ExtractedElement {
  return {
    selector: tag,
    tag,
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    styles: {},
    ...extras,
  } as ExtractedElement
}

const fixtures: Array<{ name: string; el: ExtractedElement }> = [
  { name: "text leaf", el: el("p", { text: "hi" }) },
  { name: "image leaf", el: el("img", { imageSrc: "https://cdn/x.png" }) },
  { name: "svg icon", el: el("svg") },
  { name: "heading h3", el: el("h3", { text: "Title" }) },
  {
    name: "flex row with 3 text links",
    el: el("div", {
      styles: { display: "flex", flexDirection: "row" },
      children: [el("a", { text: "a" }), el("a", { text: "b" }), el("a", { text: "c" })],
    }),
  },
  {
    name: "grid container",
    el: el("section", {
      styles: { display: "grid", gridTemplateColumns: "1fr 1fr" },
      children: [
        el("div", { children: [el("h2", { text: "T" }), el("p", { text: "P" })] }),
        el("div", { children: [el("h2", { text: "T" }), el("p", { text: "P" })] }),
      ],
    }),
  },
]

describe("fingerprint", () => {
  test("encodes leaf kind and normalized tag", () => {
    expect(fingerprint(fixtures[0].el)).toBe("t:_:T")
    expect(fingerprint(fixtures[1].el)).toBe("m:_:M")
    expect(fingerprint(fixtures[2].el)).toBe("i:_:I")
  })

  for (const f of fixtures) {
    test(`${f.name} is deterministic`, () => {
      expect(fingerprint(f.el)).toBe(fingerprint(f.el))
      expect(fingerprintBounded(f.el, 2)).toBe(fingerprintBounded(f.el, 2))
    })
  }
})

describe("fingerprintSimilarity", () => {
  test("scores edge cases", () => {
    expect(fingerprintSimilarity("", "")).toBe(1)
    expect(fingerprintSimilarity("x", "")).toBe(0)
    expect(fingerprintSimilarity("x", "x")).toBe(1)
  })

  test("identical trees score higher than different trees", () => {
    const same = fingerprintSimilarity(fingerprint(fixtures[4].el), fingerprint(fixtures[4].el))
    const different = fingerprintSimilarity(fingerprint(fixtures[0].el), fingerprint(fixtures[5].el))
    expect(same).toBe(1)
    expect(different).toBeLessThan(same)
    expect(different).toBeGreaterThanOrEqual(0)
  })
})

describe("countElements and collectFingerprints", () => {
  test("counts nested elements including the root", () => {
    expect(countElements(fixtures[5].el)).toBe(7)
  })

  test("collects pre-order fingerprint entries", () => {
    const entries = collectFingerprints(fixtures[5].el)
    expect(entries).toHaveLength(countElements(fixtures[5].el))
    expect(entries[0].element).toBe(fixtures[5].el)
    expect(entries[0].fingerprint).toBe(fingerprintBounded(fixtures[5].el))
    expect(entries[0].elementCount).toBe(countElements(fixtures[5].el))
  })
})
