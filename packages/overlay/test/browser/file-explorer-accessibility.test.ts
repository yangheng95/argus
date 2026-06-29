import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
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
  const moveBodies: Array<{ path: string; newPath: string }> = []
  type FixtureFileNode = {
    name: string
    path: string
    absolute: string
    type: "file" | "directory"
    ignored: boolean
  }
  const normalizeFixturePath = (value: string) =>
    String(value || "")
      .replaceAll("\\", "/")
      .split("/")
      .filter(Boolean)
      .join("/")
  const fixtureParentPath = (value: string) => {
    const parts = normalizeFixturePath(value).split("/").filter(Boolean)
    parts.pop()
    return parts.join("/")
  }
  const fixtureName = (value: string) => normalizeFixturePath(value).split("/").filter(Boolean).at(-1) || value
  const fixtureAbsolute = (value: string) => `D:/overlay/workspace/app/${normalizeFixturePath(value)}`
  const fixtureFile = (value: string): FixtureFileNode => ({
    name: fixtureName(value),
    path: normalizeFixturePath(value),
    absolute: fixtureAbsolute(value),
    type: "file",
    ignored: false,
  })
  const fixtureDirectory = (value: string): FixtureFileNode => ({
    name: fixtureName(value),
    path: normalizeFixturePath(value),
    absolute: fixtureAbsolute(value),
    type: "directory",
    ignored: false,
  })
  const fixtureFiles = new Map<string, FixtureFileNode>([
    ["README.md", fixtureFile("README.md")],
    ["src/main.tsx", fixtureFile("src/main.tsx")],
  ])
  const fixtureDirectories = new Map<string, FixtureFileNode>([["src", fixtureDirectory("src")]])
  const fixtureContents = new Map<string, string>([
    ["README.md", "# README\n"],
    ["src/main.tsx", "export const file = true;\n"],
  ])
  const listFixtureDirectory = (requestedPath: string): FixtureFileNode[] => {
    const directory = normalizeFixturePath(requestedPath)
    const nodes = [...fixtureDirectories.values(), ...fixtureFiles.values()].filter(
      (node) => fixtureParentPath(node.path) === directory,
    )
    return nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1
      return left.name.localeCompare(right.name)
    })
  }
  const addFixtureFile = (value: string, content: string): FixtureFileNode => {
    const path = normalizeFixturePath(value)
    const node = fixtureFile(path)
    fixtureFiles.set(path, node)
    fixtureContents.set(path, content)
    return node
  }
  const addFixtureDirectory = (value: string): FixtureFileNode => {
    const path = normalizeFixturePath(value)
    const node = fixtureDirectory(path)
    fixtureDirectories.set(path, node)
    return node
  }
  const moveFixtureNode = (from: string, to: string): FixtureFileNode => {
    const sourcePath = normalizeFixturePath(from)
    const targetPath = normalizeFixturePath(to)
    const file = fixtureFiles.get(sourcePath)
    if (file) {
      fixtureFiles.delete(sourcePath)
      const next = fixtureFile(targetPath)
      fixtureFiles.set(targetPath, next)
      const content = fixtureContents.get(sourcePath) ?? ""
      fixtureContents.delete(sourcePath)
      fixtureContents.set(targetPath, content)
      return next
    }
    const directory = fixtureDirectories.get(sourcePath)
    if (!directory) throw new Error(`Missing fixture entry: ${sourcePath}`)
    fixtureDirectories.delete(sourcePath)
    const movedDirectory = fixtureDirectory(targetPath)
    fixtureDirectories.set(targetPath, movedDirectory)
    for (const [path, node] of [...fixtureFiles.entries()]) {
      if (path === sourcePath || path.startsWith(`${sourcePath}/`)) {
        const nextPath = `${targetPath}/${path.slice(sourcePath.length).replace(/^\/+/, "")}`
        fixtureFiles.delete(path)
        fixtureFiles.set(nextPath, {
          ...node,
          name: fixtureName(nextPath),
          path: nextPath,
          absolute: fixtureAbsolute(nextPath),
        })
      }
    }
    return movedDirectory
  }
  const deleteFixtureNode = (value: string): void => {
    const targetPath = normalizeFixturePath(value)
    fixtureFiles.delete(targetPath)
    fixtureContents.delete(targetPath)
    fixtureDirectories.delete(targetPath)
    for (const path of [...fixtureFiles.keys()]) {
      if (path.startsWith(`${targetPath}/`)) {
        fixtureFiles.delete(path)
        fixtureContents.delete(path)
      }
    }
    for (const path of [...fixtureDirectories.keys()]) {
      if (path.startsWith(`${targetPath}/`)) fixtureDirectories.delete(path)
    }
  }
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push(`${req.method} ${path}${url.search}`)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/projects/discover") return send([])
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission") return send([])
    if (path === "/session") return send([])
    if (path === "/project/current/worktrees") return send([])
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
    if (path === "/skill/mounts")
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/file") {
      const requestedPath = url.searchParams.get("path") ?? ""
      return send(listFixtureDirectory(requestedPath))
    }
    if (path === "/file/upload" && req.method === "POST") {
      const body = (await req.json()) as { targetDir: string; files: Array<{ name: string; contentBase64: string }> }
      uploadBodies.push(body)
      for (const file of body.files) {
        addFixtureFile(`${body.targetDir}/${file.name}`, Buffer.from(file.contentBase64, "base64").toString("utf-8"))
      }
      return send(
        body.files.map((file) => ({
          name: file.name,
          path: normalizeFixturePath(`${body.targetDir}/${file.name}`),
          bytes: Buffer.from(file.contentBase64, "base64").byteLength,
        })),
      )
    }
    if (path === "/file/item" && req.method === "POST") {
      const body = (await req.json()) as { path: string; type: "file" | "directory"; content?: string }
      const created =
        body.type === "directory" ? addFixtureDirectory(body.path) : addFixtureFile(body.path, body.content ?? "")
      return send(created)
    }
    if (path === "/file/item" && req.method === "PATCH") {
      const body = (await req.json()) as { path: string; newPath: string }
      moveBodies.push(body)
      const moved = moveFixtureNode(body.path, body.newPath)
      return send({ previousPath: normalizeFixturePath(body.path), path: moved.path, node: moved })
    }
    if (path === "/file/item" && req.method === "DELETE") {
      const deletedPath = normalizeFixturePath(url.searchParams.get("path") ?? "")
      deleteFixtureNode(deletedPath)
      return send({ path: deletedPath })
    }
    if (path === "/find/file") {
      return send(Array.from({ length: 130 }, (_, index) => `virtual-${String(index).padStart(3, "0")}.ts`))
    }
    if (path === "/file/content") {
      const requestedPath = normalizeFixturePath(url.searchParams.get("path") ?? "")
      return send({ type: "text", content: fixtureContents.get(requestedPath) ?? "export const file = true;\n" })
    }
    if (path === "/task/events") return eventStream()
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const errors = installBrowserErrorCollector(page)
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "dark")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", serverUrl)
    }, server.origin)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
    assert.equal(
      requestLog.some((entry) => entry.startsWith("GET /file")),
      false,
      "inactive File Explorer must not load directories before its activity is opened",
    )
    requestLog.length = 0
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark" && document.body.dataset.theme === "dark",
    )
    await page.evaluate(() => document.documentElement.style.setProperty("--ui-scale", "1.25"))
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
    await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
    assert.ok(
      requestLog.some((entry) => entry.startsWith("GET /file?") && entry.includes("path=")),
      `active File Explorer should load the root directory after opening: ${JSON.stringify(requestLog)}`,
    )

    const darkDensityScreenshotPath = resolve(".scratch/file-explorer-dark-row-density.png")
    mkdirSync(dirname(darkDensityScreenshotPath), { recursive: true })
    const explorerElementForDarkDensity = await page.$("#centerWorkbenchExplorer")
    assert.ok(explorerElementForDarkDensity)
    writeFileSync(darkDensityScreenshotPath, await explorerElementForDarkDensity.screenshot({}))

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

    await page.type(".file-explorer-search-input", "virtual")
    await page.waitForSelector('.file-explorer-row[title="virtual-000.ts"]', { visible: true })
    const virtualGeometry = await page.$eval('.file-explorer-row[title="virtual-000.ts"]', (node) => {
      const row = node as HTMLElement
      const item = row.closest(".file-explorer-virtual-item") as HTMLElement | null
      const list = row.closest(".file-explorer-list") as HTMLElement | null
      const rowBox = row.getBoundingClientRect()
      const directIconBox = row.querySelector(":scope > svg")?.getBoundingClientRect()
      const itemBox = item?.getBoundingClientRect()
      const style = getComputedStyle(row)
      const rootStyle = getComputedStyle(document.documentElement)
      return {
        rowClass: row.className,
        dataUi: row.dataset.ui ?? "",
        variant: row.dataset.variant ?? "",
        virtualized: list?.dataset.virtualized ?? "",
        rootScale: Number.parseFloat(rootStyle.getPropertyValue("--ui-scale")),
        bodyWeightToken: rootStyle.getPropertyValue("--ui-font-weight-body").trim(),
        rowFontWeight: style.fontWeight,
        rowHeight: rowBox.height,
        directIconWidth: directIconBox?.width ?? 0,
        directIconHeight: directIconBox?.height ?? 0,
        itemHeight: itemBox?.height ?? 0,
        computedHeight: style.height,
        depth: style.getPropertyValue("--file-explorer-row-depth").trim(),
      }
    })
    assert.match(virtualGeometry.rowClass, /\boc-button\b/)
    assert.equal(virtualGeometry.dataUi, "file-explorer-row")
    assert.equal(virtualGeometry.variant, "ghost")
    assert.equal(virtualGeometry.virtualized, "true")
    assert.equal(virtualGeometry.depth, "0")
    assert.ok(virtualGeometry.rootScale > 1.2, JSON.stringify(virtualGeometry))
    assert.ok(
      Math.abs(virtualGeometry.rowHeight - 26 * virtualGeometry.rootScale) < 0.5,
      JSON.stringify(virtualGeometry),
    )
    assert.equal(virtualGeometry.rowFontWeight, virtualGeometry.bodyWeightToken)
    assert.ok(
      Math.abs(virtualGeometry.directIconWidth - 16 * virtualGeometry.rootScale) < 0.5,
      JSON.stringify(virtualGeometry),
    )
    assert.ok(
      Math.abs(virtualGeometry.directIconHeight - 16 * virtualGeometry.rootScale) < 0.5,
      JSON.stringify(virtualGeometry),
    )
    assert.ok(Math.abs(virtualGeometry.itemHeight - virtualGeometry.rowHeight) < 0.5, JSON.stringify(virtualGeometry))

    await page.$eval(".file-explorer-search-input", (node) => {
      const input = node as HTMLInputElement
      input.value = ""
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }))
    })
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
      () =>
        document.querySelector<HTMLButtonElement>('.file-explorer-row[title="src"]')?.getAttribute("aria-expanded") ===
        "true",
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
      current:
        document
          .querySelector<HTMLButtonElement>('.file-explorer-row[title="README.md"]')
          ?.getAttribute("aria-current") ?? null,
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
      JSON.stringify({ selectedState, browserErrors: errors.unexpectedErrors, requestLog }, null, 2),
    )
    assert.ok((selectedState.explorerBox?.width ?? 0) > 240)
    assert.ok((selectedState.explorerBox?.height ?? 0) > 240)

    await page.waitForSelector('.file-editor-pane .oc-button[data-ui="file-editor-save"]', { visible: true })
    await page.waitForFunction(() =>
      document.querySelector<HTMLElement>(".file-editor-pane .cm-content")?.textContent?.includes("export const file"),
    )
    const editorButtonState = await page.evaluate(() => {
      const save = document.querySelector<HTMLButtonElement>('.file-editor-pane .oc-button[data-ui="file-editor-save"]')
      const close = document.querySelector<HTMLButtonElement>(
        '.file-editor-pane .oc-button[data-ui="file-editor-close"]',
      )
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
    const syntaxHighlightState = await page.evaluate(() => ({
      tokenCount: document.querySelectorAll(".file-editor-code .cm-line span[class]").length,
      lineText: document.querySelector<HTMLElement>(".file-editor-code .cm-line")?.textContent ?? "",
    }))
    assert.ok(syntaxHighlightState.tokenCount > 0, JSON.stringify(syntaxHighlightState))
    assert.equal(syntaxHighlightState.lineText, "export const file = true;")
    assert.ok((editorButtonState.paneBox?.height ?? 0) > 300)
    assert.ok((editorButtonState.codeBox?.height ?? 0) > 250)
    assert.ok((editorButtonState.editorBox?.height ?? 0) > 250)
    assert.ok((editorButtonState.lineBox?.width ?? 0) > 100)
    assert.ok((editorButtonState.lineBox?.height ?? 0) > 10)
    assert.notEqual(editorButtonState.lineColor, editorButtonState.editorBackground)

    const fileEditorCloseSelector = '.file-editor-pane .oc-button[data-ui="file-editor-close"]'
    let closeFocusedByKeyboard = false
    for (let idx = 0; idx < 240; idx += 1) {
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

    const openContextMenuOnRow = async (selector: string) => {
      const point = await page.$eval(selector, (node) => {
        const rect = (node as HTMLElement).getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      })
      await page.mouse.click(point.x, point.y, { button: "right" })
    }
    const openRootContextMenu = async () => {
      const point = await page.$eval(".file-explorer-list", (node) => {
        const rect = (node as HTMLElement).getBoundingClientRect()
        return { x: rect.left + Math.min(80, rect.width / 2), y: rect.bottom - 24 }
      })
      await page.mouse.click(point.x, point.y, { button: "right" })
    }
    const clickContextMenuItem = async (dataUi: string) => {
      const selector = `.file-explorer-context-menu [data-ui="${dataUi}"]:not([disabled]):not([data-disabled])`
      await page.waitForSelector(selector, { visible: true })
      await page.click(selector)
    }

    await openContextMenuOnRow('.file-explorer-row[title="src"]')
    await clickContextMenuItem("file-explorer-context-upload")
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-ui="file-explorer-upload-input"]')
      if (!input) throw new Error("upload input missing")
      const transfer = new DataTransfer()
      transfer.items.add(new File(["from browser"], "uploaded-from-browser.txt", { type: "text/plain" }))
      Object.defineProperty(input, "files", { value: transfer.files, configurable: true })
      input.dispatchEvent(new Event("change", { bubbles: true }))
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

    await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(".file-explorer-list")
      if (!list) throw new Error("explorer list missing")
      const transfer = new DataTransfer()
      transfer.items.add(new File(["root drop"], "root-dropped.txt", { type: "text/plain" }))
      list.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }))
      list.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }))
    })
    await page.waitForSelector('.file-explorer-list[data-drop-target="upload"]')
    const rootDropScreenshotPath = resolve(".scratch/file-explorer-root-upload-drop-target.png")
    mkdirSync(dirname(rootDropScreenshotPath), { recursive: true })
    const explorerElementForRootDrop = await page.$("#centerWorkbenchExplorer")
    assert.ok(explorerElementForRootDrop)
    writeFileSync(rootDropScreenshotPath, await explorerElementForRootDrop.screenshot({}))
    await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(".file-explorer-list")
      if (!list) throw new Error("explorer list missing")
      const transfer = new DataTransfer()
      transfer.items.add(new File(["root drop"], "root-dropped.txt", { type: "text/plain" }))
      list.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }))
    })
    await page.waitForSelector('.file-explorer-row[title="root-dropped.txt"]', { visible: true })
    assert.equal(uploadBodies.length, 2)
    assert.equal(uploadBodies[1]?.targetDir, "")
    assert.equal(uploadBodies[1]?.files[0]?.name, "root-dropped.txt")
    assert.equal(Buffer.from(uploadBodies[1]?.files[0]?.contentBase64 ?? "", "base64").toString("utf-8"), "root drop")

    await openRootContextMenu()
    await page.waitForSelector('.file-explorer-context-menu[data-scope="root"] [data-ui="file-explorer-context-refresh"]', {
      visible: true,
    })
    const rootContextMenuState = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('.file-explorer-context-menu[data-scope="root"]')
      return {
        menuItems: menu?.querySelectorAll(".file-explorer-menu-item").length ?? 0,
        hasUpload: Boolean(menu?.querySelector('[data-ui="file-explorer-context-upload"]')),
        hasNewFile: Boolean(menu?.querySelector('[data-ui="file-explorer-context-new-file"]')),
        hasNewFolder: Boolean(menu?.querySelector('[data-ui="file-explorer-context-new-folder"]')),
        hasRefresh: Boolean(menu?.querySelector('[data-ui="file-explorer-context-refresh"]')),
        toolbarButtons: document.querySelectorAll(
          '#centerWorkbenchExplorer [data-ui="file-explorer-new-menu"], #centerWorkbenchExplorer [data-ui="file-explorer-refresh"], #centerWorkbenchExplorer [data-ui="file-explorer-rename"], #centerWorkbenchExplorer [data-ui="file-explorer-move"], #centerWorkbenchExplorer [data-ui="file-explorer-delete"]',
        ).length,
      }
    })
    assert.deepEqual(rootContextMenuState, {
      menuItems: 4,
      hasUpload: true,
      hasNewFile: true,
      hasNewFolder: true,
      hasRefresh: true,
      toolbarButtons: 0,
    })
    await page.mouse.click(4, 4)
    await page.waitForFunction(() => !document.querySelector(".file-explorer-context-menu:not([hidden])"))

    await openContextMenuOnRow('.file-explorer-row[title="src"]')
    await page.waitForSelector('.file-explorer-context-menu [data-ui="file-explorer-context-new-file"]', {
      visible: true,
      timeout: 5000,
    })
    const contextMenuState = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>(".file-explorer-context-menu")
      return {
        menuItems: menu?.querySelectorAll(".file-explorer-menu-item").length ?? 0,
        separatorCount: menu?.querySelectorAll(".file-explorer-menu-separator").length ?? 0,
        deleteTone: menu?.querySelector<HTMLElement>('[data-ui="file-explorer-context-delete"]')?.dataset.tone ?? "",
        srcSelected:
          document.querySelector<HTMLElement>('.file-explorer-row[title="src"]')?.dataset.selected ?? "",
        readmeSelected:
          document.querySelector<HTMLElement>('.file-explorer-row[title="README.md"]')?.dataset.selected ?? "",
        localToolbarRoles: document.querySelectorAll('#centerWorkbenchExplorer [role="toolbar"]').length,
        toolbarButtons: document.querySelectorAll(
          '#centerWorkbenchExplorer [data-ui="file-explorer-new-menu"], #centerWorkbenchExplorer [data-ui="file-explorer-refresh"], #centerWorkbenchExplorer [data-ui="file-explorer-rename"], #centerWorkbenchExplorer [data-ui="file-explorer-move"], #centerWorkbenchExplorer [data-ui="file-explorer-delete"]',
        ).length,
      }
    })
    assert.deepEqual(contextMenuState, {
      menuItems: 7,
      separatorCount: 1,
      deleteTone: "danger",
      srcSelected: "true",
      readmeSelected: "false",
      localToolbarRoles: 0,
      toolbarButtons: 0,
    })
    const contextMenuScreenshotPath = resolve(".scratch/file-explorer-context-menu.png")
    mkdirSync(dirname(contextMenuScreenshotPath), { recursive: true })
    writeFileSync(contextMenuScreenshotPath, await page.screenshot({ fullPage: false }))
    await clickContextMenuItem("file-explorer-context-new-file")
    await page.waitForSelector("#appDialogInput", { visible: true })
    const commandDialogScreenshotPath = resolve(".scratch/file-explorer-command-dialog.png")
    mkdirSync(dirname(commandDialogScreenshotPath), { recursive: true })
    const commandDialogElement = await page.$("#appDialog")
    assert.ok(commandDialogElement)
    writeFileSync(commandDialogScreenshotPath, await commandDialogElement.screenshot({}))
    await page.$eval("#appDialogInput", (node) => {
      const input = node as HTMLInputElement
      input.value = "browser-created.txt"
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: input.value }))
    })
    await page.click("#btnAppDialogOk")
    await page.waitForSelector('.file-explorer-row[title="src/browser-created.txt"]', { visible: true })
    assert.ok(
      requestLog.some((entry) => entry.startsWith("POST /file/item?directory=D%3A%2Foverlay%2Fworkspace%2Fapp")),
    )

    await openContextMenuOnRow('.file-explorer-row[title="src/browser-created.txt"]')
    await clickContextMenuItem("file-explorer-context-rename")
    await page.waitForSelector("#appDialogInput", { visible: true })
    await page.$eval("#appDialogInput", (node) => {
      const input = node as HTMLInputElement
      input.value = "browser-renamed.txt"
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: input.value }),
      )
    })
    await page.click("#btnAppDialogOk")
    await page.waitForSelector('.file-explorer-row[title="src/browser-renamed.txt"]', { visible: true })
    assert.equal(await page.$('.file-explorer-row[title="src/browser-created.txt"]'), null)

    await openContextMenuOnRow('.file-explorer-row[title="src/browser-renamed.txt"]')
    await clickContextMenuItem("file-explorer-context-move")
    await page.waitForSelector("#appDialogInput", { visible: true })
    await page.$eval("#appDialogInput", (node) => {
      const input = node as HTMLInputElement
      input.value = "moved-from-src.txt"
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: input.value }),
      )
    })
    await page.click("#btnAppDialogOk")
    await page.waitForSelector('.file-explorer-row[title="moved-from-src.txt"]', { visible: true })
    assert.equal(await page.$('.file-explorer-row[title="src/browser-renamed.txt"]'), null)

    await page.click('.file-explorer-row[title="README.md"]', { modifiers: ["Control"] })
    await page.evaluate(() => {
      const source = document.querySelector<HTMLElement>('.file-explorer-row[title="moved-from-src.txt"]')
      const target = document.querySelector<HTMLElement>('.file-explorer-row[title="src"]')
      if (!source || !target) throw new Error("drag move rows missing")
      const transfer = new DataTransfer()
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }))
      target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }))
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }))
    })
    await page.waitForSelector('.file-explorer-row[title="src"][data-drop-target="move"]')
    const dragMoveScreenshotPath = resolve(".scratch/file-explorer-multiselect-drag-move-target.png")
    mkdirSync(dirname(dragMoveScreenshotPath), { recursive: true })
    const explorerElementForDragMove = await page.$("#centerWorkbenchExplorer")
    assert.ok(explorerElementForDragMove)
    writeFileSync(dragMoveScreenshotPath, await explorerElementForDragMove.screenshot({}))
    await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('.file-explorer-row[title="src"]')
      if (!target) throw new Error("src row missing")
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    })
    await page.waitForSelector('.file-explorer-row[title="src/moved-from-src.txt"]', { visible: true })
    await page.waitForSelector('.file-explorer-row[title="src/README.md"]', { visible: true })
    assert.equal(await page.$('.file-explorer-row[title="moved-from-src.txt"]'), null)
    assert.equal(await page.$('.file-explorer-row[title="README.md"]'), null)
    assert.ok(moveBodies.some((body) => body.path === "moved-from-src.txt" && body.newPath === "src/moved-from-src.txt"))
    assert.ok(moveBodies.some((body) => body.path === "README.md" && body.newPath === "src/README.md"))

    await openContextMenuOnRow('.file-explorer-row[title="src/moved-from-src.txt"]')
    await page.waitForSelector('.file-explorer-context-menu [data-ui="file-explorer-context-delete"]', { visible: true })
    const multiContextState = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>(".file-explorer-context-menu")
      return {
        selectedRows: Array.from(document.querySelectorAll<HTMLElement>('.file-explorer-row[data-selected="true"]')).map(
          (row) => row.title,
        ),
        moveDetail:
          menu?.querySelector<HTMLElement>('[data-ui="file-explorer-context-move"] .file-explorer-menu-item-detail')
            ?.textContent ?? "",
        renameDisabled:
          menu?.querySelector<HTMLButtonElement>('[data-ui="file-explorer-context-rename"]')?.disabled ||
          menu?.querySelector<HTMLElement>('[data-ui="file-explorer-context-rename"]')?.hasAttribute("data-disabled") ||
          false,
      }
    })
    assert.deepEqual(multiContextState.selectedRows.sort(), ["src/README.md", "src/moved-from-src.txt"])
    assert.equal(multiContextState.moveDetail, "2 selected")
    assert.equal(multiContextState.renameDisabled, true)
    const multiContextMenuScreenshotPath = resolve(".scratch/file-explorer-context-menu-multiselect.png")
    mkdirSync(dirname(multiContextMenuScreenshotPath), { recursive: true })
    writeFileSync(multiContextMenuScreenshotPath, await page.screenshot({ fullPage: false }))
    await clickContextMenuItem("file-explorer-context-delete")
    await page.waitForSelector("#appDialog", { visible: true })
    await page.click("#btnAppDialogOk")
    await page.waitForFunction(() => !document.querySelector('.file-explorer-row[title="src/moved-from-src.txt"]'))
    await page.waitForFunction(() => !document.querySelector('.file-explorer-row[title="src/README.md"]'))
    assert.ok(
      requestLog.some(
        (entry) =>
          entry.startsWith("DELETE /file/item?") &&
          entry.includes("path=src%2Fmoved-from-src.txt") &&
          entry.includes("directory=D%3A%2Foverlay%2Fworkspace%2Fapp"),
      ),
    )
    assert.ok(
      requestLog.some(
        (entry) =>
          entry.startsWith("DELETE /file/item?") &&
          entry.includes("path=src%2FREADME.md") &&
          entry.includes("directory=D%3A%2Foverlay%2Fworkspace%2Fapp"),
      ),
    )

    const nestedDeleteStart = requestLog.filter((entry) => entry.startsWith("DELETE /file/item?")).length
    await page.click('.file-explorer-row[title="src"]', { modifiers: ["Control"] })
    await page.click('.file-explorer-row[title="src/main.tsx"]', { modifiers: ["Control"] })
    await openContextMenuOnRow('.file-explorer-row[title="src"]')
    await page.waitForSelector('.file-explorer-context-menu [data-ui="file-explorer-context-delete"]', { visible: true })
    const nestedSelectionState = await page.evaluate(() => ({
      selectedRows: Array.from(document.querySelectorAll<HTMLElement>('.file-explorer-row[data-selected="true"]')).map(
        (row) => row.title,
      ),
      deleteDetail:
        document.querySelector<HTMLElement>(
          '.file-explorer-context-menu [data-ui="file-explorer-context-delete"] .file-explorer-menu-item-detail',
        )?.textContent ?? "",
    }))
    assert.deepEqual(nestedSelectionState.selectedRows.sort(), ["src", "src/main.tsx"])
    assert.equal(nestedSelectionState.deleteDetail, "2 selected")
    await clickContextMenuItem("file-explorer-context-delete")
    await page.waitForSelector("#appDialog", { visible: true })
    await page.click("#btnAppDialogOk")
    await page.waitForFunction(() => !document.querySelector('.file-explorer-row[title="src"]'))
    const nestedDeletePaths = requestLog
      .filter((entry) => entry.startsWith("DELETE /file/item?"))
      .slice(nestedDeleteStart)
      .map((entry) => new URL(entry.replace(/^DELETE /, ""), "http://fixture.local").searchParams.get("path"))
    assert.deepEqual(nestedDeletePaths, ["src"])

    const screenshotPath = resolve(".scratch/file-explorer-accessibility.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    const explorerElement = await page.$("#centerWorkbenchExplorer")
    assert.ok(explorerElement)
    const screenshot = await explorerElement.screenshot({})
    assert.ok(screenshot.length > 0)
    writeFileSync(screenshotPath, screenshot)
    errors.assertNoUnexpectedErrors()
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
    if (path === "/global/projects/discover") return send([])
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission" || path === "/session") return send([])
    if (path === "/project/current/worktrees") return send([])
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
    if (path === "/skill/mounts")
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/file") return send({ error: "root directory unavailable" }, { status: 500 })
    if (path === "/task/events") return eventStream()
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const errors = installBrowserErrorCollector(page, {
      allowConsoleError(message) {
        return (
          message.text.includes("[file-explorer] list failed") && message.text.includes("root directory unavailable")
        )
      },
      allowResponse(response) {
        return response.path === "/file" && response.status === 500
      },
    })
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "light")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", serverUrl)
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
    errors.assertNoUnexpectedErrors()
  } finally {
    await browser.close()
    await server.close()
  }
})
