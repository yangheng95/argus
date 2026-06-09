#!/usr/bin/env bun

import path from "path"

const root = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const check = args.includes("--check")
const input = args.find((item) => item !== "--check")
const pattern = /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/

function normalize(input?: string) {
  const value = input?.trim()
  if (!value) return value
  const version = value.replace(/^v(?=\d)/, "")
  if (!pattern.test(version)) {
    throw new Error(`Invalid version: ${value}. Use x.y.z, x.y.z-tag, vx.y.z, or vx.y.z-tag.`)
  }
  return version
}

const files = {
  opencorvus: path.join(root, "packages/opencorvus/package.json"),
  overlayPkg: path.join(root, "packages/overlay/package.json"),
  overlayCargo: path.join(root, "packages/overlay/src-tauri/Cargo.toml"),
  overlayTauri: path.join(root, "packages/overlay/src-tauri/tauri.conf.json"),
}

const opencorvusPkg = (await Bun.file(files.opencorvus).json()) as { version: string }
const version = normalize(input || opencorvusPkg.version)

const overlayPkg = (await Bun.file(files.overlayPkg).json()) as Record<string, unknown>
const tauriJson = (await Bun.file(files.overlayTauri).json()) as Record<string, unknown>
const cargo = await Bun.file(files.overlayCargo).text()

const drift = [
  ["packages/opencorvus/package.json", opencorvusPkg.version],
  ["packages/overlay/package.json", String(overlayPkg.version ?? "")],
  ["packages/overlay/src-tauri/tauri.conf.json", String(tauriJson.version ?? "")],
  ["packages/overlay/src-tauri/Cargo.toml", cargo.match(/^version = "([^"]+)"/m)?.[1] ?? ""],
].filter(([, current]) => current !== version)

if (check) {
  if (drift.length > 0) {
    throw new Error(
      [`Version drift detected. Expected ${version}.`, ...drift.map(([file, current]) => `- ${file}: ${current}`)].join(
        "\n",
      ),
    )
  }
  console.log(`Versions aligned at ${version}`)
  process.exit(0)
}

opencorvusPkg.version = version
overlayPkg.version = version
tauriJson.version = version

await Bun.write(files.opencorvus, JSON.stringify(opencorvusPkg, null, 2) + "\n")
await Bun.write(files.overlayPkg, JSON.stringify(overlayPkg, null, 2) + "\n")
await Bun.write(files.overlayTauri, JSON.stringify(tauriJson, null, 2) + "\n")
await Bun.write(files.overlayCargo, cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`))

console.log(`Synchronized opencorvus + overlay versions to ${version}`)
