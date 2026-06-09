#!/usr/bin/env bun

import fs from "fs"
import path from "path"

const args = process.argv.slice(2)
const mode = args[0]

if (!mode || !["cli", "overlay"].includes(mode)) {
  throw new Error("Usage: bun ./script/check-release-assets.ts <cli|overlay> ...")
}

function flag(name: string) {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
}

function version(name: string) {
  const value = flag(name)?.trim()
  if (!value) return undefined
  return value.replace(/^v(?=\d)/, "")
}

function exists(p: string) {
  return fs.existsSync(p)
}

function list(dir: string) {
  return exists(dir) ? fs.readdirSync(dir) : []
}

function requireFile(file: string) {
  if (!exists(file)) {
    throw new Error(`Missing required file: ${file}`)
  }
}

function requireAny(dir: string, patterns: RegExp[], label: string) {
  const files = list(dir)
  if (!patterns.some((pattern) => files.some((file) => pattern.test(file)))) {
    throw new Error(`Missing ${label} in ${dir}. Found: ${files.join(", ") || "none"}`)
  }
}

// Walk dir recursively and return every file path relative to it, in
// posix-separator form. Used by ui/ asset checks since Vite emits
// hashed filenames under chunk-specific subpaths and the validator
// previously hardcoded `app.js` / `styles.css` (a stale assumption from
// when the panel was a single hand-written bundle).
function walk(dir: string, base: string = dir): string[] {
  if (!exists(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full, base))
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).replaceAll("\\", "/"))
    }
  }
  return out
}

function requireUiBundle(uiRoot: string) {
  requireFile(path.join(uiRoot, "index.html"))
  const all = walk(uiRoot)
  if (!all.some((f) => f.endsWith(".js"))) {
    throw new Error(`Missing UI script (.js) under ${uiRoot}. Found: ${all.join(", ") || "none"}`)
  }
  if (!all.some((f) => f.endsWith(".css"))) {
    throw new Error(`Missing UI stylesheet (.css) under ${uiRoot}. Found: ${all.join(", ") || "none"}`)
  }
}

if (mode === "cli") {
  const dir = path.resolve(flag("--dir") || "")
  const rawPlatforms = flag("--platforms")
  const current = version("--version")
  const requireArchives = args.includes("--require-archives")
  if (!dir || !rawPlatforms) {
    throw new Error("cli mode requires --dir and --platforms")
  }
  const platforms = rawPlatforms
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  for (const platform of platforms) {
    const root = path.join(dir, `opencorvus-${platform}`)
    const ui = path.join(root, "ui")
    if (!exists(root)) throw new Error(`Missing CLI platform directory: ${root}`)
    requireAny(root, [/^opencorvus(\.exe)?$/], "CLI binary")
    requireUiBundle(ui)
    if (requireArchives) {
      const archive = platform.startsWith("linux")
        ? path.join(dir, `opencorvus-${platform}.tar.gz`)
        : path.join(dir, `opencorvus-${platform}.zip`)
      requireFile(archive)
    }
  }
  console.log(`CLI assets validated for ${platforms.join(", ")}`)
  process.exit(0)
}

const dir = path.resolve(flag("--dir") || "")
const platform = flag("--platform")
const current = version("--version")
const requireBundle = args.includes("--require-bundle")
if (!dir || !platform || !current) {
  throw new Error("overlay mode requires --dir, --platform and --version")
}

requireAny(dir, [/^opencorvus-overlay(\.exe)?$/], "overlay binary")

// build-overlay.ts / overlay/script/build.ts both run `tauri build
// --no-bundle`, so per-platform installer bundles (deb/rpm/AppImage on
// Linux, dmg on macOS, msi/nsis on Windows) are NOT produced for dev
// snapshot runs. Gate the installer-bundle requirement behind an
// explicit flag — release builds opt in via `--require-bundle`, dev
// snapshots stop at the bare overlay binary.
if (requireBundle) {
  if (platform.startsWith("windows")) {
    requireAny(dir, [new RegExp(`^OpenCorvus_${current.replace(/\./g, "\\.")}.*\\.msi$`)], "Windows MSI bundle")
    requireAny(dir, [new RegExp(`^OpenCorvus_${current.replace(/\./g, "\\.")}.*-setup\\.exe$`)], "Windows NSIS bundle")
  } else if (platform.startsWith("darwin")) {
    requireAny(dir, [/\.dmg$/, /\.app\.tar\.gz$/], "macOS bundle")
  } else if (platform.startsWith("linux")) {
    requireAny(dir, [/\.AppImage$/, /\.deb$/, /\.rpm$/], "Linux bundle")
  }
}

console.log(`Overlay assets validated for ${platform}`)
