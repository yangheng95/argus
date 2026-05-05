/**
 * UI test for the per-row Export button + sidebar Import button.
 *
 * Boots a stub backend that:
 *   - serves the built overlay shell (vite dist) as /ui/*
 *   - returns a single completed task on /global/tasks
 *   - responds to GET  /export/task/:id/archive with a tiny zip blob
 *   - responds to POST /export/import with a synthetic ImportSummary JSON
 *
 * Then drives the headless browser to:
 *   1. wait for the task row to mount
 *   2. click the Export button → assert anchor.click() with a blob: href
 *   3. verify the visible overwrite checkbox defaults off
 *   4. set a File on the hidden file input → assert POST /export/import
 *      lands with the right query string and overwrite=false
 */

import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

const directory = "D:/overlay/workspace/app"

test("task row exposes export button + sidebar exposes import file picker", async () => {
  const now = Date.now()
  const task = {
    id: "task-1",
    title: "Archive demo",
    directory,
    status: "completed",
    sessionID: "session-1",
    time: { created: now - 20_000, updated: now - 1_000 },
  }
  const board = {
    task,
    run: { executor: "mirrorcode", phase: "complete" },
    overview: { headline: "Archive demo", summary: "demo", controls: {} },
    plan: null, spec: null, evaluation: null, delivery: null, interactions: [],
  }
  const send = (value: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(value), {
      ...init,
      headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers || {}) },
    })

  const importCalls: Array<{ method: string; query: string; bodyBytes: number; contentType: string }> = []

  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname.replace(/\/+$/, "") || "/"
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse

      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
      if (path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
      if (path === "/session") return send([])
      if (path === "/config/prompt") return send([])
      if (path === "/path") return send({ directory })
      if (path === "/vcs") return send({
        branch: "dev", clean: true, dirty: false,
        staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0,
      })
      if (path === "/config") return send({})
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/agent") return send([])
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/channel") return send([])
      if (path === "/executor") return send([{
        id: "mirrorcode", label: "OpenCorvus", detail: "Bundled",
        version: "0.0.1-alpha", selectable: true, discovered: true,
      }])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log/tail") return send({ path: "D:/overlay/logs/server.log", lines: [] })
      if (path === "/log" && req.method === "POST") return send(true)
      if (path === "/task/events" || path === "/task/task-1/events") {
        return new Response(":\n\n", {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        })
      }
      if (path === "/task/task-1/board") return send(board)

      if (path === "/export/task/task-1/archive") {
        // Return a non-empty body so toBlob() produces a real download.
        // The PK\x03\x04 prefix is enough to look like a zip; the test
        // only asserts that the browser was handed a blob URL.
        const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x10, 0x20, 0x30])
        return new Response(payload, {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="task-task-1.zip"`,
            "content-length": String(payload.length),
          },
        })
      }
      if (path === "/export/import" && req.method === "POST") {
        const buf = await req.arrayBuffer()
        importCalls.push({
          method: req.method,
          query: url.search,
          bodyBytes: buf.byteLength,
          contentType: req.headers.get("content-type") || "",
        })
        return send({
          taskID: "tsk_imported",
          importedFromTaskID: "tsk_source",
          restoredFiles: 3,
          skippedFiles: [],
          directory,
        }, { status: 201 })
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } })
    },
  })

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    const base = `http://127.0.0.1:${server.port}`
    await page.evaluateOnNewDocument((serverUrl) => {
      // Capture every anchor.click() for download verification.
      const downloads: Array<{ href: string; download: string }> = []
      ;(window as unknown as { __downloads: typeof downloads }).__downloads = downloads
      const origCreateElement = document.createElement.bind(document)
      ;(document as unknown as { createElement: typeof origCreateElement }).createElement = ((
        tag: string,
        opts?: ElementCreationOptions,
      ) => {
        const el = origCreateElement(tag, opts)
        if (tag === "a") {
          const origClick = (el as HTMLAnchorElement).click.bind(el)
          ;(el as HTMLAnchorElement).click = function () {
            downloads.push({
              href: (el as HTMLAnchorElement).href,
              download: (el as HTMLAnchorElement).download,
            })
            // Don't actually click — headless Chrome would attempt to
            // navigate to the blob URL and may save a file we don't want.
          }
          // Keep origClick referenced so the unused-var linter stays quiet.
          void origClick
        }
        return el
      }) as typeof origCreateElement

      // Stub Tauri so the overlay's host transport thinks it's running
      // inside the desktop app and reads the seeded directory.
      ;(window as unknown as Record<string, unknown>).__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return { serverUrl, autoServer: false, directory: "D:/overlay/workspace/app" }
            }
            if (command === "overlay_settings_save") return true
            if (command === "overlay_open_url" || command === "overlay_open_path") return true
            if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined, minimize: async () => undefined,
              startDragging: async () => undefined, isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, base)

    const url = `${base}/ui/index.html`
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20_000 })

    // Wait for the task row to mount.
    await page.waitForSelector('[data-task-export="task-1"]', { timeout: 20_000 })

    // Screenshot the populated state — proves both Import button (sidebar
    // header) and Export button (task row hover state) render. Hovering the
    // row reveals the action cluster (per CSS opacity rule). We write into
    // the OS temp dir so the test never dirties the repo; set
    // OVERLAY_UI_SCREENSHOT_DIR to a checked-in path when iterating on
    // visuals.
    await page.hover('[data-task-export="task-1"]')
    await new Promise((r) => setTimeout(r, 200))
    const screenshotDir =
      process.env.OVERLAY_UI_SCREENSHOT_DIR || (process.env.TEMP ?? process.env.TMPDIR ?? "/tmp")
    const screenshotPath = `${screenshotDir}/overlay-task-archive-ui.png`
    await page.screenshot({ path: screenshotPath as `${string}.png`, fullPage: false })

    // ── Export ──
    await page.click('[data-task-export="task-1"]')
    // The async export handler awaits a fetch → setBusy(false) before returning.
    // Wait until the captured download lands.
    await page.waitForFunction(
      () => ((window as unknown as { __downloads: Array<{ href: string }> }).__downloads || []).length > 0,
      { timeout: 5_000 },
    )
    const downloads = await page.evaluate(
      () => (window as unknown as { __downloads: Array<{ href: string; download: string }> }).__downloads,
    )
    expect(downloads.length).toBe(1)
    expect(downloads[0]!.href.startsWith("blob:")).toBe(true)
    expect(downloads[0]!.download).toBe("task-task-1.zip")
    await page.waitForSelector('[data-notification-id="task-archive:export:task-1"][data-tone="success"]', {
      timeout: 5_000,
    })

    // ── Import ──
    // Set a small zip via DataTransfer + file input. This is the only way
    // to populate <input type="file"> in headless mode without an OS dialog.
    const fileInput = await page.$('[data-testid="task-import-input"]')
    if (!fileInput) throw new Error("Import input not mounted")
    const overwriteDefault = await page.$eval(
      "[data-task-import-overwrite]",
      (el) => (el as HTMLInputElement).checked,
    )
    expect(overwriteDefault).toBe(false)
    // puppeteer's uploadFile expects a path on disk — write a temp file.
    const tmpZip = `${process.env.TEMP || "/tmp"}/overlay-import-test-${Date.now()}.zip`
    await Bun.write(tmpZip, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x05, 0x06]))

    await fileInput.uploadFile(tmpZip)

    // Wait for the import POST to land on the stub.
    const start = Date.now()
    while (importCalls.length === 0 && Date.now() - start < 5_000) {
      await new Promise((r) => setTimeout(r, 50))
    }

    expect(importCalls.length).toBe(1)
    expect(importCalls[0]!.method).toBe("POST")
    expect(importCalls[0]!.contentType).toContain("application/zip")
    expect(importCalls[0]!.bodyBytes).toBeGreaterThan(0)
    expect(importCalls[0]!.query).toContain(`directory=${encodeURIComponent(directory)}`)
    expect(importCalls[0]!.query).toContain("overwrite=false")
    await page.waitForSelector('[data-notification-id="task-archive:import"][data-tone="success"]', {
      timeout: 5_000,
    })
  } finally {
    await browser.close()
    server.stop()
  }
}, 60_000)
