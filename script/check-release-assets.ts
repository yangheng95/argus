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

if (mode === "cli") {
  const dir = path.resolve(flag("--dir") || "")
  const rawPlatforms = flag("--platforms")
  const version = flag("--version")
  const requireArchives = args.includes("--require-archives")
  if (!dir || !rawPlatforms) {
    throw new Error("cli mode requires --dir and --platforms")
  }
  const platforms = rawPlatforms.split(",").map((item) => item.trim()).filter(Boolean)
  for (const platform of platforms) {
    const root = path.join(dir, `opencorvus-${platform}`)
    const bin = path.join(root, "bin")
    const ui = path.join(bin, "ui")
    if (!exists(root)) throw new Error(`Missing CLI platform directory: ${root}`)
    requireAny(bin, [/^opencorvus(\.exe)?$/], "CLI binary")
    requireFile(path.join(ui, "index.html"))
    requireFile(path.join(ui, "app.js"))
    requireFile(path.join(ui, "styles.css"))
    if (requireArchives) {
      const archive =
        platform.startsWith("linux")
          ? path.join(dir, `opencorvus-${platform}.tar.gz`)
          : path.join(dir, `opencorvus-${platform}.zip`)
      requireFile(archive)
    }
  }
  if (version) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "opencorvus-windows-x64", "package.json"), "utf8")) as { version?: string }
    if (pkg.version && pkg.version !== version) {
      throw new Error(`CLI package version mismatch: expected ${version}, got ${pkg.version}`)
    }
  }
  console.log(`CLI assets validated for ${platforms.join(", ")}`)
  process.exit(0)
}

const dir = path.resolve(flag("--dir") || "")
const platform = flag("--platform")
const version = flag("--version")
if (!dir || !platform || !version) {
  throw new Error("overlay mode requires --dir, --platform and --version")
}

requireAny(dir, [/^opencorvus-overlay(\.exe)?$/], "overlay binary")

if (platform.startsWith("windows")) {
  requireAny(dir, [new RegExp(`^OpenCorvus_${version.replace(/\./g, "\\.")}.*\\.msi$`)], "Windows MSI bundle")
  requireAny(dir, [new RegExp(`^OpenCorvus_${version.replace(/\./g, "\\.")}.*-setup\\.exe$`)], "Windows NSIS bundle")
} else if (platform.startsWith("darwin")) {
  requireAny(dir, [/\.dmg$/, /\.app\.tar\.gz$/], "macOS bundle")
} else if (platform.startsWith("linux")) {
  requireAny(dir, [/\.AppImage$/, /\.deb$/, /\.rpm$/], "Linux bundle")
}

console.log(`Overlay assets validated for ${platform}`)
