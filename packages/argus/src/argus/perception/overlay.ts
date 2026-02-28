import sharp from "sharp"

/**
 * Draw a coordinate grid overlay on a screenshot PNG buffer.
 * Adds tick marks and labels along the edges so vision LLMs can
 * map pixel positions to coordinates precisely.
 *
 * - Tick marks every `step` pixels along each edge
 * - Labels every `labelStep` pixels
 * - Semi-transparent background behind labels for readability
 */
export async function addCoordinateOverlay(
  pngBuffer: Buffer,
  opts?: { step?: number; labelStep?: number },
): Promise<Buffer> {
  const meta = await sharp(pngBuffer).metadata()
  const width = meta.width!
  const height = meta.height!

  // Scale step to image size — aim for ~20 ticks across the image
  const step = opts?.step ?? Math.max(50, Math.round(Math.max(width, height) / 20 / 50) * 50)
  const labelStep = opts?.labelStep ?? step * 2

  const tickLen = 12
  const fontSize = 14
  const color = "rgba(255,0,0,0.7)"
  const bgColor = "rgba(0,0,0,0.5)"

  const svgParts: string[] = []

  // Top edge ticks + labels
  for (let x = step; x < width; x += step) {
    svgParts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${tickLen}" stroke="${color}" stroke-width="1.5"/>`)
    if (x % labelStep === 0) {
      svgParts.push(`<rect x="${x - 16}" y="${tickLen}" width="32" height="16" fill="${bgColor}" rx="2"/>`)
      svgParts.push(`<text x="${x}" y="${tickLen + 13}" font-size="${fontSize}" fill="white" text-anchor="middle" font-family="monospace">${x}</text>`)
    }
  }

  // Left edge ticks + labels
  for (let y = step; y < height; y += step) {
    svgParts.push(`<line x1="0" y1="${y}" x2="${tickLen}" y2="${y}" stroke="${color}" stroke-width="1.5"/>`)
    if (y % labelStep === 0) {
      const labelW = String(y).length * 9 + 4
      svgParts.push(`<rect x="${tickLen}" y="${y - 8}" width="${labelW}" height="16" fill="${bgColor}" rx="2"/>`)
      svgParts.push(`<text x="${tickLen + 2}" y="${y + 5}" font-size="${fontSize}" fill="white" font-family="monospace">${y}</text>`)
    }
  }

  // Bottom edge ticks + labels
  for (let x = step; x < width; x += step) {
    svgParts.push(`<line x1="${x}" y1="${height}" x2="${x}" y2="${height - tickLen}" stroke="${color}" stroke-width="1.5"/>`)
    if (x % labelStep === 0) {
      svgParts.push(`<rect x="${x - 16}" y="${height - tickLen - 16}" width="32" height="16" fill="${bgColor}" rx="2"/>`)
      svgParts.push(`<text x="${x}" y="${height - tickLen - 3}" font-size="${fontSize}" fill="white" text-anchor="middle" font-family="monospace">${x}</text>`)
    }
  }

  // Right edge ticks + labels
  for (let y = step; y < height; y += step) {
    svgParts.push(`<line x1="${width}" y1="${y}" x2="${width - tickLen}" y2="${y}" stroke="${color}" stroke-width="1.5"/>`)
    if (y % labelStep === 0) {
      const labelW = String(y).length * 9 + 4
      svgParts.push(`<rect x="${width - tickLen - labelW}" y="${y - 8}" width="${labelW}" height="16" fill="${bgColor}" rx="2"/>`)
      svgParts.push(`<text x="${width - tickLen - 2}" y="${y + 5}" font-size="${fontSize}" fill="white" text-anchor="end" font-family="monospace">${y}</text>`)
    }
  }

  // Origin label
  svgParts.push(`<rect x="0" y="0" width="24" height="16" fill="${bgColor}" rx="2"/>`)
  svgParts.push(`<text x="2" y="13" font-size="${fontSize}" fill="white" font-family="monospace">0,0</text>`)

  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgParts.join("")}</svg>`,
  )

  return sharp(pngBuffer)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer()
}
