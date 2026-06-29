import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { requireRuntimePackage } from "@/runtime/package-require"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")

export const MAX_MODEL_IMAGE_INPUT_DIMENSION = 8000
const BLANK_MARGIN_CROP_THRESHOLD = 10

export interface ImageDimensions {
  width: number
  height: number
  format: "png" | "jpeg" | "webp"
}

export interface ModelImageBlankMarginCrop {
  originalWidth: number
  originalHeight: number
  width: number
  height: number
  trimOffsetLeft?: number
  trimOffsetTop?: number
}

export interface PreparedModelImageInput {
  mime: string
  bytes: Buffer
  dimensions?: ImageDimensions
  crop?: ModelImageBlankMarginCrop
  note?: string
}

export const ModelImageInputTooLargeError = NamedError.create(
  "ModelImageInputTooLargeError",
  z.object({
    message: z.string(),
    mime: z.string(),
    source: z.string(),
    width: z.number(),
    height: z.number(),
    maxDimension: z.number(),
    originalWidth: z.number().optional(),
    originalHeight: z.number().optional(),
    blankMarginCrop: z
      .object({
        originalWidth: z.number(),
        originalHeight: z.number(),
        width: z.number(),
        height: z.number(),
        trimOffsetLeft: z.number().optional(),
        trimOffsetTop: z.number().optional(),
      })
      .optional(),
  }),
)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function readModelImageDimensions(bytes: Buffer): ImageDimensions | undefined {
  return readPngDimensions(bytes) ?? readJpegDimensions(bytes) ?? readWebpDimensions(bytes)
}

export function assertModelImageInputWithinLimits(input: {
  mime: string
  bytes: Buffer
  source: string
  maxDimension?: number
}): void {
  if (!input.mime.toLowerCase().startsWith("image/")) return
  const dimensions = readModelImageDimensions(input.bytes)
  if (!dimensions) return
  const maxDimension = input.maxDimension ?? MAX_MODEL_IMAGE_INPUT_DIMENSION
  if (dimensions.width <= maxDimension && dimensions.height <= maxDimension) return
  throw new ModelImageInputTooLargeError({
    mime: input.mime,
    source: input.source,
    width: dimensions.width,
    height: dimensions.height,
    maxDimension,
    message:
      `Model image input too large: ${input.source} is ${dimensions.width}x${dimensions.height} ` +
      `(${input.mime}); max supported dimension is ${maxDimension}px. ` +
      "Use a viewport screenshot, scroll slice, region crop, or coordinate atlas instead of sending the full image.",
  })
}

export async function prepareModelImageInput(input: {
  mime: string
  bytes: Buffer
  source: string
  maxDimension?: number
}): Promise<PreparedModelImageInput> {
  if (!input.mime.toLowerCase().startsWith("image/")) {
    return { mime: input.mime, bytes: input.bytes }
  }

  const originalDimensions = readModelImageDimensions(input.bytes)
  if (!originalDimensions) {
    assertModelImageInputWithinLimits(input)
    return { mime: input.mime, bytes: input.bytes }
  }

  const cropped = await cropBlankMargins({
    mime: input.mime,
    bytes: input.bytes,
    originalDimensions,
  })
  const bytes = cropped?.bytes ?? input.bytes
  const dimensions = readModelImageDimensions(bytes) ?? originalDimensions
  const crop = cropped?.crop
  const maxDimension = input.maxDimension ?? MAX_MODEL_IMAGE_INPUT_DIMENSION
  if (dimensions.width > maxDimension || dimensions.height > maxDimension) {
    const afterCrop =
      crop && (crop.originalWidth !== dimensions.width || crop.originalHeight !== dimensions.height)
        ? ` after blank-margin crop from ${crop.originalWidth}x${crop.originalHeight}`
        : ""
    throw new ModelImageInputTooLargeError({
      mime: input.mime,
      source: input.source,
      width: dimensions.width,
      height: dimensions.height,
      maxDimension,
      originalWidth: crop?.originalWidth,
      originalHeight: crop?.originalHeight,
      blankMarginCrop: crop,
      message:
        `Model image input too large: ${input.source} is ${dimensions.width}x${dimensions.height}${afterCrop} ` +
        `(${input.mime}); max supported dimension is ${maxDimension}px. ` +
        "Use a viewport screenshot, scroll slice, region crop, or coordinate atlas instead of sending the full image.",
    })
  }

  const note = crop
    ? `[model-image-input] Cropped blank margins for ${input.source}: original ${crop.originalWidth}x${crop.originalHeight}, model input ${crop.width}x${crop.height}. Original attachment remains unchanged.`
    : undefined
  return {
    mime: input.mime,
    bytes,
    dimensions,
    ...(crop ? { crop } : {}),
    ...(note ? { note } : {}),
  }
}

async function cropBlankMargins(input: {
  mime: string
  bytes: Buffer
  originalDimensions: ImageDimensions
}): Promise<{ bytes: Buffer; crop: ModelImageBlankMarginCrop } | undefined> {
  const encoder = encoderForMime(input.mime)
  if (!encoder) return undefined
  const { data, info } = await encoder(
    sharp(input.bytes, { failOn: "error" }).trim({ threshold: BLANK_MARGIN_CROP_THRESHOLD }),
  ).toBuffer({ resolveWithObject: true })
  if (info.width <= 0 || info.height <= 0) return undefined
  if (info.width === input.originalDimensions.width && info.height === input.originalDimensions.height) return undefined
  return {
    bytes: data,
    crop: {
      originalWidth: input.originalDimensions.width,
      originalHeight: input.originalDimensions.height,
      width: info.width,
      height: info.height,
      ...(typeof info.trimOffsetLeft === "number" ? { trimOffsetLeft: info.trimOffsetLeft } : {}),
      ...(typeof info.trimOffsetTop === "number" ? { trimOffsetTop: info.trimOffsetTop } : {}),
    },
  }
}

type SharpPipeline = ReturnType<typeof sharp>

function encoderForMime(mime: string): ((image: SharpPipeline) => SharpPipeline) | undefined {
  const normalized = mime.toLowerCase().split(";")[0]?.trim()
  switch (normalized) {
    case "image/png":
      return (image) => image.png()
    case "image/jpeg":
    case "image/jpg":
      return (image) => image.jpeg()
    case "image/webp":
      return (image) => image.webp()
    default:
      return undefined
  }
}

function readPngDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 24) return undefined
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined
  if (bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return undefined
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width <= 0 || height <= 0) return undefined
  return { format: "png", width, height }
}

function readJpegDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined
    const marker = bytes[offset + 1]
    offset += 2
    if (marker === undefined) return undefined
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > bytes.length) return undefined
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return undefined
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      if (width <= 0 || height <= 0) return undefined
      return { format: "jpeg", width, height }
    }
    offset += segmentLength
  }
  return undefined
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  )
}

function readWebpDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 16) return undefined
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    return undefined
  }
  const chunk = bytes.subarray(12, 16).toString("ascii")
  if (chunk === "VP8X") {
    if (bytes.length < 30) return undefined
    const width = 1 + bytes.readUIntLE(24, 3)
    const height = 1 + bytes.readUIntLE(27, 3)
    return { format: "webp", width, height }
  }
  if (chunk === "VP8 ") {
    if (bytes.length < 30) return undefined
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined
    const width = bytes.readUInt16LE(26) & 0x3fff
    const height = bytes.readUInt16LE(28) & 0x3fff
    if (width <= 0 || height <= 0) return undefined
    return { format: "webp", width, height }
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return undefined
    const b0 = bytes[21]
    const b1 = bytes[22]
    const b2 = bytes[23]
    const b3 = bytes[24]
    const width = 1 + (((b1 & 0x3f) << 8) | b0)
    const height = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10))
    return { format: "webp", width, height }
  }
  return undefined
}
