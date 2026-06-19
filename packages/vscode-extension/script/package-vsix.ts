#!/usr/bin/env bun
/**
 * Build one platform-specific VSIX (plan-vscode-extension.md M7 / §8 /
 * §19.1.4 / §19.2.5).
 *
 * Steps:
 *   1. Resolve the requested VS Code target to its source dist
 *      directory (opencorvus's bun-compile naming differs from VS
 *      Code's official target string).
 *   2. Wipe `bin/` and stage the matching binary at
 *      `bin/<vscode-target>/opencorvus[.exe]`. Wipe-and-stage keeps the
 *      VSIX from accidentally bundling another target's binary
 *      (CLAUDE.md §一-7: no fallback, no compat).
 *   3. Run esbuild + UI sync via the package's own build script, then
 *      `vsce package --target <vscode-target> --out <vsix>`.
 *   4. Hard-fail when the VSIX is over the §M0 size guard so a future
 *      runtime growth is caught at packaging time, not at marketplace
 *      upload time.
 *
 * Usage:
 *   bun run script/package-vsix.ts --target win32-x64 [--out ./vsix]
 *
 * Source binaries are expected under
 *   ../opencorvus/dist/opencorvus-<source>/opencorvus[.exe]
 * (the existing build.yml CI artefacts).
 */

import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { assertOverlayUiBundleDir, assertOverlayUiBundleSynced } from "./overlay-ui-bundle-assertions.mjs"

// ── Constants ──────────────────────────────────────────────────────

/** Maximum size of a single VSIX in bytes. The marketplace soft limit
 *  is ~250MB and the hard limit is around 500MB depending on the path,
 *  but plan §19.1.4 commits to a much tighter local cap so we catch
 *  bun-runtime / dependency bloat at the packaging step instead of
 *  during a marketplace upload. The number is chosen to leave
 *  ~10MB of headroom over the empirically measured ~189MB / platform. */
const VSIX_MAX_BYTES = 195 * 1024 * 1024

/** VS Code target → opencorvus dist naming.
 *  Keep both axes explicit; do NOT derive one from the other.
 *  win32-arm64 is intentionally absent: the existing build.yml CI
 *  matrix has no windows-arm runner (5 platforms only), and shipping
 *  a target that has no corresponding sidecar binary would be a
 *  silent fallback (CLAUDE.md §一-7). Add the runner to build.yml
 *  before adding it here. */
const TARGET_TO_DIST: Record<string, string> = {
  "win32-x64": "windows-x64",
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
}

const SUPPORTED_TARGETS = Object.keys(TARGET_TO_DIST)

// ── Pure helpers (exported for tests) ──────────────────────────────

export function resolveSourceDist(opts: { target: string; monorepoRoot: string }): {
  sourceDir: string
  binaryName: string
  binaryPath: string
} {
  const sourceTarget = TARGET_TO_DIST[opts.target]
  if (!sourceTarget) {
    throw new Error(
      `unsupported VS Code target "${opts.target}" — supported: ${SUPPORTED_TARGETS.join(", ")}. ` +
        `Add to TARGET_TO_DIST after the matching runner lands in .github/workflows/build.yml.`,
    )
  }
  const sourceDir = path.join(opts.monorepoRoot, "packages", "opencorvus", "dist", `opencorvus-${sourceTarget}`)
  const binaryName = opts.target.startsWith("win32-") ? "opencorvus.exe" : "opencorvus"
  const binaryPath = path.join(sourceDir, binaryName)
  return { sourceDir, binaryName, binaryPath }
}

export function vsixFilename(opts: { target: string; version: string; publisher: string; name: string }): string {
  // vsce default name: <publisher>.<name>-<version>.vsix. Including the
  // target in the filename prevents accidental overwrite when packaging
  // multiple targets in a row.
  return `${opts.publisher}.${opts.name}-${opts.version}-${opts.target}.vsix`
}

export function checkVsixSize(filePath: string, max: number = VSIX_MAX_BYTES): void {
  const stat = fs.statSync(filePath)
  if (stat.size > max) {
    throw new Error(
      `VSIX exceeds size guard: ${stat.size} bytes > ${max} bytes ` +
        `(file: ${filePath}). Investigate sourcemap leakage, runtime bloat, or ` +
        `missing .vscodeignore entries before bumping the cap.`,
    )
  }
}

export function readPackageMeta(extensionRoot: string): {
  version: string
  publisher: string
  name: string
} {
  const pkg = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8")) as {
    version?: string
    publisher?: string
    name?: string
  }
  if (!pkg.version || !pkg.publisher || !pkg.name) {
    throw new Error("vscode-extension package.json missing version/publisher/name")
  }
  // pkg.name is `@opencorvus-ai/vscode-extension` in this workspace; vsce
  // expects an unscoped name. Strip the scope so the .vsix filename is
  // marketplace-friendly.
  const bareName = pkg.name.startsWith("@") ? (pkg.name.split("/")[1] ?? pkg.name) : pkg.name
  return { version: pkg.version, publisher: pkg.publisher, name: bareName }
}

export function assertPackageOverlayUiAssets(extensionRoot: string): void {
  const mediaUi = path.join(extensionRoot, "media", "ui")
  const distVite = path.join(extensionRoot, "..", "overlay", "dist-vite")
  assertOverlayUiBundleDir(mediaUi)
  assertOverlayUiBundleSynced(distVite, mediaUi)
}

export function prepareOverlayUiForVsix(opts: {
  extensionRoot: string
  skipBuild: boolean
  buildAndSync: (extensionRoot: string) => void
  log?: (message: string) => void
}): void {
  if (!opts.skipBuild) {
    opts.buildAndSync(opts.extensionRoot)
  } else {
    opts.log?.("[package-vsix] --skip-build: verifying existing dist/ + media/ui/")
  }
  assertPackageOverlayUiAssets(opts.extensionRoot)
}

// ── Main flow (skipped in unit tests) ──────────────────────────────

function parseArgs(argv: string[]): { target: string; outDir: string; skipBuild: boolean } {
  let target: string | undefined
  let outDir: string | undefined
  let skipBuild = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--target") target = argv[++i]
    else if (arg === "--out") outDir = argv[++i]
    else if (arg === "--skip-build") skipBuild = true
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun run script/package-vsix.ts --target <target> [--out <dir>] [--skip-build]\n" +
          `targets: ${SUPPORTED_TARGETS.join(", ")}`,
      )
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (!target) {
    throw new Error(`--target is required (one of ${SUPPORTED_TARGETS.join(", ")})`)
  }
  if (!SUPPORTED_TARGETS.includes(target)) {
    throw new Error(`unsupported target "${target}" — supported: ${SUPPORTED_TARGETS.join(", ")}`)
  }
  return {
    target,
    outDir: outDir ?? path.join("dist-vsix"),
    skipBuild,
  }
}

function copyTree(src: string, dest: string): void {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyTree(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const extensionRoot = path.resolve(__dirname, "..")
  const monorepoRoot = path.resolve(extensionRoot, "..", "..")
  const meta = readPackageMeta(extensionRoot)

  console.log(
    `[package-vsix] target=${args.target} version=${meta.version} ` + `publisher=${meta.publisher} name=${meta.name}`,
  )

  // 1. Stage binary
  const { sourceDir, binaryName, binaryPath } = resolveSourceDist({
    target: args.target,
    monorepoRoot,
  })
  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `sidecar binary not found at ${binaryPath}\n` +
        `Run packages/opencorvus build for ${args.target} first, or download ` +
        `the matching CI artifact (build.yml \"opencorvus-dist-<platform>\").`,
    )
  }
  const binDir = path.join(extensionRoot, "bin")
  fs.rmSync(binDir, { recursive: true, force: true })
  const stagedDir = path.join(binDir, args.target)
  fs.mkdirSync(stagedDir, { recursive: true })
  fs.copyFileSync(binaryPath, path.join(stagedDir, binaryName))
  if (process.platform !== "win32") {
    fs.chmodSync(path.join(stagedDir, binaryName), 0o755)
  }
  console.log(`[package-vsix] staged ${binaryPath} → ${path.join(stagedDir, binaryName)}`)

  // 2. Build extension + sync overlay UI (esbuild.mjs handles both)
  prepareOverlayUiForVsix({
    extensionRoot,
    skipBuild: args.skipBuild,
    buildAndSync: buildExtensionWithFreshOverlayUi,
    log: console.log,
  })

  // 3. Run vsce package
  const outDir = path.resolve(extensionRoot, args.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  const vsixName = vsixFilename({ target: args.target, ...meta })
  const vsixPath = path.join(outDir, vsixName)
  const vsce = spawnSync(
    process.platform === "win32" ? "bunx.cmd" : "bunx",
    ["vsce", "package", "--target", args.target, "--out", vsixPath, "--no-dependencies"],
    {
      cwd: extensionRoot,
      stdio: "inherit",
    },
  )
  if (vsce.status !== 0) {
    throw new Error(`vsce package failed (exit ${vsce.status})`)
  }

  // 4. Size guard — hard fail (CLAUDE.md §一-7)
  checkVsixSize(vsixPath)
  const sizeMB = (fs.statSync(vsixPath).size / (1024 * 1024)).toFixed(1)
  console.log(`[package-vsix] OK: ${vsixPath} (${sizeMB} MB)`)
}

// Skip main() when the file is loaded by the test runner.
if (import.meta.main) {
  main().catch((err) => {
    console.error(`[package-vsix] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  })
}

function buildExtensionWithFreshOverlayUi(extensionRoot: string): void {
  const build = spawnSync("node", ["esbuild.mjs", "--production"], {
    cwd: extensionRoot,
    stdio: "inherit",
  })
  if (build.status !== 0) {
    throw new Error(`esbuild --production failed (exit ${build.status})`)
  }
}

void os
