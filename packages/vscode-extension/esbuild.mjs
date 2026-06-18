import esbuild from "esbuild"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { assertOverlayUiBundleDir } from "./script/overlay-ui-bundle-assertions.mjs"

/**
 * VS Code extension build:
 *  - bundles src/extension.ts → dist/extension.cjs
 *  - CommonJS because the VS Code extension host loads via require()
 *  - external `vscode` module is provided by the host at runtime
 *  - no source maps in production (plan §19.1.4: VSIX must stay <200MB)
 *  - dead-code-eliminate dev-only branches via `define`
 *  - copies the overlay's Vite-built UI (packages/overlay/dist-vite)
 *    into media/ui so the bundled VSIX has self-contained webview
 *    assets (plan §6 / M5). The overlay UI is built first so the
 *    extension never ships stale webview assets. Copies are skipped
 *    with --skip-ui for fast iterative dev cycles.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.argv.includes("--production")
const skipUi = process.argv.includes("--skip-ui")

if (!skipUi) {
  buildOverlayUi(here)
  syncOverlayUi(here)
  assertOverlayUiBundleDir(path.resolve(here, "media", "ui"))
}

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: isProduction ? false : "inline",
  minify: isProduction,
  define: {
    "process.env.NODE_ENV": isProduction ? '"production"' : '"development"',
    // Production strips all dev-mode env reads (plan §17): the bundle
    // simply never sees these names, so a release VSIX cannot be
    // tricked into loading vite dev server / external sidecar.
    ...(isProduction
      ? {
          "process.env.OPENCORVUS_DEV_UI": "undefined",
          "process.env.OPENCORVUS_DEV_SIDECAR": "undefined",
          "process.env.OPENCORVUS_DEV_BINARY": "undefined",
        }
      : {}),
  },
  logLevel: "info",
})

function buildOverlayUi(extensionRoot) {
  const overlayRoot = path.resolve(extensionRoot, "..", "overlay")
  runBun(["run", "check:i18n"], overlayRoot)
  runBun(["run", "build:vite"], overlayRoot)
}

function syncOverlayUi(extensionRoot) {
  const distVite = path.resolve(extensionRoot, "..", "overlay", "dist-vite")
  const target = path.resolve(extensionRoot, "media", "ui")
  if (!fs.existsSync(distVite)) throw new Error(`[build] overlay dist-vite not found at ${distVite}`)
  // Wipe-and-copy is the right semantic — we never want a previous
  // build's stale assets to ship under a fresh hash, and Vite assets
  // are content-hashed so a partial overwrite can leave dangling
  // references in index.html.
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  copyTree(distVite, target)
  console.log(`[build] overlay UI synced: ${distVite} → ${target}`)
}

function copyTree(src, dest) {
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

function runBun(args, cwd) {
  const command = resolveBunCommand()
  console.log(`[build] ${command} ${args.join(" ")} (${cwd})`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`[build] ${command} ${args.join(" ")} failed with exit code ${result.status}`)
  }
}

function resolveBunCommand() {
  if (process.platform !== "win32") return "bun"
  const found = spawnSync("where.exe", ["bun"], { encoding: "utf8" })
  if (found.error) throw found.error
  if (found.status !== 0) throw new Error("[build] bun executable not found on PATH")
  const exe = found.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().endsWith(".exe"))
  if (!exe) throw new Error("[build] bun.exe not found on PATH")
  return exe
}
