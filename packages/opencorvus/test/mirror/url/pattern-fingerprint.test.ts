import { describe, test, expect } from "bun:test"

import {
  fingerprint,
  fingerprintBounded,
  fingerprintSimilarity,
  countElements,
  collectFingerprints,
} from "../../../src/mirror/url/pattern/fingerprint"
import type { ExtractedElement } from "../../../src/mirror/ir/extracted-page"

// Golden parity — mirror originals
import {
  fingerprint as mirrorFingerprint,
  fingerprintBounded as mirrorFingerprintBounded,
  fingerprintSimilarity as mirrorFingerprintSimilarity,
  countElements as mirrorCountElements,
  collectFingerprints as mirrorCollectFingerprints,
} from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/pattern/fingerprint.ts"

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
  {
    name: "deeply nested (for bounded test)",
    el: el("div", {
      children: [
        el("div", {
          children: [
            el("div", {
              children: [
                el("div", {
                  children: [
                    el("div", {
                      children: [
                        el("div", {
                          children: [el("p", { text: "deep" })],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  },
]

// ─── GOLDEN PARITY ────────────────────────────────────────────────────────

describe("fingerprint — GOLDEN PARITY", () => {
  for (const f of fixtures) {
    test(f.name, () => {
      expect(fingerprint(f.el)).toBe(mirrorFingerprint(f.el))
    })
  }
})

describe("fingerprintBounded — GOLDEN PARITY", () => {
  for (const f of fixtures) {
    for (const depth of [0, 1, 2, 3, 6]) {
      test(`${f.name} (maxDepth=${depth})`, () => {
        expect(fingerprintBounded(f.el, depth)).toBe(mirrorFingerprintBounded(f.el, depth))
      })
    }
  }
})

describe("fingerprintSimilarity — GOLDEN PARITY", () => {
  const pairs: Array<[ExtractedElement, ExtractedElement]> = [
    [fixtures[0].el, fixtures[0].el], // identical
    [fixtures[0].el, fixtures[1].el], // text vs image
    [fixtures[4].el, fixtures[5].el], // flex vs grid
    [fixtures[4].el, fixtures[4].el],
  ]
  test.each(pairs)("similarity between pair matches mirror", (a, b) => {
    const fpA = fingerprint(a)
    const fpB = fingerprint(b)
    expect(fingerprintSimilarity(fpA, fpB)).toBeCloseTo(mirrorFingerprintSimilarity(fpA, fpB), 10)
  })

  test("edge cases", () => {
    expect(fingerprintSimilarity("", "")).toBe(mirrorFingerprintSimilarity("", ""))
    expect(fingerprintSimilarity("x", "")).toBe(mirrorFingerprintSimilarity("x", ""))
    expect(fingerprintSimilarity("x", "x")).toBe(mirrorFingerprintSimilarity("x", "x"))
  })
})

describe("countElements — GOLDEN PARITY", () => {
  for (const f of fixtures) {
    test(f.name, () => {
      expect(countElements(f.el)).toBe(mirrorCountElements(f.el))
    })
  }
})

describe("collectFingerprints — GOLDEN PARITY", () => {
  for (const f of fixtures) {
    test(f.name, () => {
      const ours = collectFingerprints(f.el)
      const theirs = mirrorCollectFingerprints(f.el)
      expect(ours.length).toBe(theirs.length)
      for (let i = 0; i < ours.length; i++) {
        expect(ours[i].fingerprint).toBe(theirs[i].fingerprint)
        expect(ours[i].depth).toBe(theirs[i].depth)
        expect(ours[i].elementCount).toBe(theirs[i].elementCount)
      }
    })
  }
})
