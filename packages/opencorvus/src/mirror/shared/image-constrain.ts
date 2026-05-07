/**
 * Image dimension constraint utility.
 * Ported from mirror/src/infra/image-constrain.ts.
 *
 * Ensures images sent to LLM APIs don't exceed provider dimension limits
 * (Bedrock 8000, Claude, OpenAI). PNG is decoded+resized+re-encoded via
 * pngjs; JPEG/WebP are probed for dimensions only (bilinear resize of
 * compressed formats is out of scope here — callers should pre-convert).
 */

import { PNG } from "pngjs"
import { Log } from "@/util/log"

const log = Log.create({ service: "mirror.image-constrain" })

/** Safe default — covers Bedrock (8000), Claude API, OpenAI. */
export const DEFAULT_MAX_DIMENSION = 4096

/** Bilinear interpolation resize — keeps text/fine UI details readable. */
function resizePng(src: PNG, tw: number, th: number): PNG {
  const dst = new PNG({ width: tw, height: th })
  const xr = src.width / tw
  const yr = src.height / th
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const sx = x * xr
      const sy = y * yr
      const x0 = Math.min(Math.floor(sx), src.width - 1)
      const y0 = Math.min(Math.floor(sy), src.height - 1)
      const x1 = Math.min(x0 + 1, src.width - 1)
      const y1 = Math.min(y0 + 1, src.height - 1)
      const fx = sx - x0
      const fy = sy - y0

      const si00 = (y0 * src.width + x0) * 4
      const si10 = (y0 * src.width + x1) * 4
      const si01 = (y1 * src.width + x0) * 4
      const si11 = (y1 * src.width + x1) * 4
      const di = (y * tw + x) * 4

      for (let c = 0; c < 4; c++) {
        const top = src.data[si00 + c] * (1 - fx) + src.data[si10 + c] * fx
        const bottom = src.data[si01 + c] * (1 - fx) + src.data[si11 + c] * fx
        dst.data[di + c] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return dst
}

async function resolveToBuffer(url: string): Promise<Buffer | null> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",")
    if (comma === -1) return null
    return Buffer.from(url.slice(comma + 1), "base64")
  }
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

/** Fast dimension probe without full decode (PNG IHDR / JPEG SOF0/SOF2). */
export function probeImageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) break
      const marker = buf[offset + 1]
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buf.readUInt16BE(offset + 5)
        const width = buf.readUInt16BE(offset + 7)
        return { width, height }
      }
      const segLen = buf.readUInt16BE(offset + 2)
      offset += 2 + segLen
    }
  }
  return null
}

/**
 * Constrain a single image (URL or `data:` URI) to `maxDim` pixels per side.
 * Returns the original URL when the image already fits or cannot be decoded.
 *
 * Decode paths:
 *   - PNG: full decode + bilinear resize + re-encode (emits data URL)
 *   - JPEG/WebP: dimension probe + warning (caller must pre-convert)
 */
export async function constrainImage(url: string, maxDim: number = DEFAULT_MAX_DIMENSION): Promise<string> {
  const buf = await resolveToBuffer(url)
  if (!buf) return url

  try {
    const png = PNG.sync.read(buf)
    if (png.width <= maxDim && png.height <= maxDim) return url
    const scale = Math.min(maxDim / png.width, maxDim / png.height)
    const tw = Math.round(png.width * scale)
    const th = Math.round(png.height * scale)
    const resized = resizePng(png, tw, th)
    const encoded = PNG.sync.write(resized)
    return `data:image/png;base64,${encoded.toString("base64")}`
  } catch {
    // fall through to non-PNG probe
  }

  const dims = probeImageDimensions(buf)
  if (dims && (dims.width > maxDim || dims.height > maxDim)) {
    log.warn("non-PNG image exceeds dimension cap — provider may reject", {
      width: dims.width,
      height: dims.height,
      maxDim,
    })
  }

  return url
}

/** Constrain every URL in parallel. */
export async function constrainImages(urls: string[], maxDim: number = DEFAULT_MAX_DIMENSION): Promise<string[]> {
  return Promise.all(urls.map((u) => constrainImage(u, maxDim)))
}
