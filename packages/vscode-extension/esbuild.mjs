import esbuild from "esbuild"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * VS Code extension build:
 *  - bundles src/extension.ts → dist/extension.cjs
 *  - CommonJS because the VS Code extension host loads via require()
 *  - external `vscode` module is provided by the host at runtime
 *  - no source maps in production (plan §19.1.4: VSIX must stay <200MB)
 *  - dead-code-eliminate dev-only branches via `define`
 *  - copies the overlay's Vite-built UI (packages/overlay/dist-vite)
 *    into media/ui so the bundled VSIX has self-contained webview
 *    assets (plan §6 / M5). Copies are skipped with --skip-ui for
 *    fast iterative dev cycles.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.argv.includes("--production")
const skipUi = process.argv.includes("--skip-ui")

if (!skipUi) {
  syncOverlayUi(here)
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

function syncOverlayUi(extensionRoot) {
  const distVite = path.resolve(extensionRoot, "..", "overlay", "dist-vite")
  const target = path.resolve(extensionRoot, "media", "ui")
  if (!fs.existsSync(distVite)) {
    console.error(
      `[build] overlay dist-vite not found at ${distVite}\n` +
        `Run \`bun run --cwd packages/overlay build:vite\` first, or pass --skip-ui to skip.`,
    )
    process.exit(2)
  }
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
