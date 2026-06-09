import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

test("right toolbar Diff returns to the diff subview after the user switches to Changes", async () => {
  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs")
        return send({
          branch: "dev",
          clean: false,
          dirty: true,
          staged: 0,
          modified: 1,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      if (path === "/vcs/diff") {
        return send([
          {
            file: "src/live-file.ts",
            patch: [
              "Index: src/live-file.ts",
              "===================================================================",
              "--- src/live-file.ts",
              "+++ src/live-file.ts",
              "@@ -1,2 +1,3 @@",
              " export const value = 1;",
              "+export const next = 2;",
              " export const end = true;",
              "",
            ].join("\n"),
            additions: 1,
            deletions: 0,
            status: "modified",
          },
        ])
      }
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/config") return send({ model: "" })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/file") return send({ entries: [] })
      if (path === "/find/file") return send({ entries: [] })
      return send({})
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
      localStorage.setItem("oc_right_panel_collapsed", "false")
    }, server.port)

    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="diff"]')

    await page.evaluate(() => {
      ;(window as any).openWorkspaceDiff({ filePath: "src/live-file.ts" })
    })
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>(".file-changes-panel")?.dataset.activeView === "diff",
    )

    await page.$eval(".file-changes-tab", (node) => (node as HTMLButtonElement).click())
    expect(await page.$eval(".file-changes-panel", (node) => (node as HTMLElement).dataset.activeView)).toBe("changes")

    await page.$eval('[data-ui="side-activity-button"][data-side="right"][data-activity="diff"]', (node) =>
      (node as HTMLButtonElement).click(),
    )
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>(".file-changes-panel")?.dataset.activeView === "diff",
    )

    const state = await page.evaluate(() => ({
      centerDiff: document.querySelector<HTMLElement>("#centerWorkbenchDiff")?.dataset.active ?? "",
      toolbarDiff:
        document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="diff"]')
          ?.dataset.active ?? "",
      fileChangesView: document.querySelector<HTMLElement>(".file-changes-panel")?.dataset.activeView ?? "",
    }))
    expect(state).toEqual({
      centerDiff: "true",
      toolbarDiff: "true",
      fileChangesView: "diff",
    })
  } finally {
    await browser.close()
    server.stop(true)
  }
})
