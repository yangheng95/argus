import { Hono, type Context } from "hono"
import path from "path"
import fs from "fs"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".json": "application/json",
}

function resolveOverlayDir(): string | undefined {
  // 1. Compiled binary: look for ui/ next to the executable
  const binDir = path.dirname(process.execPath)
  const distUi = path.join(binDir, "ui")
  if (fs.existsSync(path.join(distUi, "index.html"))) return distUi

  // import.meta.dir = .../packages/opencorvus/src/server
  const pkgRoot = import.meta.dir.replace(/[/\\]src[/\\]server$/, "")

  // 2. Workspace bundle: keep runtime and packaged delivery on the same built UI.
  const viteUi = path.resolve(pkgRoot, "../overlay/dist-vite")
  if (fs.existsSync(path.join(viteUi, "index.html"))) return viteUi

  return undefined
}

export namespace OverlayUI {
  export function routes() {
    const app = new Hono()

    // vite builds HTML with absolute asset paths (e.g. `/assets/...`).
    // When served under `/ui/`, those paths miss the mount point. Rewrite
    // them so links resolve under the overlay route.
    const rewriteHtmlAssets = (html: string): string =>
      html
        .replace(/(src|href)="\/(assets|i18n)\//g, '$1="/ui/$2/')

    const handle = async (c: Context) => {
      const dir = resolveOverlayDir()
      if (!dir) {
        return c.text("Overlay UI not found. Run `bun run --cwd packages/overlay build:vite` or package with bundled UI assets.", 404)
      }

      let reqPath = c.req.path.replace(/^\/ui/, "") || "/"
      if (reqPath === "/") reqPath = "/index.html"

      // audit-2026-04-29 opencorvus F7 — `path.join(dir, reqPath)` plus
      // `startsWith(dir)` was vulnerable on two axes:
      //  1. No path-separator boundary on the prefix — a sibling dir
      //     `/foo/ui-private/secret` would satisfy startsWith(`/foo/ui`)
      //     because both share the `/foo/ui` prefix.
      //  2. URL-encoded `..` segments (`%2e%2e`) reach `path.join` after
      //     Hono's URL decode, where they are interpreted as literal
      //     `..` and traverse out of dir.
      // path.resolve normalises `..`; comparing with a `${dir}${sep}`
      // prefix or an exact-equality check fixes both. Reject anything
      // that escapes.
      const resolved = path.resolve(dir, "." + reqPath)
      const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep
      if (resolved !== dir && !resolved.startsWith(dirWithSep)) {
        return c.text("Forbidden", 403)
      }
      const filePath = resolved

      try {
        const file = Bun.file(filePath)
        if (!(await file.exists())) {
          // SPA fallback — always serves the (rewritten) index.html
          const indexHtml = await Bun.file(path.join(dir, "index.html")).text()
          return c.body(rewriteHtmlAssets(indexHtml), 200, {
            "Content-Type": "text/html; charset=utf-8",
          })
        }
        const ext = path.extname(filePath)
        const contentType = MIME[ext] || "application/octet-stream"
        if (ext === ".html") {
          const html = await file.text()
          return c.body(rewriteHtmlAssets(html), 200, {
            "Content-Type": contentType,
            "Cache-Control": "no-cache",
          })
        }
        return c.body(await file.arrayBuffer(), 200, {
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        })
      } catch {
        return c.text("Not Found", 404)
      }
    }

    app.get("/", handle)
    app.get("/*", handle)

    return app
  }
}
