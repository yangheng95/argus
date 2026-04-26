import { describe, expect, test } from "bun:test"
import { ImageAnalysisSchema } from "../../../src/mirror/ir/image-analysis"
import { ImageExtractError } from "../../../src/mirror/errors"
import { extractImage } from "../../../src/mirror/image/extract"
import { imageExtractMessages, IMAGE_EXTRACT_SYSTEM } from "../../../src/mirror/image/prompt"

describe("image extract — schema + input guards (no LLM call)", () => {
  test("ImageAnalysisSchema rejects empty tree", () => {
    const result = ImageAnalysisSchema.safeParse({
      description: "x",
      viewport: { width: 1, height: 1 },
      tokens: { colors: {}, fonts: [], textStyles: [] },
      tree: [],
      confidence: 0,
    })
    expect(result.success).toBe(false)
  })

  test("ImageAnalysisSchema accepts a minimal valid payload", () => {
    const result = ImageAnalysisSchema.safeParse({
      description: "x",
      viewport: { width: 1440, height: 900 },
      tokens: { colors: {}, fonts: [], textStyles: [] },
      tree: [{ name: "root", bounds: { x: 0, y: 0, w: 1, h: 1 } }],
      confidence: 0.5,
    })
    expect(result.success).toBe(true)
  })

  test("ImageAnalysisSchema clamps confidence range", () => {
    expect(
      ImageAnalysisSchema.safeParse({
        description: "x",
        viewport: { width: 1, height: 1 },
        tokens: { colors: {}, fonts: [], textStyles: [] },
        tree: [{ name: "r", bounds: { x: 0, y: 0, w: 1, h: 1 } }],
        confidence: 1.5,
      }).success,
    ).toBe(false)
  })

  test("extractImage throws ImageExtractError when given no images", async () => {
    await expect(
      extractImage({ images: [], model: {} as never }),
    ).rejects.toBeInstanceOf(ImageExtractError)
  })

  test("extractImage throws when an image entry has neither path nor data", async () => {
    await expect(
      extractImage({ images: [{ mediaType: "image/png" }], model: {} as never }),
    ).rejects.toBeInstanceOf(ImageExtractError)
  })

  test("extractImage throws when bytes are supplied without mediaType", async () => {
    await expect(
      extractImage({
        images: [{ data: Buffer.from([1, 2, 3]) }],
        model: {} as never,
      }),
    ).rejects.toBeInstanceOf(ImageExtractError)
  })
})

describe("image extract prompt", () => {
  test("imageExtractMessages requires at least one image", () => {
    expect(() => imageExtractMessages({ images: [] })).toThrow()
  })

  test("imageExtractMessages embeds page hint and component library", () => {
    const out = imageExtractMessages({
      images: [{ data: Buffer.from([0]), mediaType: "image/png" }],
      pageHint: "homepage",
      componentLibrary: "antd",
    })
    expect(out.system).toBe(IMAGE_EXTRACT_SYSTEM)
    const userText = (out.messages[0].content[0] as { text: string }).text
    expect(userText).toContain("homepage")
    expect(userText).toContain("antd")
  })

  test("imageExtractMessages stacks multiple images with index labels", () => {
    const out = imageExtractMessages({
      images: [
        { data: Buffer.from([1]), mediaType: "image/png" },
        { data: Buffer.from([2]), mediaType: "image/jpeg" },
      ],
    })
    const parts = out.messages[0].content
    // one intro text + (label + file) per image = 1 + 2 + 2 = 5 parts
    expect(parts).toHaveLength(5)
    expect((parts[1] as { text: string }).text).toContain("Image 1/2")
    expect((parts[3] as { text: string }).text).toContain("Image 2/2")
    expect((parts[2] as { mediaType: string }).mediaType).toBe("image/png")
    expect((parts[4] as { mediaType: string }).mediaType).toBe("image/jpeg")
  })
})
