#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repo = path.resolve(dir, "../..")
const opencorvus = path.resolve(repo, "packages/opencorvus")
const tauri = path.resolve(dir, "src-tauri")
const target = path.join(tauri, "target")
const release = path.join(target, "release")

const serverFile = process.platform === "win32" ? "opencorvus.exe" : "opencorvus"
const overlayFile = process.platform === "win32" ? "opencorvus-overlay.exe" : "opencorvus-overlay"
const serverDistName = [
  "opencorvus",
  process.platform === "win32" ? "windows" : process.platform,
  process.arch,
].join("-")
const packageName = [
  "opencorvus-overlay",
  process.platform === "win32" ? "windows" : process.platform,
  process.arch,
].join("-")

const distServer = path.join(opencorvus, "dist", serverDistName, serverFile)
const distRoot = path.join(dir, "dist", packageName)
const packagedOverlay = path.join(distRoot, overlayFile)
const stagedResources = path.join(tauri, "resources")

function text(error: unknown) {
  if (typeof error === "string") return error
  if (!(error instanceof Error)) return String(error)
  const stderr = Reflect.get(error, "stderr")
  return [error.message, typeof stderr === "string" ? stderr : ""].filter(Boolean).join("\n")
}

async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
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

async function cargoPath() {
  if (process.platform !== "win32") return process.env.PATH
  const dir = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".cargo", "bin") : ""
  if (!dir) return process.env.PATH
  if (!(await exists(path.join(dir, "cargo.exe")))) return process.env.PATH
  const list = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
  if (list.includes(dir)) return process.env.PATH
  return [dir, ...list].join(path.delimiter)
}

function tauriArgs() {
  return ["--config", JSON.stringify({ bundle: { resources: [] } })]
}

async function removeDirIfEmpty(dir: string) {
  const entries = await fs.readdir(dir).catch(() => null)
  if (entries && entries.length === 0) {
    await fs.rmdir(dir).catch(() => undefined)
  }
}

async function cleanBuildResidue() {
  await Promise.all([
    fs.rm(path.join(target, "build-resources"), { recursive: true, force: true }).catch(() => undefined),
    fs.rm(path.join(target, "bundle-build"), { recursive: true, force: true }).catch(() => undefined),
    fs.rm(path.join(release, "bundle"), { recursive: true, force: true }).catch(() => undefined),
    fs.rm(path.join(release, "nsis"), { recursive: true, force: true }).catch(() => undefined),
    fs.rm(path.join(release, "wix"), { recursive: true, force: true }).catch(() => undefined),
    fs.rm(path.join(release, serverFile), { force: true }).catch(() => undefined),
    fs.rm(path.join(release, "ui"), { recursive: true, force: true }).catch(() => undefined),
    fs.rm(path.join(stagedResources, serverFile), { force: true }).catch(() => undefined),
    fs.rm(path.join(stagedResources, "ui"), { recursive: true, force: true }).catch(() => undefined),
  ])
  await removeDirIfEmpty(stagedResources)
  const files = await fs.readdir(release).catch(() => [])
  await Promise.all(
    files
      .filter((file) => /^OpenCorvus_.*\.(?:msi|exe)$/i.test(file))
      .map((file) => fs.rm(path.join(release, file), { force: true }).catch(() => undefined)),
  )
}

const skipOpencorvusBuild = process.argv.includes("--skip-opencorvus-build")
if (!skipOpencorvusBuild) {
  await $`bun run build`.cwd(opencorvus)
}

if (!(await exists(distServer))) {
  throw new Error(
    `Bundled opencorvus binary not found at ${distServer}` +
      (skipOpencorvusBuild ? "\nRun: cd packages/opencorvus && bun run build --all" : ""),
  )
}

await fs.rm(distRoot, { recursive: true, force: true }).catch(() => undefined)
await cleanBuildResidue()

await $`tauri build --no-bundle ${tauriArgs()}`.cwd(dir).env({
  CARGO_TARGET_DIR: target,
  OPENCORVUS_EMBED_PATH: distServer,
  PATH: await cargoPath(),
})

const builtOverlay = path.join(release, overlayFile)
if (!(await exists(builtOverlay))) {
  throw new Error(`Overlay binary not found at ${builtOverlay}`)
}

await fs.mkdir(distRoot, { recursive: true })
await copyFile(builtOverlay, packagedOverlay, { required: true })
await cleanBuildResidue()
