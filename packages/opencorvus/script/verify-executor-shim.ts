#!/usr/bin/env bun
/**
 * Tiny Bun HTTP server that serves packages/overlay/dist-vite/* and stubs
 * the JSON endpoints ExecutorSelector reads at boot:
 *   GET /executor → canonical 3-entry list (mirrors server/routes/executor.ts)
 *   GET /config/providers → minimal provider catalog with one model each
 * Used by verify-executor-selector.ts to exercise the chip without booting
 * the full opencorvus runtime.
 */

import { serve } from "bun"
import path from "node:path"
import fs from "node:fs"

const root = path.resolve(import.meta.dir, "../../overlay/dist-vite")
const port = Number(process.env.PORT || 5599)

const executors = [
  {
    id: "opencorvus",
    label: "OpenCorvus",
    registered: true,
    discovered: true,
    selectable: true,
    detail: "shim",
    version: "0.0.0",
  },
  {
    id: "codex",
    label: "Codex",
    registered: true,
    discovered: true,
    selectable: true,
    detail: "shim",
    version: "0.0.0",
    model: "gpt-5",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    registered: true,
    discovered: true,
    selectable: true,
    detail: "shim",
    version: "0.0.0",
    model: "claude-sonnet-4-6",
  },
]

const providerCatalog = {
  all: [
    {
      id: "openai",
      models: { "gpt-5": { id: "gpt-5" }, "gpt-4o": { id: "gpt-4o" } },
    },
    {
      id: "anthropic",
      models: {
        "claude-sonnet-4-6": { id: "claude-sonnet-4-6" },
        "claude-opus-4-7": { id: "claude-opus-4-7" },
      },
    },
  ],
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
}

serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url)
    console.log(`[shim] ${req.method} ${url.pathname}`)
    // Stubbed JSON endpoints — minimal shapes the overlay's init path
    // probes before it lets ExecutorSelector hydrate.
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
    if (url.pathname === "/executor") return json(executors)
    if (url.pathname === "/config/providers") return json(providerCatalog)
    if (url.pathname === "/global/health") return json({ ok: true })
    if (url.pathname === "/config") return json({})
    if (url.pathname === "/provider") return json(providerCatalog)
    if (url.pathname === "/provider/auth") return json({})
    if (url.pathname === "/channel") return json([])
    if (url.pathname === "/config/prompt") return json([])
    if (url.pathname === "/path") return json({ directory: "" })
    if (url.pathname === "/vcs") return json(null)
    if (url.pathname === "/skill" || url.pathname === "/skill/installed") return json([])
    if (url.pathname === "/mcp") return json([])
    if (url.pathname === "/task") return json([])
    // Serve the SPA under /ui/ so api.ts's DEFAULT_SERVER detection
    // (window.location.pathname.startsWith("/ui")) routes API calls back
    // to this same origin instead of the hardcoded local 7878.
    let p = url.pathname
    if (p === "/" || p === "/ui" || p === "/ui/") p = "/index.html"
    if (p.startsWith("/ui/")) p = p.slice("/ui".length)
    const fp = path.join(root, p)
    if (!fp.startsWith(root) || !fs.existsSync(fp)) {
      // SPA history route rewrite to index.html.
      const idx = path.join(root, "index.html")
      if (fs.existsSync(idx)) {
        return new Response(fs.readFileSync(idx), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }
      return new Response("not found", { status: 404 })
    }
    const ext = path.extname(fp)
    return new Response(fs.readFileSync(fp), {
      headers: { "content-type": mime[ext] || "application/octet-stream" },
    })
  },
})
console.log(`shim up at http://127.0.0.1:${port} serving ${root}`)
