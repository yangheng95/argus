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

let _overlayDirCache: string | null | undefined = undefined

function resolveOverlayDir(): string | undefined {
  if (_overlayDirCache !== undefined) return _overlayDirCache ?? undefined
  const binDir = path.dirname(process.execPath)
  const distUi = path.join(binDir, "ui")
  if (fs.existsSync(path.join(distUi, "index.html"))) return (_overlayDirCache = distUi)
  const devUi = path.resolve(process.cwd(), "../overlay/src")
  if (fs.existsSync(path.join(devUi, "index.html"))) return (_overlayDirCache = devUi)
  const repoUi = path.resolve(import.meta.dir, "../../../overlay/src")
  if (fs.existsSync(path.join(repoUi, "index.html"))) return (_overlayDirCache = repoUi)
  _overlayDirCache = null
  return undefined
}

export namespace OverlayUI {
  export function routes() {
    const app = new Hono()

    const handle = async (c: Context) => {
      const dir = resolveOverlayDir()
      if (!dir) {
        return c.text("Overlay UI not found. Run build with overlay assets.", 404)
      }

      let reqPath = c.req.path.replace(/^\/ui/, "") || "/"
      if (reqPath === "/") reqPath = "/index.html"

      const filePath = path.join(dir, reqPath)
      // Prevent directory traversal
      if (!filePath.startsWith(dir + path.sep) && filePath !== dir) return c.text("Forbidden", 403)

      try {
        const file = Bun.file(filePath)
        if (!(await file.exists())) {
          if (path.extname(filePath)) return c.text("Not Found", 404)
          // SPA fallback for client-side routes only
          const index = Bun.file(path.join(dir, "index.html"))
          return c.body(await index.arrayBuffer(), 200, {
            "Content-Type": "text/html; charset=utf-8",
          })
        }
        const ext = path.extname(filePath)
        const contentType = MIME[ext] || "application/octet-stream"
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
