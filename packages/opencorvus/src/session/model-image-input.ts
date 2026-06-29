import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { requireRuntimePackage } from "@/runtime/package-require"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")

export const MAX_MODEL_IMAGE_INPUT_DIMENSION = 8000
export const MODEL_IMAGE_INPUT_PIXEL_BUDGET = 1_048_576
export const MODEL_IMAGE_INPUT_COMPRESSION_WARNING_RATIO = 2
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

export interface ModelImageResize {
  inputWidth: number
  inputHeight: number
  width: number
  height: number
  scale: number
  maxDimension: number
  maxPixels: number
}

export interface PreparedModelImageInput {
  mime: string
  bytes: Buffer
  dimensions?: ImageDimensions
  crop?: ModelImageBlankMarginCrop
  resize?: ModelImageResize
  note?: string
}

export const modelImagePixelSummarySchema = z.object({
  currentPixels: z.number(),
  compressedPixels: z.number(),
  compressedWidth: z.number(),
  compressedHeight: z.number(),
  compressionRatio: z.number(),
  preferPartialScreenshot: z.boolean(),
  text: z.string(),
})

export type ModelImagePixelSummary = z.infer<typeof modelImagePixelSummarySchema>

export const ModelImageInputTooLargeError = NamedError.create(
  "ModelImageInputTooLargeError",
  z.object({
    message: z.string(),
    mime: z.string(),
    source: z.string(),
    width: z.number(),
    height: z.number(),
    pixels: z.number().optional(),
    maxDimension: z.number(),
    maxPixels: z.number().optional(),
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

export const modelImagePixelSummary = (
  width: number,
  height: number,
  maxPixels = MODEL_IMAGE_INPUT_PIXEL_BUDGET,
): ModelImagePixelSummary => {
  const currentPixels = width * height
  const target = modelImageInputTargetDimensions({ width, height, maxPixels })
  const compressedWidth = target.width
  const compressedHeight = target.height
  const compressedPixels = compressedWidth * compressedHeight
  const compressionRatio =
    compressedWidth > 0 && compressedHeight > 0
      ? Number(Math.max(width / compressedWidth, height / compressedHeight).toFixed(2))
      : 1
  const preferPartialScreenshot = compressionRatio >= MODEL_IMAGE_INPUT_COMPRESSION_WARNING_RATIO
  return {
    currentPixels,
    compressedPixels,
    compressedWidth,
    compressedHeight,
    compressionRatio,
    preferPartialScreenshot,
    text:
      `当前像素: ${currentPixels} (${width}x${height}); 压缩后像素: ${compressedPixels} (${compressedWidth}x${compressedHeight}); ` +
      `压缩率: ${compressionRatio.toFixed(2)}x` +
      (preferPartialScreenshot ? "; 压缩率过大，请优先使用 selector 或 clip 做局部截图。" : ""),
  }
}

export function assertModelImageInputWithinLimits(input: {
  mime: string
  bytes: Buffer
  source: string
  maxDimension?: number
  maxPixels?: number
}): void {
  if (!input.mime.toLowerCase().startsWith("image/")) return
  const dimensions = readModelImageDimensions(input.bytes)
  if (!dimensions) return
  const maxDimension = input.maxDimension ?? MAX_MODEL_IMAGE_INPUT_DIMENSION
  const maxPixels = input.maxPixels ?? MODEL_IMAGE_INPUT_PIXEL_BUDGET
  const pixels = dimensions.width * dimensions.height
  if (dimensions.width <= maxDimension && dimensions.height <= maxDimension && pixels <= maxPixels) return
  throw new ModelImageInputTooLargeError({
    mime: input.mime,
    source: input.source,
    width: dimensions.width,
    height: dimensions.height,
    pixels,
    maxDimension,
    maxPixels,
    message:
      `Model image input too large: ${input.source} is ${dimensions.width}x${dimensions.height} ` +
      `(${pixels} pixels, ${input.mime}); max supported dimension is ${maxDimension}px and ` +
      `max model image pixels is ${maxPixels}.`,
  })
}

export async function prepareModelImageInput(input: {
  mime: string
  bytes: Buffer
  source: string
  maxDimension?: number
  maxPixels?: number
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
  let bytes = cropped?.bytes ?? input.bytes
  let dimensions = readModelImageDimensions(bytes) ?? originalDimensions
  const crop = cropped?.crop
  const maxDimension = input.maxDimension ?? MAX_MODEL_IMAGE_INPUT_DIMENSION
  const maxPixels = input.maxPixels ?? MODEL_IMAGE_INPUT_PIXEL_BUDGET
  const resized = await resizeForModelInputLimits({
    mime: input.mime,
    bytes,
    dimensions,
    source: input.source,
    maxDimension,
    maxPixels,
  })
  const resize = resized?.resize
  if (resized) {
    bytes = resized.bytes
    dimensions = resized.dimensions
  }
  const pixels = dimensions.width * dimensions.height
  if (dimensions.width > maxDimension || dimensions.height > maxDimension || pixels > maxPixels) {
    const afterCrop =
      crop && (crop.originalWidth !== dimensions.width || crop.originalHeight !== dimensions.height)
        ? ` after blank-margin crop from ${crop.originalWidth}x${crop.originalHeight}`
        : ""
    throw new ModelImageInputTooLargeError({
      mime: input.mime,
      source: input.source,
      width: dimensions.width,
      height: dimensions.height,
      pixels,
      maxDimension,
      maxPixels,
      originalWidth: crop?.originalWidth,
      originalHeight: crop?.originalHeight,
      blankMarginCrop: crop,
      message:
        `Model image input too large: ${input.source} is ${dimensions.width}x${dimensions.height}${afterCrop} ` +
        `(${pixels} pixels, ${input.mime}); max supported dimension is ${maxDimension}px and ` +
        `max model image pixels is ${maxPixels}.`,
    })
  }

  const notes: string[] = []
  if (crop) {
    notes.push(
      `[model-image-input] Cropped blank margins for ${input.source}: original ${crop.originalWidth}x${crop.originalHeight}, model input ${crop.width}x${crop.height}. Original attachment remains unchanged.`,
    )
  }
  if (resize) {
    notes.push(
      `[model-image-input] Resized ${input.source} for model input: ${resize.inputWidth}x${resize.inputHeight} to ${resize.width}x${resize.height} (${resize.scale.toFixed(4)}x scale, max ${resize.maxDimension}px, pixel budget ${resize.maxPixels}). Original attachment remains unchanged.`,
    )
  }
  const note = notes.length > 0 ? notes.join("\n") : undefined
  return {
    mime: input.mime,
    bytes,
    dimensions,
    ...(crop ? { crop } : {}),
    ...(resize ? { resize } : {}),
    ...(note ? { note } : {}),
  }
}

export function modelImageInputTargetDimensions(input: {
  width: number
  height: number
  maxDimension?: number
  maxPixels?: number
}): { width: number; height: number; scale: number } {
  const maxDimension = input.maxDimension ?? MAX_MODEL_IMAGE_INPUT_DIMENSION
  const maxPixels = input.maxPixels ?? MODEL_IMAGE_INPUT_PIXEL_BUDGET
  const pixels = input.width * input.height
  const scale = Math.min(
    1,
    maxDimension / input.width,
    maxDimension / input.height,
    pixels > maxPixels ? Math.sqrt(maxPixels / pixels) : 1,
  )
  let width = Math.max(1, Math.round(input.width * scale))
  let height = Math.max(1, Math.round(input.height * scale))
  while (width > maxDimension) width--
  while (height > maxDimension) height--
  while (width * height > maxPixels && (width > 1 || height > 1)) {
    if (width / input.width >= height / input.height && width > 1) {
      width--
    } else {
      height--
    }
  }
  return {
    width,
    height,
    scale,
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

async function resizeForModelInputLimits(input: {
  mime: string
  bytes: Buffer
  dimensions: ImageDimensions
  source: string
  maxDimension: number
  maxPixels: number
}): Promise<{ bytes: Buffer; dimensions: ImageDimensions; resize: ModelImageResize } | undefined> {
  const target = modelImageInputTargetDimensions({
    width: input.dimensions.width,
    height: input.dimensions.height,
    maxDimension: input.maxDimension,
    maxPixels: input.maxPixels,
  })
  if (target.width === input.dimensions.width && target.height === input.dimensions.height) return undefined
  const encoder = encoderForMime(input.mime)
  if (!encoder) {
    throw new ModelImageInputTooLargeError({
      mime: input.mime,
      source: input.source,
      width: input.dimensions.width,
      height: input.dimensions.height,
      pixels: input.dimensions.width * input.dimensions.height,
      maxDimension: input.maxDimension,
      maxPixels: input.maxPixels,
      message:
        `Model image input too large: ${input.dimensions.width}x${input.dimensions.height} ` +
        `(${input.dimensions.width * input.dimensions.height} pixels, ${input.mime}); encoder unavailable for resize.`,
    })
  }
  const { data, info } = await encoder(
    sharp(input.bytes, { failOn: "error" }).resize({
      width: target.width,
      height: target.height,
      fit: "inside",
      withoutEnlargement: true,
    }),
  ).toBuffer({ resolveWithObject: true })
  const dimensions = readModelImageDimensions(data) ?? {
    format: input.dimensions.format,
    width: info.width,
    height: info.height,
  }
  return {
    bytes: data,
    dimensions,
    resize: {
      inputWidth: input.dimensions.width,
      inputHeight: input.dimensions.height,
      width: dimensions.width,
      height: dimensions.height,
      scale: Math.min(dimensions.width / input.dimensions.width, dimensions.height / input.dimensions.height),
      maxDimension: input.maxDimension,
      maxPixels: input.maxPixels,
    },
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
