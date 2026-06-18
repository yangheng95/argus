#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

import {
  overlayArchFromNode,
  overlayExecutableFileName,
  overlayPackageName,
  overlayPlatformFromNode,
  overlayServerDistName,
  overlayServerFileName,
} from "./artifact-names"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repo = path.resolve(dir, "../..")
const opencorvus = path.resolve(repo, "packages/opencorvus")
const tauri = path.resolve(dir, "src-tauri")
const target = path.join(tauri, "target")
const release = path.join(target, "release")

const hostPlatform = overlayPlatformFromNode()
const hostArch = overlayArchFromNode()
const serverFile = overlayServerFileName(hostPlatform)
const overlayFile = overlayExecutableFileName(hostPlatform)
const serverDistName = overlayServerDistName(hostPlatform, hostArch)
const packageName = overlayPackageName(hostPlatform, hostArch)

const distServerDir = path.join(opencorvus, "dist", serverDistName)
const distServer = path.join(distServerDir, serverFile)
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
  return [
    "--config",
    JSON.stringify({
      bundle: { resources: [] },
    }),
  ]
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

await $`bun run build:vite`.cwd(dir)

await $`bun run build --overlay-server`.cwd(opencorvus)

if (!(await exists(distServer))) {
  throw new Error(`Bundled opencorvus binary not found at ${distServer}`)
}

await fs.rm(distRoot, { recursive: true, force: true }).catch(() => undefined)
await cleanBuildResidue()

// `tauri build` alone leaves Tauri 2.x without an explicit bundle list
// and the build silently produces only the bare executable — no
// .app/.dmg on macOS, no .msi/-setup.exe on Windows, no
// .deb/.rpm/.AppImage on Linux. Even with bundle.active=true and
// targets="all" in tauri.conf.json, the CLI's --config deep-merge
// (we pass {bundle:{resources:[]}}) interacts poorly enough that the
// bundle pipeline gets skipped. The `--bundles` flag opts in
// unconditionally, but Tauri 2.x rejects the keyword `all`; valid
// values are platform-specific (`app dmg` on macOS, `msi nsis` on
// Windows, `deb rpm appimage` on Linux), so we pass the host's full
// default set explicitly.
function bundleTargets(): string[] {
  if (process.platform === "darwin") return ["app", "dmg"]
  if (process.platform === "win32") return ["msi", "nsis"]
  return ["deb", "rpm", "appimage"]
}
await $`tauri build --bundles ${bundleTargets()} ${tauriArgs()}`.cwd(dir).env({
  CARGO_TARGET_DIR: target,
  OPENCORVUS_EMBED_PATH: distServerDir,
  PATH: await cargoPath(),
})

const builtOverlay = path.join(release, overlayFile)
if (!(await exists(builtOverlay))) {
  throw new Error(`Overlay binary not found at ${builtOverlay}`)
}

await fs.mkdir(distRoot, { recursive: true })
await copyFile(builtOverlay, packagedOverlay, { required: true })
