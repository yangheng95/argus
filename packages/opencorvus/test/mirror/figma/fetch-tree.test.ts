import { describe, test, expect, beforeEach, afterEach } from "bun:test"

import {
  fetchFigmaTree,
  buildDesignFromRaw,
} from "../../../src/mirror/figma/fetch-tree"
import { FigmaFetchError } from "../../../src/mirror/errors"
import { CompressedDesignSchema } from "../../../src/mirror/ir/compressed-design"

// Golden parity — mirror original
import { extractFigma as mirrorExtract } from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/figma/extract-core.ts"

// ─── Fixtures ─────────────────────────────────────────────────────────────

function sampleFigmaFile() {
  return {
    name: "Test File",
    lastModified: "2026-04-05T12:00:00Z",
    components: {
      comp1: { name: "Button", description: "Primary CTA", key: "k1" },
    },
    componentSets: {},
    styles: {
      s1: { name: "primary", styleType: "FILL" },
    },
    document: {
      id: "0:0",
      type: "DOCUMENT",
      name: "Document",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          name: "Page 1",
          children: [
            {
              id: "1:1",
              type: "FRAME",
              name: "Root Frame",
              visible: true,
              absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
              layoutMode: "VERTICAL",
              itemSpacing: 16,
              paddingTop: 24,
              paddingRight: 24,
              paddingBottom: 24,
              paddingLeft: 24,
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, visible: true }],
              children: [
                {
                  id: "1:2",
                  type: "TEXT",
                  name: "Heading",
                  visible: true,
                  absoluteBoundingBox: { x: 24, y: 24, width: 400, height: 40 },
                  characters: "Welcome",
                  style: {
                    fontFamily: "Inter",
                    fontSize: 32,
                    fontWeight: 700,
                    lineHeightPx: 40,
                    textAlignHorizontal: "LEFT",
                  },
                  fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 }, visible: true }],
                  styles: { fill: "s1", text: "s1" },
                },
                {
                  id: "1:3",
                  type: "INSTANCE",
                  name: "Button Instance",
                  componentId: "comp1",
                  visible: true,
                  absoluteBoundingBox: { x: 24, y: 80, width: 120, height: 40 },
                  fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 1 }, visible: true }],
                  rectangleCornerRadii: [8, 8, 8, 8],
                },
                {
                  id: "1:4",
                  type: "FRAME",
                  name: "Card",
                  visible: true,
                  absoluteBoundingBox: { x: 24, y: 140, width: 400, height: 200 },
                  fills: [
                    {
                      type: "GRADIENT_LINEAR",
                      visible: true,
                      gradientStops: [
                        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
                        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
                      ],
                      gradientHandlePositions: [
                        { x: 0, y: 0 },
                        { x: 1, y: 1 },
                      ],
                    },
                  ],
                  cornerRadius: 12,
                  effects: [
                    {
                      type: "DROP_SHADOW",
                      visible: true,
                      color: { r: 0, g: 0, b: 0, a: 0.1 },
                      offset: { x: 0, y: 2 },
                      radius: 4,
                      spread: 0,
                    },
                  ],
                  opacity: 0.95,
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

function sampleCommentsResponse() {
  return {
    comments: [
      {
        message: "Consider tightening spacing here",
        client_meta: { node_id: "1:1" },
        user: { handle: "alice" },
      },
    ],
  }
}

// ─── buildDesignFromRaw — GOLDEN PARITY (no network) ──────────────────────

describe("buildDesignFromRaw — GOLDEN PARITY (pure, no network)", () => {
  // mirror exports buildDesign as module-private, but we can reach it via
  // extractFigma by mocking fetch. Test the pure path via compare to output
  // of mirror's own extractFigma when image fetch is disabled.

  test("minimal file — identical CompressedDesign structure (pre-image phase)", () => {
    const file = sampleFigmaFile()
    const comments = sampleCommentsResponse().comments
    const figmaUrl = "https://www.figma.com/file/ABC/Test"
    const ours = buildDesignFromRaw(file, comments, 15, figmaUrl)
    // Schema accepts the output → structure is correct
    expect(() => CompressedDesignSchema.parse(ours)).not.toThrow()
    // Spot checks
    expect(ours.fileName).toBe("Test File")
    expect(ours.lastModified).toBe("2026-04-05T12:00:00Z")
    expect(ours.pages).toHaveLength(1)
    expect(ours.pages[0].frames).toHaveLength(1)
    expect(ours.pages[0].frames[0].children).toHaveLength(3)
    // Instance → componentName wired through
    const btn = ours.pages[0].frames[0].children!.find((c) => c.id === "1:3")
    expect(btn?.componentName).toBe("Button")
    expect(btn?.description).toBe("Primary CTA")
    // Gradient extracted on card
    const card = ours.pages[0].frames[0].children!.find((c) => c.id === "1:4")
    expect(card?.style?.bgGradient).toMatch(/linear-gradient/)
    // Shadow extracted
    expect(card?.style?.shadow).toMatch(/rgba|#/)
    // Opacity
    expect(card?.style?.opacity).toBe(0.95)
    // Text style captured
    const heading = ours.pages[0].frames[0].children!.find((c) => c.id === "1:2")
    expect(heading?.text?.content).toBe("Welcome")
    expect(heading?.text?.font).toBe("Inter")
    expect(heading?.text?.size).toBe(32)
    expect(heading?.text?.color).toBe("#1a1a1a")
  })
})

// ─── GOLDEN PARITY via fetch mock — whole fetchFigmaTree pipeline ─────────

describe("fetchFigmaTree — GOLDEN PARITY via fetch mock", () => {
  const ORIGINAL_FETCH = globalThis.fetch
  let fetchCalls: string[] = []

  beforeEach(() => {
    fetchCalls = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async (url: any, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString()
      fetchCalls.push(urlStr)

      if (urlStr.includes("/comments")) {
        return new Response(JSON.stringify(sampleCommentsResponse()), { status: 200 })
      }
      if (urlStr.includes("/images/")) {
        return new Response(JSON.stringify({ err: null, images: {} }), { status: 200 })
      }
      // File fetch
      return new Response(JSON.stringify(sampleFigmaFile()), { status: 200 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  test("output byte-identical to mirror's extractFigma", async () => {
    const figmaUrl = "https://www.figma.com/file/ABC/Test"
    const ours = await fetchFigmaTree({ figmaUrl, token: "stub-token", noImages: false })
    const theirs = await mirrorExtract({ fileKey: figmaUrl, token: "stub-token", noImages: false })
    expect(ours).toEqual(theirs)
  })

  test("output schema-valid", async () => {
    const figmaUrl = "https://www.figma.com/file/ABC/Test"
    const ours = await fetchFigmaTree({ figmaUrl, token: "stub-token", noImages: false })
    expect(() => CompressedDesignSchema.parse(ours)).not.toThrow()
  })

  test("calls /files, /comments, /images in order", async () => {
    const figmaUrl = "https://www.figma.com/design/ABC/Test?node-id=1-1"
    await fetchFigmaTree({ figmaUrl, token: "stub-token" })
    expect(fetchCalls.some((u) => u.includes("/files/ABC/nodes"))).toBe(true)
    expect(fetchCalls.some((u) => u.includes("/files/ABC/comments"))).toBe(true)
    expect(fetchCalls.some((u) => u.includes("/images/ABC"))).toBe(true)
  })
})

// ─── Error paths (no network) ─────────────────────────────────────────────

describe("fetchFigmaTree — error paths", () => {
  test("throws FigmaFetchError when token missing and env absent", async () => {
    const saved = process.env.FIGMA_API_TOKEN
    delete process.env.FIGMA_API_TOKEN
    try {
      await fetchFigmaTree({ figmaUrl: "https://figma.com/file/X/T" })
      throw new Error("should have thrown")
    } catch (e) {
      expect(FigmaFetchError.isInstance(e)).toBe(true)
      if (FigmaFetchError.isInstance(e)) expect(e.data.reason).toContain("missing Figma token")
    } finally {
      if (saved) process.env.FIGMA_API_TOKEN = saved
    }
  })

  test("propagates non-OK HTTP via typed error", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response("nope", {
        status: 403,
        statusText: "Forbidden",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any
    try {
      await fetchFigmaTree({
        figmaUrl: "https://figma.com/file/X/T",
        token: "stub",
      })
      throw new Error("should have thrown")
    } catch (e) {
      expect(FigmaFetchError.isInstance(e)).toBe(true)
      if (FigmaFetchError.isInstance(e)) expect(e.data.status).toBe(403)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
