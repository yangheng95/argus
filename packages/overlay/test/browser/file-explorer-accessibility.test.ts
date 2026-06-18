import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

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

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

const promptProfileCatalog = {
  active: "general",
  project_active: "general",
  session_active: null,
  default: "general",
  targets: [],
  profiles: [
    {
      id: "general",
      label: "General",
      description: "Default prompt profile",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

test("file explorer current file and directory expansion are exposed on the row buttons", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requestLog: string[] = []
  const uploadBodies: Array<{ targetDir: string; files: Array<{ name: string; contentBase64: string }> }> = []
  const uploadedSrcFiles: Array<{ name: string; path: string; absolute: string; type: "file"; ignored: boolean }> = []
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push(`${req.method} ${path}${url.search}`)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission") return send([])
    if (path === "/session") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/vcs")
      return send({
        branch: "dev",
        clean: true,
        dirty: false,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile") return send(promptProfileCatalog)
    if (path === "/terminal/profiles") {
      return send({
        defaultProfileID: "powershell",
        profiles: [{ id: "powershell", label: "PowerShell", icon: "powershell" }],
      })
    }
    if (path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/file") {
      const requestedPath = url.searchParams.get("path") ?? ""
      if (requestedPath === "") {
        return send([
          {
            name: "src",
            path: "src",
            absolute: "D:/overlay/workspace/app/src",
            type: "directory",
            ignored: false,
          },
          {
            name: "README.md",
            path: "README.md",
            absolute: "D:/overlay/workspace/app/README.md",
            type: "file",
            ignored: false,
          },
        ])
      }
      if (requestedPath === "src") {
        return send([
          {
            name: "main.tsx",
            path: "src/main.tsx",
            absolute: "D:/overlay/workspace/app/src/main.tsx",
            type: "file",
            ignored: false,
          },
          ...uploadedSrcFiles,
        ])
      }
      return send([])
    }
    if (path === "/file/upload" && req.method === "POST") {
      const body = (await req.json()) as { targetDir: string; files: Array<{ name: string; contentBase64: string }> }
      uploadBodies.push(body)
      for (const file of body.files) {
        uploadedSrcFiles.push({
          name: file.name,
          path: `${body.targetDir}/${file.name}`,
          absolute: `D:/overlay/workspace/app/${body.targetDir}/${file.name}`,
          type: "file",
          ignored: false,
        })
      }
      return send(
        body.files.map((file) => ({
          name: file.name,
          path: `${body.targetDir}/${file.name}`,
          bytes: Buffer.from(file.contentBase64, "base64").byteLength,
        })),
      )
    }
    if (path === "/find/file") return send(["src/main.tsx"])
    if (path === "/file/content") return send({ type: "text", content: "export const file = true;\n" })
    if (path === "/task/events") return eventStream()
    return send({})
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on("console", (item) => {
      if (item.type() === "error") consoleErrors.push(item.text())
    })
    page.on("pageerror", (error) => {
      pageErrors.push(`${error.message}\n${error.stack ?? ""}`)
    })
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_right_panel_collapsed", "false")
    }, server.origin)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
    await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })

    const initialState = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(".file-explorer-list")
      const src = document.querySelector<HTMLButtonElement>('.file-explorer-row[title="src"]')
      const readme = document.querySelector<HTMLButtonElement>('.file-explorer-row[title="README.md"]')
      return {
        centerExplorer: document.querySelector<HTMLElement>("#centerWorkbenchExplorer")?.dataset.active ?? "",
        listRole: list?.getAttribute("role") ?? null,
        treeItems: document.querySelectorAll('[role="treeitem"]').length,
        srcExpanded: src?.getAttribute("aria-expanded") ?? null,
        readmeCurrent: readme?.getAttribute("aria-current") ?? null,
        readmeSelected: readme?.getAttribute("aria-selected") ?? null,
      }
    })
    assert.deepEqual(initialState, {
      centerExplorer: "true",
      listRole: null,
      treeItems: 0,
      srcExpanded: "false",
      readmeCurrent: null,
      readmeSelected: null,
    })

    await page.click('.file-explorer-row[title="src"]')
    await page.waitForSelector('.file-explorer-row[title="src/main.tsx"]', { visible: true })
    await page.click('.file-explorer-row[title="src/main.tsx"]')
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>('.file-explorer-row[title="src/main.tsx"]')?.dataset.active === "true" &&
        document.querySelector<HTMLElement>("#centerWorkbenchFile")?.dataset.open === "true",
    )

    const selectedState = await page.evaluate(() => {
      const src = document.querySelector<HTMLButtonElement>('.file-explorer-row[title="src"]')
      const main = document.querySelector<HTMLButtonElement>('.file-explorer-row[title="src/main.tsx"]')
      const readme = document.querySelector<HTMLButtonElement>('.file-explorer-row[title="README.md"]')
      const explorer = document.querySelector<HTMLElement>("#centerWorkbenchExplorer")
      const explorerBox = explorer?.getBoundingClientRect()
      return {
        srcExpanded: src?.getAttribute("aria-expanded") ?? null,
        mainActive: main?.dataset.active ?? "",
        mainCurrent: main?.getAttribute("aria-current") ?? null,
        mainExpanded: main?.getAttribute("aria-expanded") ?? null,
        mainSelected: main?.getAttribute("aria-selected") ?? null,
        readmeCurrent: readme?.getAttribute("aria-current") ?? null,
        filePanelOpen: document.querySelector<HTMLElement>("#centerWorkbenchFile")?.dataset.open ?? "",
        errorNotifications: Array.from(
          document.querySelectorAll<HTMLElement>('.app-notification[data-tone="error"] .app-notification__message'),
        ).map((node) => node.textContent?.trim() ?? ""),
        explorerBox: explorerBox ? { width: explorerBox.width, height: explorerBox.height } : null,
      }
    })
    assert.deepEqual(
      {
        srcExpanded: selectedState.srcExpanded,
        mainActive: selectedState.mainActive,
        mainCurrent: selectedState.mainCurrent,
        mainExpanded: selectedState.mainExpanded,
        mainSelected: selectedState.mainSelected,
        readmeCurrent: selectedState.readmeCurrent,
        filePanelOpen: selectedState.filePanelOpen,
        errorNotifications: selectedState.errorNotifications,
      },
      {
        srcExpanded: "true",
        mainActive: "true",
        mainCurrent: "true",
        mainExpanded: null,
        mainSelected: null,
        readmeCurrent: null,
        filePanelOpen: "true",
        errorNotifications: [],
      },
      JSON.stringify({ selectedState, pageErrors, consoleErrors, requestLog }, null, 2),
    )
    assert.ok((selectedState.explorerBox?.width ?? 0) > 240)
    assert.ok((selectedState.explorerBox?.height ?? 0) > 240)

    await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('.file-explorer-row[title="src"]')
      if (!target) throw new Error("src row missing")
      const transfer = new DataTransfer()
      transfer.items.add(new File(["from browser"], "uploaded-from-browser.txt", { type: "text/plain" }))
      target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }))
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }))
    })
    await page.waitForSelector('.file-explorer-row[title="src"][data-upload-target="true"]')
    const uploadScreenshotPath = resolve(".scratch/file-explorer-upload-dropzone.png")
    mkdirSync(dirname(uploadScreenshotPath), { recursive: true })
    const explorerElementForUpload = await page.$("#centerWorkbenchExplorer")
    assert.ok(explorerElementForUpload)
    writeFileSync(uploadScreenshotPath, await explorerElementForUpload.screenshot({}))

    await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('.file-explorer-row[title="src"]')
      if (!target) throw new Error("src row missing")
      const transfer = new DataTransfer()
      transfer.items.add(new File(["from browser"], "uploaded-from-browser.txt", { type: "text/plain" }))
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }))
    })
    await page.waitForSelector('.file-explorer-row[title="src/uploaded-from-browser.txt"]', { visible: true })
    assert.equal(uploadBodies.length, 1)
    assert.equal(uploadBodies[0]?.targetDir, "src")
    assert.equal(uploadBodies[0]?.files[0]?.name, "uploaded-from-browser.txt")
    assert.equal(
      Buffer.from(uploadBodies[0]?.files[0]?.contentBase64 ?? "", "base64").toString("utf-8"),
      "from browser",
    )
    assert.ok(
      requestLog.some((entry) => entry.startsWith("POST /file/upload?directory=D%3A%2Foverlay%2Fworkspace%2Fapp")),
    )

    const screenshotPath = resolve(".scratch/file-explorer-accessibility.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    const explorerElement = await page.$("#centerWorkbenchExplorer")
    assert.ok(explorerElement)
    const screenshot = await explorerElement.screenshot({})
    assert.ok(screenshot.length > 0)
    writeFileSync(screenshotPath, screenshot)
  } finally {
    await browser.close()
    await server.close()
  }
})
