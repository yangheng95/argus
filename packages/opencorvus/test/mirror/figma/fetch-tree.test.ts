import { describe, test, expect, beforeEach, afterEach } from "bun:test"

import {
  fetchFigmaTree,
  buildDesignFromRaw,
} from "../../../src/mirror/figma/fetch-tree"
import { FigmaFetchError } from "../../../src/mirror/errors"
import { CompressedDesignSchema } from "../../../src/mirror/ir/compressed-design"

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

describe("buildDesignFromRaw", () => {
  test("builds a schema-valid compressed design from raw Figma data", () => {
    const result = buildDesignFromRaw(
      sampleFigmaFile(),
      sampleCommentsResponse().comments,
      15,
      "https://www.figma.com/file/ABC/Test",
    )

    expect(() => CompressedDesignSchema.parse(result)).not.toThrow()
    expect(result.fileName).toBe("Test File")
    expect(result.lastModified).toBe("2026-04-05T12:00:00Z")
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0].frames).toHaveLength(1)
    expect(result.pages[0].frames[0].children).toHaveLength(2)

    const button = result.pages[0].frames[0].children?.find((child) => child.id === "1:3")
    expect(button?.componentName).toBe("Button")
    expect(button?.description).toBe("Primary CTA")

    const heading = result.pages[0].frames[0].children?.find((child) => child.id === "1:2")
    expect(heading?.text?.content).toBe("Welcome")
    expect(heading?.text?.font).toBe("Inter")
    expect(heading?.text?.size).toBe(32)
  })
})

describe("fetchFigmaTree", () => {
  const originalFetch = globalThis.fetch
  let fetchCalls: string[] = []

  beforeEach(() => {
    fetchCalls = []
    globalThis.fetch = (async (url: unknown) => {
      const urlStr = typeof url === "string" ? url : String(url)
      fetchCalls.push(urlStr)

      if (urlStr.includes("/comments")) {
        return new Response(JSON.stringify(sampleCommentsResponse()), { status: 200 })
      }
      if (urlStr.includes("/images/")) {
        return new Response(JSON.stringify({ err: null, images: {} }), { status: 200 })
      }
      return new Response(JSON.stringify(sampleFigmaFile()), { status: 200 })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns schema-valid output", async () => {
    const result = await fetchFigmaTree({ figmaUrl: "https://www.figma.com/file/ABC/Test", token: "stub-token", noImages: false })
    expect(() => CompressedDesignSchema.parse(result)).not.toThrow()
  })

  test("calls files, comments, and images endpoints", async () => {
    await fetchFigmaTree({ figmaUrl: "https://www.figma.com/design/ABC/Test?node-id=1-1", token: "stub-token" })
    expect(fetchCalls.some((url) => url.includes("/files/ABC/nodes"))).toBe(true)
    expect(fetchCalls.some((url) => url.includes("/files/ABC/comments"))).toBe(true)
    expect(fetchCalls.some((url) => url.includes("/images/ABC"))).toBe(true)
  })
})

describe("fetchFigmaTree error paths", () => {
  test("throws FigmaFetchError when token missing and env absent", async () => {
    const saved = process.env.FIGMA_API_TOKEN
    delete process.env.FIGMA_API_TOKEN
    try {
      await fetchFigmaTree({ figmaUrl: "https://figma.com/file/X/T" })
      throw new Error("should have thrown")
    } catch (error) {
      expect(FigmaFetchError.isInstance(error)).toBe(true)
      if (FigmaFetchError.isInstance(error)) expect(error.data.reason).toContain("missing Figma token")
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
      })) as typeof fetch
    try {
      await fetchFigmaTree({
        figmaUrl: "https://figma.com/file/X/T",
        token: "stub",
      })
      throw new Error("should have thrown")
    } catch (error) {
      expect(FigmaFetchError.isInstance(error)).toBe(true)
      if (FigmaFetchError.isInstance(error)) expect(error.data.status).toBe(403)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
