#!/usr/bin/env bun

import sharp from "sharp"
import { mkdir, readFile, writeFile } from "fs/promises"
import { resolve } from "path"

const ROOT = resolve(import.meta.dir, "..")
const BRAND = `${ROOT}/packages/console/app/src/asset/brand`
const LANDER = `${ROOT}/packages/console/app/src/asset/lander`
const PUBLIC = `${ROOT}/packages/console/app/public`
const LIGHT_BG = "#F8F7F6"
const DARK_BG = "#0D0B0B"

const toBuffer = async (path: string, width: number, height: number, background: string) =>
  sharp(path).resize(width, height, { fit: "contain", background }).png().toBuffer()

const toPreview = async (path: string, background: string) => {
  const content = await sharp(path)
    .trim()
    .resize(1800, 900, { fit: "inside" })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: 2400,
      height: 1350,
      channels: 4,
      background,
    },
  })
    .composite([{ input: content, gravity: "center" }])
    .png()
    .toBuffer()
}

const toSvg = async (path: string, width: number, height: number) => {
  const png = await sharp(path).resize(width, height, { fit: "contain" }).png().toBuffer()
  const b64 = png.toString("base64")
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <image href="data:image/png;base64,${b64}" width="${width}" height="${height}"/>
</svg>
`
}

const write = (path: string, data: Buffer | string) => writeFile(path, data)

async function main() {
  await mkdir(BRAND, { recursive: true })
  await mkdir(LANDER, { recursive: true })
  await mkdir(PUBLIC, { recursive: true })

  const logoLight = `${BRAND}/opencorvus-logo-light.png`
  const logoDark = `${BRAND}/opencorvus-logo-dark.png`
  const wordmarkLight = `${BRAND}/opencorvus-wordmark-light.png`
  const wordmarkDark = `${BRAND}/opencorvus-wordmark-dark.png`

  await write(`${BRAND}/opencorvus-logo-light-square.png`, await toBuffer(logoLight, 600, 600, LIGHT_BG))
  await write(`${BRAND}/opencorvus-logo-dark-square.png`, await toBuffer(logoDark, 600, 600, DARK_BG))
  await write(`${BRAND}/opencorvus-logo-light.png`, await toBuffer(logoLight, 480, 600, LIGHT_BG))
  await write(`${BRAND}/opencorvus-logo-dark.png`, await toBuffer(logoDark, 480, 600, DARK_BG))
  await write(`${BRAND}/opencorvus-wordmark-light.png`, await toBuffer(wordmarkLight, 1280, 230, LIGHT_BG))
  await write(`${BRAND}/opencorvus-wordmark-dark.png`, await toBuffer(wordmarkDark, 1282, 230, DARK_BG))
  await write(`${BRAND}/opencorvus-wordmark-simple-light.png`, await readFile(`${BRAND}/opencorvus-wordmark-light.png`))
  await write(`${BRAND}/opencorvus-wordmark-simple-dark.png`, await readFile(`${BRAND}/opencorvus-wordmark-dark.png`))

  await write(`${BRAND}/preview-opencorvus-logo-light.png`, await toPreview(`${BRAND}/opencorvus-logo-light.png`, LIGHT_BG))
  await write(`${BRAND}/preview-opencorvus-logo-dark.png`, await toPreview(`${BRAND}/opencorvus-logo-dark.png`, DARK_BG))
  await write(
    `${BRAND}/preview-opencorvus-logo-light-square.png`,
    await toPreview(`${BRAND}/opencorvus-logo-light-square.png`, LIGHT_BG),
  )
  await write(
    `${BRAND}/preview-opencorvus-logo-dark-square.png`,
    await toPreview(`${BRAND}/opencorvus-logo-dark-square.png`, DARK_BG),
  )
  await write(
    `${BRAND}/preview-opencorvus-wordmark-light.png`,
    await toPreview(`${BRAND}/opencorvus-wordmark-light.png`, LIGHT_BG),
  )
  await write(
    `${BRAND}/preview-opencorvus-wordmark-dark.png`,
    await toPreview(`${BRAND}/opencorvus-wordmark-dark.png`, DARK_BG),
  )
  await write(
    `${BRAND}/preview-opencorvus-wordmark-simple-light.png`,
    await toPreview(`${BRAND}/opencorvus-wordmark-simple-light.png`, LIGHT_BG),
  )
  await write(
    `${BRAND}/preview-opencorvus-wordmark-simple-dark.png`,
    await toPreview(`${BRAND}/opencorvus-wordmark-simple-dark.png`, DARK_BG),
  )

  await write(`${BRAND}/opencorvus-logo-light.svg`, await toSvg(`${BRAND}/opencorvus-logo-light.png`, 240, 300))
  await write(`${BRAND}/opencorvus-logo-dark.svg`, await toSvg(`${BRAND}/opencorvus-logo-dark.png`, 240, 300))
  await write(`${BRAND}/opencorvus-logo-light-square.svg`, await toSvg(`${BRAND}/opencorvus-logo-light-square.png`, 300, 300))
  await write(`${BRAND}/opencorvus-logo-dark-square.svg`, await toSvg(`${BRAND}/opencorvus-logo-dark-square.png`, 300, 300))
  await write(`${BRAND}/opencorvus-wordmark-light.svg`, await toSvg(`${BRAND}/opencorvus-wordmark-light.png`, 640, 115))
  await write(`${BRAND}/opencorvus-wordmark-dark.svg`, await toSvg(`${BRAND}/opencorvus-wordmark-dark.png`, 640, 115))
  await write(
    `${BRAND}/opencorvus-wordmark-simple-light.svg`,
    await toSvg(`${BRAND}/opencorvus-wordmark-simple-light.png`, 640, 115),
  )
  await write(
    `${BRAND}/opencorvus-wordmark-simple-dark.svg`,
    await toSvg(`${BRAND}/opencorvus-wordmark-simple-dark.png`, 640, 115),
  )

  await write(`${LANDER}/opencorvus-logo-light.svg`, await toSvg(`${BRAND}/opencorvus-logo-light.png`, 32, 40))
  await write(`${LANDER}/opencorvus-logo-dark.svg`, await toSvg(`${BRAND}/opencorvus-logo-dark.png`, 32, 40))
  await write(`${LANDER}/opencorvus-wordmark-light.svg`, await toSvg(`${BRAND}/opencorvus-wordmark-light.png`, 234, 42))
  await write(`${LANDER}/opencorvus-wordmark-dark.svg`, await toSvg(`${BRAND}/opencorvus-wordmark-dark.png`, 234, 42))

  console.log("synced opencorvus brand assets")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
