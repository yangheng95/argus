import { Hono, type Context } from "hono"
import path from "path"
import fs from "fs"
import fsp from "fs/promises"

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

  // 2. Workspace bundle: keep runtime and packaged acceptance on the same built UI.
  const viteUi = path.resolve(pkgRoot, "../overlay/dist-vite")
  if (fs.existsSync(path.join(viteUi, "index.html"))) return viteUi

  return undefined
}

export namespace OverlayUI {
  /**
   * Validate that a `/ui/...` request path stays inside the overlay
   * dir. Returns the absolute filesystem path on success, or null
   * when the request must be rejected with 403.
   *
   * Defends against:
   *  - audit-2026-04-29 opencorvus F7 — `..` traversal (literal or
   *    URL-encoded `%2e%2e/`). path.resolve normalises both, then a
   *    `${dir}${sep}` prefix compare blocks sibling-dir leakage
   *    (e.g. `/foo/ui-private/secret` no longer satisfies a naive
   *    `startsWith("/foo/ui")`).
   *  - audit-2026-04-29 opencorvus V6.a — NUL byte poisoning.
   *    Bun.file / Node fs treat the NUL terminator inconsistently;
   *    `path.resolve(dir, "./index.html\0/etc/passwd")` may serve
   *    either depending on libc. Reject up-front rather than picking
   *    a side.
   *  - audit-2026-04-29 opencorvus V6.b — symlink escape. Once the
   *    resolved path is inside dir, a malicious symlink at that path
   *    pointing outside (e.g. planted by a tampered VSIX or a
   *    misconfigured dev tree) would still leak the target's bytes
   *    via Bun.file's transparent follow. realpath comparison closes
   *    the gap; for non-existent paths we let the handler fall
   *    through to its SPA index.html fallback (no escape there
   *    because we re-validate inside the resolved dir).
   *
   * Note: input `reqPath` is already URL-decoded by Hono's parser
   * (so `%2e%2e/` arrives as `../`, `%00` arrives as `\0`).
   */
  export async function validatePath(dir: string, reqPath: string): Promise<string | null> {
    if (reqPath.includes("\0")) return null
    const resolved = path.resolve(dir, "." + reqPath)
    const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep
    if (resolved !== dir && !resolved.startsWith(dirWithSep)) return null
    // realpath throws ENOENT on non-existent paths; the SPA fallback
    // handler handles that case downstream by serving index.html.
    // For any OTHER error (EACCES on a hostile symlink target,
    // ELOOP on a cycle), fail closed — refuse the request.
    try {
      const realFile = await fsp.realpath(resolved)
      const realDir = await fsp.realpath(dir)
      const realDirWithSep = realDir.endsWith(path.sep) ? realDir : realDir + path.sep
      if (realFile !== realDir && !realFile.startsWith(realDirWithSep)) return null
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT" && code !== "ENOTDIR") return null
    }
    return resolved
  }

  /**
   * `dirOverride` is a test-only seam — production callers pass no
   * argument and resolveOverlayDir's exec-path probing kicks in.
   * Tests can supply a fixture dir without monkey-patching
   * `process.execPath` (CLAUDE.md §五-23: prefer fixing tools over
   * fragile mocks).
   */
  export function routes(dirOverride?: string) {
    const app = new Hono()

    // vite builds HTML with absolute asset paths (e.g. `/assets/...`).
    // When served under `/ui/`, those paths miss the mount point. Rewrite
    // them so links resolve under the overlay route.
    const rewriteHtmlAssets = (html: string): string =>
      html
        .replace(/(src|href)="\/(assets|i18n)\//g, '$1="/ui/$2/')

    const handle = async (c: Context) => {
      const dir = dirOverride ?? resolveOverlayDir()
      if (!dir) {
        return c.text("Overlay UI not found. Run `bun run --cwd packages/overlay build:vite` or package with bundled UI assets.", 404)
      }

      let reqPath = c.req.path.replace(/^\/ui/, "") || "/"
      if (reqPath === "/") reqPath = "/index.html"

      const filePath = await validatePath(dir, reqPath)
      if (filePath === null) {
        return c.text("Forbidden", 403)
      }

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
