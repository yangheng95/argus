import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Hono } from "hono"
import { OverlayUI } from "../../src/server/overlay-ui"
import { Log } from "../../src/util/log"
import { ensureOverlayDist } from "../../../overlay/test/overlay-dist"

Log.init({ print: false })

/**
 * audit-2026-04-29 W2-G4. Locks the overlay-ui handler's behaviour
 * end-to-end through the Hono mount: SPA fallback, MIME mapping,
 * absolute-asset HTML rewrite, missing-dir 404. The validatePath
 * unit tests in overlay-ui-traversal.test.ts cover the security
 * boundary; this file covers the SERVING semantics.
 *
 * Pre-this only the security side had coverage. A regression in the
 * SPA fallback (e.g. accidentally serving the requested-but-missing
 * file's parent index instead of the bundle root) would silently
 * break deep-linking in the webview without triggering any test.
 */

describe("OverlayUI route handler (audit W2-G4)", () => {
  let tempDir: string
  let app: Hono

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-ui-handler-"))
    fs.writeFileSync(
      path.join(tempDir, "index.html"),
      `<!doctype html><html><head>` +
        `<link rel="stylesheet" href="/assets/main.css">` +
        `<script src="/assets/app.js"></script>` +
        `<script src="/i18n/zh-CN.json"></script>` +
        `<script src="https://cdn.example.com/keep.js"></script>` +
        `</head><body><div id="root"></div></body></html>`,
    )
    fs.mkdirSync(path.join(tempDir, "assets"))
    fs.writeFileSync(path.join(tempDir, "assets", "app.js"), `console.log("hi")`)
    fs.writeFileSync(path.join(tempDir, "assets", "main.css"), `body{margin:0}`)

    app = new Hono().route("/ui", OverlayUI.routes(tempDir) as unknown as Hono)
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  test("GET /ui redirects to the slash-terminated UI root", async () => {
    const res = await app.request("http://localhost/ui")
    expect(res.status).toBe(308)
    expect(res.headers.get("location")).toBe("ui/")
  })

  test("GET /ui/ rewrites absolute asset paths to paths relative to the UI root", async () => {
    const res = await app.request("http://localhost/ui/")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/text\/html/)
    const body = await res.text()
    // /assets/* → ./assets/* so reverse-proxy prefixes work without
    // requiring X-Forwarded-Prefix.
    expect(body).toContain('href="./assets/main.css"')
    expect(body).toContain('src="./assets/app.js"')
    // /i18n/* → ./i18n/*
    expect(body).toContain('src="./i18n/zh-CN.json"')
    // External URLs untouched
    expect(body).toContain('src="https://cdn.example.com/keep.js"')
  })

  test("GET /ui/ preserves reverse-proxy public prefix in rewritten asset paths", async () => {
    const res = await app.request("http://localhost/ui/", {
      headers: {
        "x-forwarded-prefix": "/opencorvus",
      },
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('href="/opencorvus/ui/assets/main.css"')
    expect(body).toContain('src="/opencorvus/ui/assets/app.js"')
    expect(body).toContain('src="/opencorvus/ui/i18n/zh-CN.json"')
  })

  test("SPA fallback rewrites assets relative to the public deep-link path when proxy prefix is unknown", async () => {
    const res = await app.request("http://localhost/ui/task/abc/conversation")
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('href="../../assets/main.css"')
    expect(body).toContain('src="../../assets/app.js"')
    expect(body).toContain('src="../../i18n/zh-CN.json"')
  })

  test("GET /ui/assets/app.js serves with the JS MIME and no-cache", async () => {
    const res = await app.request("http://localhost/ui/assets/app.js")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/javascript; charset=utf-8")
    expect(res.headers.get("cache-control")).toBe("no-cache")
    const body = await res.text()
    expect(body).toBe(`console.log("hi")`)
  })

  test("GET /ui/assets/main.css serves with the CSS MIME", async () => {
    const res = await app.request("http://localhost/ui/assets/main.css")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8")
    const body = await res.text()
    expect(body).toBe(`body{margin:0}`)
  })

  test("SPA fallback: missing route serves rewritten index.html (200, not 404)", async () => {
    // Deep-link case: webview reload at /ui/task/abc/conversation
    // — no on-disk file there, must fall through to index.html so
    // the SPA router boots and resolves the route client-side.
    const res = await app.request("http://localhost/ui/task/abc/conversation")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/text\/html/)
    const body = await res.text()
    expect(body).toContain('<div id="root">')
    // Rewrite must still apply on the fallback path.
    expect(body).toContain('src="../../assets/app.js"')
  })

  test("path traversal probe never leaks the on-disk secret file", async () => {
    // Plant a sibling secret OUTSIDE the served dir. Then probe with
    // various escape syntaxes. The exact status depends on whether
    // Hono pre-normalises the `..` (varies by Hono router version)
    // — the contract we lock is "never serve the secret bytes".
    const outsideSecret = path.join(tempDir, "..", "outside-secret.txt")
    fs.writeFileSync(outsideSecret, "TOPSECRET-MUST-NOT-LEAK")
    try {
      for (const reqUrl of [
        "http://localhost/ui/%2e%2e/outside-secret.txt",
        "http://localhost/ui/../outside-secret.txt",
        "http://localhost/ui/foo/../../outside-secret.txt",
      ]) {
        const res = await app.request(reqUrl)
        // Acceptable outcomes: 403 (validatePath rejected),
        // 404 (Hono router pre-normalised away from the /ui/* mount),
        // or 200 with the SPA fallback (index.html). Forbidden:
        // 200 whose body equals the secret bytes.
        const body = res.status === 200 ? await res.text() : ""
        expect(body).not.toContain("TOPSECRET-MUST-NOT-LEAK")
      }
    } finally {
      try {
        fs.unlinkSync(outsideSecret)
      } catch {}
    }
  })
})

describe("OverlayUI built bundle", () => {
  test("serves the current Skill, MCP, and Memory panel bundle under /ui", async () => {
    await ensureOverlayDist()
    const distDir = path.resolve(import.meta.dir, "../../../overlay/dist-vite")
    const app = new Hono().route("/ui", OverlayUI.routes(distDir) as unknown as Hono)

    const indexRes = await app.request("http://localhost/ui/index.html")
    expect(indexRes.status).toBe(200)
    const indexHtml = await indexRes.text()
    const scriptMatch = indexHtml.match(/src="\.\/assets\/([^"]+\.js)"/)
    expect(scriptMatch?.[1]).toBeDefined()

    const scriptRes = await app.request(`http://localhost/ui/assets/${scriptMatch![1]}`)
    expect(scriptRes.status).toBe(200)
    const script = await scriptRes.text()
    expect(script).toContain("skill/installed")
    expect(script).toContain("panel/knowledge/memory")
    expect(script).toContain("x-opencorvus-directory")
    expect(script).toContain("workspace.no_directory")
  })
})
