#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const overlay = path.resolve(root, "../overlay")
const overlayTarget = path.join(overlay, "src-tauri", "target-portable")
process.chdir(root)

const skipBuild = process.argv.includes("--skip-build")
if (!skipBuild) {
  await $`${process.execPath} ./script/build.ts --single --binary-only`
  await $`cargo build --release --manifest-path ${path.join(overlay, "src-tauri", "Cargo.toml")}`
    .env({ CARGO_TARGET_DIR: overlayTarget })
}

const dist = path.join(root, "dist")
const dirs = (await fs.readdir(dist, { withFileTypes: true }))
  .filter((item) => item.isDirectory() && !item.name.endsWith("-portable"))
  .map((item) => item.name)
  .sort()

if (dirs.length === 0) throw new Error("No build output found in dist/")
const name = dirs.at(-1)!
const src = path.join(dist, name, "bin")
const out = path.join(dist, `${name}-portable`)
const backend = process.platform === "win32" ? "opencorvus.exe" : "opencorvus"
const sidecar = process.platform === "win32" ? "opencorvus-core.exe" : "opencorvus-core"
const launcher = process.platform === "win32" ? "opencorvus-overlay.exe" : "opencorvus-overlay"
const overlayBin = path.join(overlayTarget, "release", launcher)

await fs.access(path.join(src, backend))
await fs.access(overlayBin)

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(path.join(out, "bin"), { recursive: true })
await fs.mkdir(path.join(out, "home"), { recursive: true })
await fs.mkdir(path.join(out, "tools"), { recursive: true })

for (const item of await fs.readdir(src)) {
  const next = item === backend ? sidecar : item
  await fs.cp(path.join(src, item), path.join(out, "bin", next), { recursive: true, force: true })
}
await fs.copyFile(overlayBin, path.join(out, "bin", launcher))

await fs.writeFile(
  path.join(out, process.platform === "win32" ? "opencorvus-portable.cmd" : "opencorvus-portable.sh"),
  wrapper(launcher),
  "utf8",
)

if (process.platform !== "win32") {
  await fs.chmod(path.join(out, "opencorvus-portable.sh"), 0o755).catch(() => undefined)
}

await fs.writeFile(
  path.join(out, "tools", "README.txt"),
  [
    "Drop executor binaries here to let the portable wrapper find them first.",
    "Supported names include:",
    "- codex / codex.exe",
    "- claude / claude.exe",
    "- opencode / opencode.exe",
    "",
    "The wrapper also searches the user PATH and common install locations.",
  ].join("\n"),
  "utf8",
)

console.log(`portable package ready: dist/${name}-portable (entry: bin/${launcher})`)

function wrapper(binary: string) {
  if (process.platform === "win32") {
    return [
      "@echo off",
      "setlocal",
      "set ROOT=%~dp0",
      "set OPENCORVUS_HOME=%ROOT%home",
      "set OPENCORVUS_AUTO_DISCOVER_EXECUTORS=1",
      "set OPENCORVUS_EXECUTOR_SEARCH_PATHS=%ROOT%tools",
      "\"%ROOT%bin\\" + binary + "\" %*",
    ].join("\r\n")
  }

  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'ROOT="$(cd "$(dirname "$0")" && pwd)"',
    'export OPENCORVUS_HOME="$ROOT/home"',
    'export OPENCORVUS_AUTO_DISCOVER_EXECUTORS=1',
    'export OPENCORVUS_EXECUTOR_SEARCH_PATHS="$ROOT/tools"',
    `exec "$ROOT/bin/${binary}" "$@"`,
  ].join("\n")
}
