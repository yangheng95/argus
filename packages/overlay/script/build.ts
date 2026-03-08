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
const overlayFile = path.join(tauri, "target", "release", process.platform === "win32" ? "opencorvus-overlay.exe" : "opencorvus-overlay")

function text(error: unknown) {
  if (typeof error === "string") return error
  if (!(error instanceof Error)) return String(error)
  const stderr = Reflect.get(error, "stderr")
  return [error.message, typeof stderr === "string" ? stderr : ""].filter(Boolean).join("\n")
}

function locked(error: unknown) {
  if (process.platform !== "win32") return false
  const message = text(error)
  return (
    message.includes("failed to remove file") &&
    message.includes("opencorvus-overlay.exe") &&
    message.includes("os error 5")
  )
}

function busy(error: unknown) {
  if (process.platform !== "win32") return false
  const message = text(error)
  return (
    message.includes("EBUSY") ||
    message.includes("EPERM") ||
    message.includes("resource busy or locked") ||
    message.includes("Access is denied")
  )
}

async function unlock() {
  if (process.platform !== "win32") return
  for (const _ of Array.from({ length: 12 })) {
    Bun.spawnSync(["taskkill", "/IM", "opencorvus-overlay.exe", "/T", "/F"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    await fs.rm(overlayFile, { force: true }).catch(() => undefined)
    if (!(await Bun.file(overlayFile).exists())) return
    await Bun.sleep(250)
  }
}

async function copy(src: string, dest: string) {
  for (const i of Array.from({ length: 12 }).keys()) {
    try {
      await fs.copyFile(src, dest)
      return
    } catch (error) {
      if (!busy(error) || i === 11) throw error
      await unlock()
      await fs.rm(dest, { force: true }).catch(() => undefined)
      await Bun.sleep(250)
    }
  }
}

await $`bun run build`.cwd(opencorvus)

const exists = await fs.stat(distServer).catch(() => undefined)
if (!exists) {
  throw new Error(`Bundled opencorvus binary not found at ${distServer}`)
}

await fs.mkdir(resources, { recursive: true })
await unlock()
await copy(distServer, stagedServer)

await unlock()
for (const i of Array.from({ length: 3 }).keys()) {
  try {
    await $`tauri build`.cwd(dir)
    break
  } catch (error) {
    if (!locked(error) || i === 2) throw error
    await unlock()
  }
}

await fs.copyFile(stagedServer, releaseServer).catch(() => undefined)
