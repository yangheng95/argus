import { Hono } from "hono"
import path from "path"
import fs from "fs"
import { Installation } from "../installation"

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

  // 2. Dev mode: resolve from the opencorvus package root → sibling overlay package
  if (Installation.isLocal()) {
    // import.meta.dir = .../packages/opencorvus/src/server
    const pkgRoot = import.meta.dir.replace(/[/\\]src[/\\]server$/, "")
    const devUi = path.resolve(pkgRoot, "../overlay/src")
    if (fs.existsSync(path.join(devUi, "index.html"))) return devUi
  }
  return undefined
}

export namespace OverlayUI {
  export function routes() {
    const app = new Hono()

    app.get("/*", async (c) => {
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
          // SPA fallback
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
    })

    return app
  }
}
