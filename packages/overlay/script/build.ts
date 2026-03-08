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
const target = path.join(tauri, "target")
const buildTarget = path.join(target, "bundle-build")
const buildRelease = path.join(buildTarget, "release")
const release = path.join(target, "release")

const serverFile = process.platform === "win32" ? "opencorvus.exe" : "opencorvus"
const overlayName = process.platform === "win32" ? "opencorvus-overlay.exe" : "opencorvus-overlay"

const distName = [
  "opencorvus",
  process.platform === "win32" ? "windows" : process.platform,
  process.arch,
].join("-")

const distServer = path.join(opencorvus, "dist", distName, "bin", serverFile)
const stagedServer = path.join(resources, serverFile)
const builtServer = path.join(buildRelease, serverFile)
const builtOverlay = path.join(buildRelease, overlayName)
const releaseServer = path.join(release, serverFile)
const releaseOverlay = path.join(release, overlayName)
const builtBundle = path.join(buildRelease, "bundle")
const releaseBundle = path.join(release, "bundle")

function text(error: unknown) {
  if (typeof error === "string") return error
  if (!(error instanceof Error)) return String(error)
  const stderr = Reflect.get(error, "stderr")
  return [error.message, typeof stderr === "string" ? stderr : ""].filter(Boolean).join("\n")
}

async function exists(file: string) {
  return Bun.file(file).exists()
}

async function copyFile(src: string, dest: string, options?: { required?: boolean; tolerateBusy?: boolean }) {
  if (!(await exists(src))) {
    if (options?.required) throw new Error(`Missing required file: ${src}`)
    return false
  }
  await fs.mkdir(path.dirname(dest), { recursive: true })
  try {
    await fs.copyFile(src, dest)
    return true
  } catch (error) {
    if (options?.tolerateBusy && process.platform === "win32") {
      console.warn(`overlay build: unable to copy ${src} -> ${dest}\n${text(error)}`)
      return false
    }
    throw error
  }
}

async function copyTree(src: string, dest: string) {
  if (!(await exists(src))) return false
  await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.cp(src, dest, { recursive: true, force: true })
  return true
}

await $`bun run build`.cwd(opencorvus)

if (!(await exists(distServer))) {
  throw new Error(`Bundled opencorvus binary not found at ${distServer}`)
}

await fs.mkdir(resources, { recursive: true })
await copyFile(distServer, stagedServer, { required: true })
await fs.rm(buildTarget, { recursive: true, force: true }).catch(() => undefined)

await $`tauri build`.cwd(dir).env({
  CARGO_TARGET_DIR: buildTarget,
})

await copyFile(distServer, builtServer)
await copyFile(builtOverlay, releaseOverlay, { tolerateBusy: true })
await copyFile(distServer, releaseServer, { tolerateBusy: true })
await copyTree(builtBundle, releaseBundle)
