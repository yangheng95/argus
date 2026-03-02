import sharp from "sharp"

/**
 * Draw a coordinate grid overlay on a screenshot PNG buffer.
 *
 * Design goals:
 * 1. Interior reference labels every ~200px so the LLM has nearby anchors
 *    (not just distant edge labels that require tracing across the screen).
 * 2. Dense minor grid (every 50px) for fine-grained positioning.
 * 3. Grid visible enough to follow but not so opaque it obscures UI.
 * 4. Labels on ALL four edges (top, left, bottom, right) so the LLM can
 *    cross-reference from any direction.
 */
export async function addCoordinateOverlay(
  pngBuffer: Buffer,
  opts?: { step?: number; labelStep?: number },
): Promise<Buffer> {
  const meta = await sharp(pngBuffer).metadata()
  const width = meta.width!
  const height = meta.height!

  const maxDim = Math.max(width, height)

  // Minor grid: every 50px (fine positioning)
  const minorStep = opts?.step ?? Math.max(50, Math.round(maxDim / 80 / 25) * 25)
  // Major grid: every 200px (labeled intersections inside the image)
  const majorStep = opts?.labelStep ?? Math.max(200, Math.round(maxDim / 20 / 100) * 100)

  // Scale font/stroke for high-DPI — 4K images get downscaled by vision models
  const isHighDpi = maxDim > 2500
  const fontSize = isHighDpi ? 16 : 11
  const charW = isHighDpi ? 10 : 7
  const labelH = isHighDpi ? 20 : 14
  const minorStrokeW = isHighDpi ? 0.8 : 0.5
  const majorStrokeW = isHighDpi ? 1.5 : 1
  const minorColor = "rgba(255,0,0,0.08)"    // very faint minor grid
  const majorColor = "rgba(255,0,0,0.18)"    // visible major grid
  const tickColor = "rgba(255,0,0,0.40)"     // edge ticks clearly visible
  const bgColor = "rgba(0,0,0,0.35)"         // label background — more contrast
  const textColor = "rgba(255,255,255,0.85)"  // brighter text for readability
  const tickLen = isHighDpi ? 18 : 12
  const tickStrokeW = isHighDpi ? 2 : 1.5
  // Interior label style
  const interiorFontSize = isHighDpi ? 13 : 9
  const interiorCharW = isHighDpi ? 8 : 6
  const interiorLabelH = isHighDpi ? 16 : 12
  const interiorBg = "rgba(0,0,0,0.45)"
  const interiorText = "rgba(255,255,0,0.85)"  // yellow for interior labels (distinct from edge)

  const svgParts: string[] = []

  // ── Vertical lines ──
  for (let x = minorStep; x < width; x += minorStep) {
    const isMajor = x % majorStep === 0
    const color = isMajor ? majorColor : minorColor
    const sw = isMajor ? majorStrokeW : minorStrokeW

    // Full-height grid line
    svgParts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${color}" stroke-width="${sw}"/>`)

    // Top and bottom tick marks
    svgParts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${tickLen}" stroke="${tickColor}" stroke-width="${tickStrokeW}"/>`)
    svgParts.push(`<line x1="${x}" y1="${height}" x2="${x}" y2="${height - tickLen}" stroke="${tickColor}" stroke-width="${tickStrokeW}"/>`)

    // Top edge label (every minor step)
    const labelW = String(x).length * charW + 4
    svgParts.push(`<rect x="${x - labelW / 2}" y="${tickLen}" width="${labelW}" height="${labelH}" fill="${bgColor}" rx="2"/>`)
    svgParts.push(`<text x="${x}" y="${tickLen + labelH - 3}" font-size="${fontSize}" fill="${textColor}" text-anchor="middle" font-family="monospace">${x}</text>`)

    // Bottom edge label (every major step to reduce clutter)
    if (isMajor) {
      svgParts.push(`<rect x="${x - labelW / 2}" y="${height - tickLen - labelH}" width="${labelW}" height="${labelH}" fill="${bgColor}" rx="2"/>`)
      svgParts.push(`<text x="${x}" y="${height - tickLen - 3}" font-size="${fontSize}" fill="${textColor}" text-anchor="middle" font-family="monospace">${x}</text>`)
    }
  }

  // ── Horizontal lines ──
  for (let y = minorStep; y < height; y += minorStep) {
    const isMajor = y % majorStep === 0
    const color = isMajor ? majorColor : minorColor
    const sw = isMajor ? majorStrokeW : minorStrokeW

    // Full-width grid line
    svgParts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${color}" stroke-width="${sw}"/>`)

    // Left and right tick marks
    svgParts.push(`<line x1="0" y1="${y}" x2="${tickLen}" y2="${y}" stroke="${tickColor}" stroke-width="${tickStrokeW}"/>`)
    svgParts.push(`<line x1="${width}" y1="${y}" x2="${width - tickLen}" y2="${y}" stroke="${tickColor}" stroke-width="${tickStrokeW}"/>`)

    // Left edge label (every minor step)
    const labelW = String(y).length * charW + 4
    svgParts.push(`<rect x="${tickLen}" y="${y - labelH / 2}" width="${labelW}" height="${labelH}" fill="${bgColor}" rx="2"/>`)
    svgParts.push(`<text x="${tickLen + 2}" y="${y + fontSize / 3}" font-size="${fontSize}" fill="${textColor}" font-family="monospace">${y}</text>`)

    // Right edge label (every major step)
    if (isMajor) {
      svgParts.push(`<rect x="${width - tickLen - labelW}" y="${y - labelH / 2}" width="${labelW}" height="${labelH}" fill="${bgColor}" rx="2"/>`)
      svgParts.push(`<text x="${width - tickLen - labelW + 2}" y="${y + fontSize / 3}" font-size="${fontSize}" fill="${textColor}" font-family="monospace">${y}</text>`)
    }
  }

  // ── Interior intersection labels (every majorStep × majorStep) ──
  // These give the LLM nearby reference points inside the image,
  // avoiding the need to trace all the way to the edge.
  for (let x = majorStep; x < width; x += majorStep) {
    for (let y = majorStep; y < height; y += majorStep) {
      const label = `${x},${y}`
      const lw = label.length * interiorCharW + 4
      // Position label slightly offset from intersection to avoid overlap with grid
      svgParts.push(`<rect x="${x + 3}" y="${y - interiorLabelH - 1}" width="${lw}" height="${interiorLabelH}" fill="${interiorBg}" rx="2"/>`)
      svgParts.push(`<text x="${x + 5}" y="${y - 3}" font-size="${interiorFontSize}" fill="${interiorText}" font-family="monospace">${label}</text>`)
    }
  }

  // ── Origin label ──
  const originW = isHighDpi ? 28 : 20
  svgParts.push(`<rect x="0" y="0" width="${originW}" height="${labelH}" fill="${bgColor}" rx="2"/>`)
  svgParts.push(`<text x="2" y="${labelH - 3}" font-size="${fontSize}" fill="${textColor}" font-family="monospace">0,0</text>`)

  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgParts.join("")}</svg>`,
  )

  return sharp(pngBuffer)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer()
}

export const Overlay = {
  add: addCoordinateOverlay,
}
