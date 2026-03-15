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
const release = path.join(target, "release")
const overlayUi = path.join(dir, "src")

const serverFile = process.platform === "win32" ? "opencorvus.exe" : "opencorvus"

const distName = [
  "opencorvus",
  process.platform === "win32" ? "windows" : process.platform,
  process.arch,
].join("-")

const distServer = path.join(opencorvus, "dist", distName, "bin", serverFile)
const stagedServer = path.join(resources, serverFile)
const stagedUi = path.join(resources, "ui")
const releaseServer = path.join(release, serverFile)
const releaseUi = path.join(release, "ui")

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

async function copyDir(src: string, dest: string, options?: { required?: boolean }) {
  if (!(await exists(src))) {
    if (options?.required) throw new Error(`Missing required directory: ${src}`)
    return false
  }
  await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.cp(src, dest, { recursive: true })
  return true
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

async function tauriArgs() {
  if (process.platform !== "win32") return []
  const conf = await Bun.file(path.join(tauri, "tauri.conf.json")).json()
  if (typeof conf.version !== "string" || !conf.version.includes("-")) return []
  const version = conf.version.split("-", 1)[0]
  console.warn(`overlay build: using Windows bundle version ${version} for prerelease ${conf.version}`)
  return ["--config", JSON.stringify({ version })]
}

async function cleanLegacyOutputs() {
  await fs.rm(path.join(target, "bundle-build"), { recursive: true, force: true }).catch(() => undefined)
  const files = await fs.readdir(release).catch(() => [])
  await Promise.all(
    files
      .filter((file) => /^OpenCorvus_.*\.(?:msi|exe)$/i.test(file))
      .map((file) => fs.rm(path.join(release, file), { force: true }).catch(() => undefined)),
  )
}

async function cleanUnusedOutputs() {
  await Promise.all([
    fs.rm(path.join(target, "debug"), { recursive: true, force: true }).catch(() => undefined),
    fs.rm(path.join(release, "nsis"), { recursive: true, force: true }).catch(() => undefined),
    fs.rm(path.join(release, "wix"), { recursive: true, force: true }).catch(() => undefined),
  ])
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

await fs.mkdir(resources, { recursive: true })
await copyFile(distServer, stagedServer, { required: true })
await copyDir(overlayUi, stagedUi, { required: true })
await cleanLegacyOutputs()

await $`tauri build ${await tauriArgs()}`.cwd(dir).env({
  CARGO_TARGET_DIR: target,
  PATH: await cargoPath(),
})

await copyFile(distServer, releaseServer, { tolerateBusy: true })
await copyDir(overlayUi, releaseUi, { required: true })
await cleanUnusedOutputs()
