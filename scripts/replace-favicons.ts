#!/usr/bin/env bun
/**
 * replace-favicons.ts
 * Resizes mascot-ar-icon.png into all required favicon sizes and writes them
 * to both packages/console/app/public/ and packages/web/public/.
 */

import sharp from "sharp"
import { readFileSync, writeFileSync } from "fs"
import { resolve } from "path"

const ROOT = resolve(import.meta.dir, "..")
const SRC = `${ROOT}/packages/console/app/src/asset/brand/mascot-ar-icon.png`

const PUBLIC_DIRS = [
  `${ROOT}/packages/console/app/public`,
  `${ROOT}/packages/web/public`,
]

interface IconSpec {
  filename: string
  size: number
}

const SPECS: IconSpec[] = [
  { filename: "favicon-96x96.png",          size: 96  },
  { filename: "favicon-96x96-v3.png",       size: 96  },
  { filename: "apple-touch-icon.png",        size: 180 },
  { filename: "apple-touch-icon-v3.png",     size: 180 },
  { filename: "web-app-manifest-192x192.png", size: 192 },
  { filename: "web-app-manifest-512x512.png", size: 512 },
]

async function main() {
  console.log(`Source: ${SRC}`)

  // Generate each PNG size
  const buffers = new Map<number, Buffer>()
  for (const spec of SPECS) {
    if (!buffers.has(spec.size)) {
      const buf = await sharp(SRC)
        .resize(spec.size, spec.size, { fit: "contain", background: { r: 13, g: 11, b: 11, alpha: 1 } })
        .png()
        .toBuffer()
      buffers.set(spec.size, buf)
    }
  }

  // Write PNG files
  for (const dir of PUBLIC_DIRS) {
    for (const spec of SPECS) {
      const out = `${dir}/${spec.filename}`
      writeFileSync(out, buffers.get(spec.size)!)
      console.log(`✓ ${out} (${spec.size}px)`)
    }
  }

  // Write SVG wrapper (embeds 96px PNG as base64 — works in all browsers)
  const svg96 = buffers.get(96)!
  const b64 = svg96.toString("base64")
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <image href="data:image/png;base64,${b64}" width="96" height="96"/>
</svg>`

  for (const dir of PUBLIC_DIRS) {
    for (const name of ["favicon.svg", "favicon-v3.svg"]) {
      const out = `${dir}/${name}`
      writeFileSync(out, svgContent)
      console.log(`✓ ${out} (SVG wrapper)`)
    }
  }

  // Write ICO (multi-resolution: 16, 32, 48px packed into ICO format)
  const icoBuffer = await buildIco([16, 32, 48], SRC)
  for (const dir of PUBLIC_DIRS) {
    for (const name of ["favicon.ico", "favicon-v3.ico"]) {
      const out = `${dir}/${name}`
      writeFileSync(out, icoBuffer)
      console.log(`✓ ${out} (ICO 16/32/48px)`)
    }
  }

  console.log("\nDone!")
}

/**
 * Build a minimal .ico file containing multiple PNG sizes.
 * ICO format: ICONDIR header + ICONDIRENTRY[] + raw PNG data blobs.
 */
async function buildIco(sizes: number[], src: string): Promise<Buffer> {
  const pngs: Buffer[] = []
  for (const s of sizes) {
    const buf = await sharp(src)
      .resize(s, s, { fit: "contain", background: { r: 13, g: 11, b: 11, alpha: 1 } })
      .png()
      .toBuffer()
    pngs.push(buf)
  }

  const count = pngs.length
  // ICONDIR: 6 bytes
  // ICONDIRENTRY: 16 bytes each
  // then image data
  const headerSize = 6 + 16 * count
  let offset = headerSize

  const header = Buffer.alloc(headerSize)
  // ICONDIR
  header.writeUInt16LE(0, 0)      // reserved
  header.writeUInt16LE(1, 2)      // type = 1 (icon)
  header.writeUInt16LE(count, 4)  // count

  for (let i = 0; i < count; i++) {
    const size = sizes[i]
    const png = pngs[i]
    const entry = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, entry)      // width (0 = 256)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)  // height
    header.writeUInt8(0, entry + 2)   // color count
    header.writeUInt8(0, entry + 3)   // reserved
    header.writeUInt16LE(1, entry + 4) // planes
    header.writeUInt16LE(32, entry + 6) // bit count
    header.writeUInt32LE(png.length, entry + 8)  // size of image data
    header.writeUInt32LE(offset, entry + 12)     // offset of image data
    offset += png.length
  }

  return Buffer.concat([header, ...pngs])
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
