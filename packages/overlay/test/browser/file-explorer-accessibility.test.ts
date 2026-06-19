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

    await page.focus(".file-explorer-search-input")
    const searchFocusState = await page.$eval(".file-explorer-search-input", (node) => {
      const input = node as HTMLInputElement
      const field = input.closest(".file-explorer-search") as HTMLElement | null
      const inputStyles = getComputedStyle(input)
      const fieldStyles = field ? getComputedStyle(field) : null
      return {
        active: document.activeElement === input,
        inputClassName: input.className,
        hasFieldInputClass: input.classList.contains("field-input"),
        fieldClassName: field?.className ?? "",
        inputBoxShadow: inputStyles.boxShadow,
        inputBorderWidth: inputStyles.borderWidth,
        inputBackground: inputStyles.backgroundColor,
        fieldBoxShadow: fieldStyles?.boxShadow ?? "",
      }
    })
    assert.equal(searchFocusState.active, true)
    assert.match(searchFocusState.inputClassName, /\bsearch-field-input\b/)
    assert.equal(searchFocusState.hasFieldInputClass, false)
    assert.match(searchFocusState.fieldClassName, /\bsearch-field\b/)
    assert.equal(searchFocusState.inputBoxShadow, "none")
    assert.equal(searchFocusState.inputBorderWidth, "0px")
    assert.equal(searchFocusState.inputBackground, "rgba(0, 0, 0, 0)")
    assert.notEqual(searchFocusState.fieldBoxShadow, "none")

    const searchFocusScreenshotPath = resolve(".scratch/file-explorer-search-field-focus.png")
    mkdirSync(dirname(searchFocusScreenshotPath), { recursive: true })
    const explorerElementForSearchFocus = await page.$("#centerWorkbenchExplorer")
    assert.ok(explorerElementForSearchFocus)
    writeFileSync(searchFocusScreenshotPath, await explorerElementForSearchFocus.screenshot({}))

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

    const srcRowSelector = '.file-explorer-row[title="src"]'
    const readmeRowSelector = '.file-explorer-row[title="README.md"]'
    let srcFocusedByKeyboard = false
    for (let idx = 0; idx < 120; idx += 1) {
      await page.keyboard.press("Tab")
      srcFocusedByKeyboard = await page.$eval(srcRowSelector, (node) => document.activeElement === node)
      if (srcFocusedByKeyboard) break
    }
    assert.equal(srcFocusedByKeyboard, true)
    const srcFocusState = await page.$eval(srcRowSelector, (node) => {
      const element = node as HTMLElement
      const styles = getComputedStyle(element)
      return {
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
      }
    })
    assert.equal(srcFocusState.focusVisible, true)
    assert.notEqual(srcFocusState.outlineStyle, "none")
    assert.notEqual(srcFocusState.outlineWidth, "0px")

    await page.keyboard.press("Enter")
    await page.waitForSelector('.file-explorer-row[title="src/main.tsx"]', { visible: true })
    await page.waitForFunction(
      () => document.querySelector<HTMLButtonElement>('.file-explorer-row[title="src"]')?.getAttribute("aria-expanded") === "true",
    )

    let readmeFocusedByKeyboard = false
    for (let idx = 0; idx < 120; idx += 1) {
      await page.keyboard.press("Tab")
      readmeFocusedByKeyboard = await page.$eval(readmeRowSelector, (node) => document.activeElement === node)
      if (readmeFocusedByKeyboard) break
    }
    assert.equal(readmeFocusedByKeyboard, true)
    const readmeFocusState = await page.$eval(readmeRowSelector, (node) => {
      const element = node as HTMLElement
      const styles = getComputedStyle(element)
      return {
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
      }
    })
    assert.equal(readmeFocusState.focusVisible, true)
    assert.notEqual(readmeFocusState.outlineStyle, "none")
    assert.notEqual(readmeFocusState.outlineWidth, "0px")

    const rowFocusScreenshotPath = resolve(".scratch/file-explorer-row-focus-visible.png")
    mkdirSync(dirname(rowFocusScreenshotPath), { recursive: true })
    const explorerElementForRowFocus = await page.$("#centerWorkbenchExplorer")
    assert.ok(explorerElementForRowFocus)
    writeFileSync(rowFocusScreenshotPath, await explorerElementForRowFocus.screenshot({}))

    await page.keyboard.press("Space")
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>('.file-explorer-row[title="README.md"]')?.dataset.active === "true" &&
        document.querySelector<HTMLElement>("#centerWorkbenchFile")?.dataset.open === "true",
    )
    const readmeKeyboardState = await page.evaluate(() => ({
      active: document.querySelector<HTMLElement>('.file-explorer-row[title="README.md"]')?.dataset.active ?? "",
      current: document.querySelector<HTMLButtonElement>('.file-explorer-row[title="README.md"]')?.getAttribute("aria-current") ?? null,
      filePanelOpen: document.querySelector<HTMLElement>("#centerWorkbenchFile")?.dataset.open ?? "",
    }))
    assert.deepEqual(readmeKeyboardState, {
      active: "true",
      current: "true",
      filePanelOpen: "true",
    })

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

    await page.waitForSelector('.file-editor-pane .oc-button[data-ui="file-editor-save"]', { visible: true })
    await page.waitForFunction(() =>
      document.querySelector<HTMLElement>(".file-editor-pane .cm-content")?.textContent?.includes("export const file"),
    )
    const editorButtonState = await page.evaluate(() => {
      const save = document.querySelector<HTMLButtonElement>('.file-editor-pane .oc-button[data-ui="file-editor-save"]')
      const close = document.querySelector<HTMLButtonElement>('.file-editor-pane .oc-button[data-ui="file-editor-close"]')
      const pane = document.querySelector<HTMLElement>(".file-editor-pane")
      const code = document.querySelector<HTMLElement>(".file-editor-code")
      const editor = document.querySelector<HTMLElement>(".file-editor-pane .cm-editor")
      const line = document.querySelector<HTMLElement>(".file-editor-pane .cm-line")
      const paneBox = pane?.getBoundingClientRect()
      const codeBox = code?.getBoundingClientRect()
      const editorBox = editor?.getBoundingClientRect()
      const lineBox = line?.getBoundingClientRect()
      const lineColor = line ? getComputedStyle(line).color : ""
      const editorBackground = editor ? getComputedStyle(editor).backgroundColor : ""
      return {
        saveClass: save?.className ?? "",
        saveDisabled: save?.disabled ?? null,
        saveSize: save?.dataset.size ?? "",
        saveTone: save?.dataset.tone ?? "",
        closeClass: close?.className ?? "",
        closeChrome: close?.dataset.chrome ?? "",
        closeSize: close?.dataset.size ?? "",
        lineText: line?.textContent ?? "",
        paneBox: paneBox ? { width: paneBox.width, height: paneBox.height } : null,
        codeBox: codeBox ? { width: codeBox.width, height: codeBox.height } : null,
        editorBox: editorBox ? { width: editorBox.width, height: editorBox.height } : null,
        lineBox: lineBox ? { width: lineBox.width, height: lineBox.height } : null,
        lineColor,
        editorBackground,
      }
    })
    assert.deepEqual(
      {
        saveClass: editorButtonState.saveClass,
        saveDisabled: editorButtonState.saveDisabled,
        saveSize: editorButtonState.saveSize,
        saveTone: editorButtonState.saveTone,
        closeClass: editorButtonState.closeClass,
        closeChrome: editorButtonState.closeChrome,
        closeSize: editorButtonState.closeSize,
        lineText: editorButtonState.lineText,
      },
      {
        saveClass: "oc-button",
        saveDisabled: true,
        saveSize: "sm",
        saveTone: "neutral",
        closeClass: "oc-button",
        closeChrome: "icon-action",
        closeSize: "icon",
        lineText: "export const file = true;",
      },
    )
    assert.ok((editorButtonState.paneBox?.height ?? 0) > 300)
    assert.ok((editorButtonState.codeBox?.height ?? 0) > 250)
    assert.ok((editorButtonState.editorBox?.height ?? 0) > 250)
    assert.ok((editorButtonState.lineBox?.width ?? 0) > 100)
    assert.ok((editorButtonState.lineBox?.height ?? 0) > 10)
    assert.notEqual(editorButtonState.lineColor, editorButtonState.editorBackground)

    const fileEditorCloseSelector = '.file-editor-pane .oc-button[data-ui="file-editor-close"]'
    let closeFocusedByKeyboard = false
    for (let idx = 0; idx < 80; idx += 1) {
      await page.keyboard.press("Tab")
      closeFocusedByKeyboard = await page.$eval(fileEditorCloseSelector, (node) => document.activeElement === node)
      if (closeFocusedByKeyboard) break
    }
    assert.equal(closeFocusedByKeyboard, true)
    const closeFocusState = await page.$eval(fileEditorCloseSelector, (node) => {
      const styles = getComputedStyle(node as HTMLElement)
      return {
        focusVisible: (node as HTMLElement).matches(":focus-visible"),
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
      }
    })
    assert.equal(closeFocusState.focusVisible, true)
    assert.notEqual(closeFocusState.outlineStyle, "none")
    assert.notEqual(closeFocusState.outlineWidth, "0px")

    const fileEditorScreenshotPath = resolve(".scratch/file-editor-button-primitive.png")
    mkdirSync(dirname(fileEditorScreenshotPath), { recursive: true })
    const fileEditorElement = await page.$("#centerWorkbenchFile")
    assert.ok(fileEditorElement)
    const fileEditorScreenshot = await fileEditorElement.screenshot({})
    assert.ok(fileEditorScreenshot.length > 0)
    writeFileSync(fileEditorScreenshotPath, fileEditorScreenshot)

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

test("file explorer load-failed retry uses the shared button primitive", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission" || path === "/session") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/vcs") {
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
    }
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile") return send(promptProfileCatalog)
    if (path === "/terminal/profiles") return send({ defaultProfileID: "powershell", profiles: [] })
    if (path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/file") return send({ error: "root directory unavailable" }, { status: 500 })
    if (path === "/task/events") return eventStream()
    return send({})
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "light")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_right_panel_collapsed", "false")
    }, server.origin)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
    const retrySelector = '.file-explorer-empty .oc-button[data-ui="file-explorer-retry"]'
    await page.waitForSelector(retrySelector, { visible: true })

    const retryState = await page.$eval(retrySelector, (node) => {
      const element = node as HTMLButtonElement
      const styles = getComputedStyle(element)
      return {
        className: element.className,
        tag: element.tagName,
        variant: element.dataset.variant ?? "",
        size: element.dataset.size ?? "",
        tone: element.dataset.tone ?? "",
        color: styles.color,
        background: styles.backgroundColor,
        borderColor: styles.borderColor,
      }
    })
    assert.deepEqual(
      {
        className: retryState.className,
        tag: retryState.tag,
        variant: retryState.variant,
        size: retryState.size,
        tone: retryState.tone,
      },
      {
        className: "oc-button",
        tag: "BUTTON",
        variant: "outline",
        size: "md",
        tone: "danger",
      },
    )
    assert.notEqual(retryState.color, "rgba(0, 0, 0, 0)")
    assert.notEqual(retryState.borderColor, "rgba(0, 0, 0, 0)")

    await page.hover(retrySelector)
    const hoverState = await page.$eval(retrySelector, (node) => {
      const styles = getComputedStyle(node as HTMLElement)
      return {
        background: styles.backgroundColor,
        color: styles.color,
      }
    })
    assert.notEqual(hoverState.background, retryState.background)
    assert.notEqual(hoverState.color, "rgba(0, 0, 0, 0)")

    let focusedByKeyboard = false
    for (let idx = 0; idx < 80; idx += 1) {
      await page.keyboard.press("Tab")
      focusedByKeyboard = await page.$eval(retrySelector, (node) => document.activeElement === node)
      if (focusedByKeyboard) break
    }
    assert.equal(focusedByKeyboard, true)
    const focusState = await page.$eval(retrySelector, (node) => {
      const element = node as HTMLElement
      const styles = getComputedStyle(element)
      return {
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
      }
    })
    assert.equal(focusState.focusVisible, true)
    assert.notEqual(focusState.outlineStyle, "none")
    assert.notEqual(focusState.outlineWidth, "0px")

    const screenshotPath = resolve(".scratch/file-explorer-retry-button-primitive.png")
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
