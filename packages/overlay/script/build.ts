#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repo = path.resolve(dir, "../..")
const opencorvus = path.resolve(repo, "packages/opencorvus")
const tauri = path.resolve(dir, "src-tauri")
const resources = path.join(tauri, "resources")

const serverFile =
  process.platform === "win32"
    ? "opencorvus.exe"
    : "opencorvus"

const distName = [
  "opencorvus",
  process.platform === "win32" ? "windows" : process.platform,
  process.arch,
].join("-")

const distServer = path.join(opencorvus, "dist", distName, "bin", serverFile)
const stagedServer = path.join(resources, serverFile)
const releaseServer = path.join(tauri, "target", "release", serverFile)

await $`bun run build`.cwd(opencorvus)

const exists = await fs.stat(distServer).catch(() => undefined)
if (!exists) {
  throw new Error(`Bundled opencorvus binary not found at ${distServer}`)
}

await fs.mkdir(resources, { recursive: true })
await fs.copyFile(distServer, stagedServer)

await $`tauri build`.cwd(dir)

await fs.copyFile(stagedServer, releaseServer).catch(() => undefined)
