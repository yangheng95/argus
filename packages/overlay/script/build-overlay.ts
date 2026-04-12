#!/usr/bin/env bun

/**
 * Full overlay build script — single command for the complete pipeline.
 *
 * Steps:
 *   1. Kill running overlay processes (Windows: PowerShell Kill())
 *   2. build:mainjs — compile TSX sources → src/main.js
 *   3. check:i18n — verify locale files match panel revision
 *   4. build:vite — bundle main.js + CSS + HTML → dist-vite/
 *   5. Remove stale opencorvus binary — force rebuild on every overlay build
 *   6. tauri build --no-bundle — compile Rust → overlay binary
 *   7. Copy binary to dist/<platform>/
 *
 * Usage:
 *   bun run build:overlay              # full pipeline
 *   bun run build:overlay --skip-tauri  # UI only (steps 1-4)
 *   bun run build:overlay --skip-kill   # skip process kill
 */

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

const isWindows = process.platform === "win32"
const overlayFile = isWindows ? "opencorvus-overlay.exe" : "opencorvus-overlay"
const serverFile = isWindows ? "opencorvus.exe" : "opencorvus"

const serverDistName = [
  "opencorvus",
  isWindows ? "windows" : process.platform,
  process.arch,
].join("-")

const packageName = [
  "opencorvus-overlay",
  isWindows ? "windows" : process.platform,
  process.arch,
].join("-")

const distServer = path.join(opencorvus, "dist", serverDistName, serverFile)
const distRoot = path.join(dir, "dist", packageName)
const packagedOverlay = path.join(distRoot, overlayFile)

// ── Args ──
const args = new Set(process.argv.slice(2))
const skipTauri = args.has("--skip-tauri")
const skipKill = args.has("--skip-kill")

function step(label: string) {
  console.log(`\n── ${label} ──`)
}

async function exists(file: string) {
  return fs.access(file).then(() => true).catch(() => false)
}

async function cargoPath() {
  if (!isWindows) return process.env.PATH
  const cargoDir = process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, ".cargo", "bin")
    : ""
  if (!cargoDir) return process.env.PATH
  if (!(await exists(path.join(cargoDir, "cargo.exe")))) return process.env.PATH
  const list = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
  if (list.includes(cargoDir)) return process.env.PATH
  return [cargoDir, ...list].join(path.delimiter)
}

function tauriArgs() {
  return [
    "--config",
    JSON.stringify({
      build: { frontendDist: "../dist-vite" },
      bundle: { resources: [] },
    }),
  ]
}

// ── Step 1: Kill overlay processes ──
//
// NOTE: We used to run a PowerShell one-liner via Bun's $ shell, but Bun's
// shell eagerly expands bare $IDENT sequences (its own env-var substitution,
// not JS template interpolation). That turned `$_.Kill()` and `$r` into empty
// strings, producing malformed PowerShell, which threw → the catch printed
// "no overlay process running" while the real process stayed alive, then
// Cargo's linker hit LNK1104 on target/release/deps/opencorvus_overlay.exe
// because the hardlinked release binary was still locked. Use taskkill on
// Windows — no $-variables involved, exit code tells us if anything was
// killed, and we verify the process is really gone before proceeding.
if (!skipKill) {
  step("Kill running overlay processes")
  if (isWindows) {
    const killed = await $`taskkill /F /IM opencorvus-overlay.exe`.quiet().nothrow()
    if (killed.exitCode === 0) {
      console.log("killed running overlay process")
      // Windows releases file handles asynchronously after process exit.
      // Give the kernel a moment to drop the lock before the linker writes.
      await new Promise((r) => setTimeout(r, 2000))
    } else {
      console.log("no overlay process running")
    }
    // Verify: the linker will fail if any opencorvus-overlay.exe is alive.
    const check = await $`tasklist /FI "IMAGENAME eq opencorvus-overlay.exe" /NH`.quiet().nothrow()
    const stdout = check.stdout.toString()
    if (stdout.toLowerCase().includes("opencorvus-overlay.exe")) {
      throw new Error(
        `opencorvus-overlay.exe is still running after taskkill:\n${stdout}\n` +
          `The linker will fail with LNK1104 on deps/opencorvus_overlay.exe ` +
          `because Cargo hardlinks it to the running release/ binary.`,
      )
    }
  } else {
    await $`pkill -f opencorvus-overlay`.quiet().nothrow()
    console.log("done")
  }
}

// ── Step 2: build:mainjs ──
step("Compile TSX → main.js")
await $`bun run build:mainjs`.cwd(dir)

// ── Step 3: check:i18n ──
step("Check i18n")
await $`bun run check:i18n`.cwd(dir)

// ── Step 4: build:vite ──
step("Build Vite → dist-vite/")
await $`bun run build:vite`.cwd(dir)

if (skipTauri) {
  console.log("\n✓ UI build complete (--skip-tauri). dist-vite/ is ready.")
  process.exit(0)
}

// ── Step 5: Remove stale opencorvus binary ──
//
// The overlay embeds the opencorvus binary at build time via OPENCORVUS_EMBED_PATH.
// If we skip this step, a stale binary from a previous build is reused — the Tauri
// overlay compiles successfully but runs old orchestrator/executor code, silently
// masking source changes. Always delete the binary first to force a fresh rebuild.
step("Remove stale opencorvus binary")
const serverDistDir = path.join(opencorvus, "dist", serverDistName)
await fs.rm(serverDistDir, { recursive: true, force: true })
console.log(`removed ${serverDistDir}`)

// ── Step 6: Tauri build ──
step("Tauri build → overlay binary")

console.log("Building opencorvus first...")
await $`bun run build`.cwd(opencorvus)
if (!(await exists(distServer))) {
  throw new Error(`opencorvus binary still not found at ${distServer}`)
}

// Clean previous build artifacts that may be locked by Windows
const builtOverlay = path.join(release, overlayFile)
try {
  await fs.rm(builtOverlay, { force: true })
} catch {
  // File locked — try rename then delete (Windows file locking workaround)
  const stale = builtOverlay + ".old"
  await fs.rm(stale, { force: true }).catch(() => undefined)
  try {
    await fs.rename(builtOverlay, stale)
    await fs.rm(stale, { force: true }).catch(() => undefined)
  } catch {
    // Last resort: PowerShell force removal
    if (isWindows) {
      console.log("Binary locked, attempting PowerShell removal...")
      await $`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Force -Path '${builtOverlay}' -ErrorAction SilentlyContinue"`.quiet().nothrow()
    }
  }
}

await $`tauri build --no-bundle ${tauriArgs()}`.cwd(dir).env({
  CARGO_TARGET_DIR: target,
  OPENCORVUS_EMBED_PATH: distServer,
  PATH: await cargoPath(),
})

if (!(await exists(builtOverlay))) {
  throw new Error(`Overlay binary not found at ${builtOverlay}`)
}

// ── Step 7: Copy to dist/ ──
step("Copy binary to dist/")
await fs.mkdir(distRoot, { recursive: true })
await fs.copyFile(builtOverlay, packagedOverlay)
console.log(`→ ${packagedOverlay}`)

console.log("\n✓ Full overlay build complete.")
