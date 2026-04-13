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

  // 2. Dev vite build: packages/overlay/dist-vite has bundled JS that browsers can execute.
  // Prefer this over raw src/ which serves .tsx that the browser cannot evaluate.
  const viteUi = path.resolve(pkgRoot, "../overlay/dist-vite")
  if (fs.existsSync(path.join(viteUi, "index.html"))) return viteUi

  // 3. Source fallback: only useful when something else transpiles .tsx on the fly
  const devUi = path.resolve(pkgRoot, "../overlay/src")
  if (fs.existsSync(path.join(devUi, "index.html"))) return devUi

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
        return c.text("Overlay UI not found. Run build with overlay assets or start in dev mode.", 404)
      }

      let reqPath = c.req.path.replace(/^\/ui/, "") || "/"
      if (reqPath === "/") reqPath = "/index.html"

      const filePath = path.join(dir, reqPath)
      // Prevent directory traversal
      if (!filePath.startsWith(dir)) return c.text("Forbidden", 403)

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
