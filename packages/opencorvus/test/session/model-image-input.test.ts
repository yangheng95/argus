import { describe, expect, test } from "bun:test"
import {
  ModelImageInputTooLargeError,
  assertModelImageInputWithinLimits,
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

  test("throws typed error when any model-bound image dimension exceeds the limit", () => {
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
})
