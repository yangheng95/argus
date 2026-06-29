import { describe, expect, test } from "bun:test"
import sharp from "sharp"
import {
  MODEL_IMAGE_INPUT_PIXEL_BUDGET,
  ModelImageInputTooLargeError,
  assertModelImageInputWithinLimits,
  modelImageInputTargetDimensions,
  prepareModelImageInput,
  readModelImageDimensions,
} from "../../src/session/model-image-input"

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function jpegHeader(width: number, height: number): Buffer {
  const bytes = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ])
  return bytes
}

function webpVp8xHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30)
  bytes.write("RIFF", 0, "ascii")
  bytes.writeUInt32LE(22, 4)
  bytes.write("WEBP", 8, "ascii")
  bytes.write("VP8X", 12, "ascii")
  bytes.writeUInt32LE(10, 16)
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}

function webpVp8lHeader(width: number, height: number): Buffer {
  const widthMinusOne = width - 1
  const heightMinusOne = height - 1
  const bytes = Buffer.alloc(25)
  bytes.write("RIFF", 0, "ascii")
  bytes.writeUInt32LE(17, 4)
  bytes.write("WEBP", 8, "ascii")
  bytes.write("VP8L", 12, "ascii")
  bytes.writeUInt32LE(5, 16)
  bytes[20] = 0x2f
  bytes[21] = widthMinusOne & 0xff
  bytes[22] = ((widthMinusOne >> 8) & 0x3f) | ((heightMinusOne & 0x03) << 6)
  bytes[23] = (heightMinusOne >> 2) & 0xff
  bytes[24] = (heightMinusOne >> 10) & 0x0f
  return bytes
}

async function pngWithBlackBlock(input: {
  width: number
  height: number
  left: number
  top: number
  blockWidth: number
  blockHeight: number
}): Promise<Buffer> {
  const block = await sharp({
    create: {
      width: input.blockWidth,
      height: input.blockHeight,
      channels: 3,
      background: "#000000",
    },
  })
    .png()
    .toBuffer()
  return await sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([{ input: block, left: input.left, top: input.top }])
    .png()
    .toBuffer()
}

async function pngWithBlackCorners(width: number, height: number): Promise<Buffer> {
  const dot = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: "#000000",
    },
  })
    .png()
    .toBuffer()
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: dot, left: width - 1, top: 0 },
      { input: dot, left: 0, top: height - 1 },
      { input: dot, left: width - 1, top: height - 1 },
    ])
    .png()
    .toBuffer()
}

describe("session.model-image-input", () => {
  test("reads dimensions from provider-bound image headers", () => {
    expect(readModelImageDimensions(pngHeader(1440, 900))).toMatchObject({
      format: "png",
      width: 1440,
      height: 900,
    })
    expect(readModelImageDimensions(jpegHeader(1600, 1200))).toMatchObject({
      format: "jpeg",
      width: 1600,
      height: 1200,
    })
    expect(readModelImageDimensions(webpVp8xHeader(2048, 1536))).toMatchObject({
      format: "webp",
      width: 2048,
      height: 1536,
    })
    expect(readModelImageDimensions(webpVp8lHeader(320, 240))).toMatchObject({
      format: "webp",
      width: 320,
      height: 240,
    })
  })

  test("strict image limit assertion throws a typed error when any image dimension exceeds the limit", () => {
    let caught: unknown
    try {
      assertModelImageInputWithinLimits({
        mime: "image/png",
        bytes: pngHeader(1440, 19773),
        source: "full.png",
      })
    } catch (error) {
      caught = error
    }

    expect(ModelImageInputTooLargeError.isInstance(caught)).toBe(true)
    expect((caught as { data: { width: number; height: number; maxDimension: number } }).data).toMatchObject({
      width: 1440,
      height: 19773,
      maxDimension: 8000,
    })
  })

  test("computes proportional target dimensions from the shared model image pixel budget", () => {
    expect(modelImageInputTargetDimensions({ width: 3000, height: 2000 })).toMatchObject({
      width: 1254,
      height: 836,
    })
    expect(1254 * 836).toBeLessThanOrEqual(MODEL_IMAGE_INPUT_PIXEL_BUDGET)
  })

  test("crops blank screenshot margins before binding image bytes to the model", async () => {
    const source = await pngWithBlackBlock({
      width: 32,
      height: 16,
      left: 4,
      top: 0,
      blockWidth: 8,
      blockHeight: 16,
    })

    const prepared = await prepareModelImageInput({
      mime: "image/png",
      bytes: source,
      source: "wide-screenshot.png",
    })

    expect(readModelImageDimensions(prepared.bytes)).toMatchObject({ width: 8, height: 16 })
    expect(prepared.crop).toMatchObject({
      originalWidth: 32,
      originalHeight: 16,
      width: 8,
      height: 16,
    })
    expect(prepared.note).toContain("original 32x16, model input 8x16")
  })

  test("resizes after blank crop when cropped image exceeds the model dimension limit", async () => {
    const source = await pngWithBlackBlock({
      width: 20,
      height: 8010,
      left: 2,
      top: 0,
      blockWidth: 10,
      blockHeight: 8010,
    })

    const prepared = await prepareModelImageInput({
      mime: "image/png",
      bytes: source,
      source: "tall-screenshot.png",
    })
    const dimensions = readModelImageDimensions(prepared.bytes)

    expect(prepared.crop).toMatchObject({
      width: 10,
      height: 8010,
      originalWidth: 20,
      originalHeight: 8010,
    })
    expect(prepared.resize).toMatchObject({
      inputWidth: 10,
      inputHeight: 8010,
      height: 8000,
      maxDimension: 8000,
      maxPixels: MODEL_IMAGE_INPUT_PIXEL_BUDGET,
    })
    expect(dimensions?.height).toBeLessThanOrEqual(8000)
    expect((dimensions?.width ?? 0) * (dimensions?.height ?? 0)).toBeLessThanOrEqual(MODEL_IMAGE_INPUT_PIXEL_BUDGET)
    expect(prepared.note).toContain("Resized tall-screenshot.png for model input")
  })

  test("resizes large-area images even when both dimensions are below the single-dimension limit", async () => {
    const source = await pngWithBlackCorners(3000, 2000)

    const prepared = await prepareModelImageInput({
      mime: "image/png",
      bytes: source,
      source: "large-area.png",
    })
    const dimensions = readModelImageDimensions(prepared.bytes)

    expect(dimensions).toMatchObject({ width: 1254, height: 836 })
    expect(prepared.resize).toMatchObject({
      inputWidth: 3000,
      inputHeight: 2000,
      width: 1254,
      height: 836,
      maxPixels: MODEL_IMAGE_INPUT_PIXEL_BUDGET,
    })
    expect(1254 * 836).toBeLessThanOrEqual(MODEL_IMAGE_INPUT_PIXEL_BUDGET)
  })
})
