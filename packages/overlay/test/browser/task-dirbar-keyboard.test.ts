import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const PROJECT_DIRECTORY = "D:/overlay/workspace/app"

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

type TaskDirbarFixtureOptions = {
  discovery: { body: unknown; status?: number }
  projectDirectory?: string
}

async function taskDirbarFixtureResponse(req: Request, options: TaskDirbarFixtureOptions): Promise<Response> {
  const url = new URL(req.url)
  const path = route(url)
  const projectDirectory = options.projectDirectory ?? PROJECT_DIRECTORY
  const directory = url.searchParams.get("directory")
  if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
  if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
  const staticResponse = await overlayStaticResponse(path)
  if (staticResponse) return staticResponse
  if (path === "/global/health") return send({ version: "1.2.3" })
  if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
  if (path === "/session" || path === "/mission" || path === "/project/current/worktrees") return send([])
  if (path === "/path") return send({ directory: directory ?? projectDirectory })
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
  if (path === "/global/projects/discover") {
    return send(options.discovery.body, { status: options.discovery.status ?? 200 })
  }
  if (path === "/provider") return send({ all: [], connected: [], default: {} })
  if (path === "/provider/auth") return send({})
  if (path === "/config/providers") return send({ providers: [], default: {} })
  if (path === "/config/prompt") return send([])
  if (path === "/config/prompt-profile") return send({ active: "general", targets: [], profiles: [] })
  if (path === "/config" && (req.method === "GET" || req.method === "PATCH")) return send({ model: "" })
  if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
  if (path === "/coding/cli/profiles") return send({ profiles: [] })
  if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
  if (path === "/task/events") {
    return new Response(":\n\n", {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      },
    })
  }
  if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
  if (path === "/skill/installed" || path === "/skill") return send([])
  if (path === "/mcp") return send({})
  if (path === "/panel/knowledge/memory") return send([])
  if (path === "/panel/knowledge/preference") return send([])
  if (path === "/log" && req.method === "POST") return send({ ok: true })
  return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
}

async function saveScreenshot(page: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await page.screenshot({ fullPage: false }))
  return target
}

async function saveElementScreenshot(
  page: { $(selector: string): Promise<{ screenshot(options?: Record<string, unknown>): Promise<Buffer> } | null> },
  selector: string,
  name: string,
) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const screenshot = await element.screenshot({})
  assert.ok(screenshot.length > 0, `${name} screenshot should not be empty`)
  await writeFile(target, screenshot)
  return target
}

test("cwd breadcrumb buttons are outside the recent-directory menu trigger", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture((req) =>
    taskDirbarFixtureResponse(req, {
      discovery: {
        body: {
          root: "D:/overlay/workspace",
          defaultDirectory: PROJECT_DIRECTORY,
          projects: [
            {
              directory: PROJECT_DIRECTORY,
              name: "app",
              marker: "package.json",
            },
          ],
        },
      },
    }),
  )

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const badResponses: string[] = []
    page.on("response", (response: any) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
    })
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument((input: { directory: string; serverUrl: string }) => {
      localStorage.setItem("oc_directory", input.directory)
      localStorage.setItem("oc_saved_directory", input.directory)
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_server_url", input.serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem(
        "oc_recent_directories",
        JSON.stringify([input.directory, "D:/overlay/workspace/tools", "D:/overlay/workspace/docs"]),
      )
      window.__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl: input.serverUrl,
                autoServer: false,
                locale: "en-US",
                directory: input.directory,
              }
            }
            if (command === "overlay_settings_save") return true
            if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
            if (command === "overlay_pick_dir") return input.directory
            if (command === "overlay_open_path") return true
            if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined,
              hide: async () => undefined,
              minimize: async () => undefined,
              startDragging: async () => undefined,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, { directory: PROJECT_DIRECTORY, serverUrl: server.origin })

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector(".task-cwd-dropdown", { visible: true })
    await page.waitForSelector(".task-dir-step", { visible: true })
    await page.waitForSelector('[data-ui="cwd-recent-trigger"]', { visible: true })
    await page.waitForSelector('[data-ui="project-worktree-dropdown"]', { visible: true })

    await page.click('[data-ui="project-worktree-dropdown"]')
    await page.waitForSelector(".project-worktree-panel", { visible: true })
    const projectWorktreeOpenState = await page.evaluate(() => {
      const trigger = document.querySelector('[data-ui="project-worktree-dropdown"]') as HTMLElement | null
      const panel = document.querySelector(".project-worktree-panel") as HTMLElement | null
      return {
        panelVisible: !!panel && !panel.hidden,
        ariaExpanded: trigger?.getAttribute("aria-expanded") ?? "",
        dataExpanded: trigger?.hasAttribute("data-expanded") ?? false,
        dataOpen: trigger?.getAttribute("data-open") ?? null,
      }
    })
    assert.deepEqual(projectWorktreeOpenState, {
      panelVisible: true,
      ariaExpanded: "true",
      dataExpanded: true,
      dataOpen: null,
    })
    const projectWorktreeScreenshot = await saveScreenshot(page, "task-dirbar-project-worktree-expanded-state.png")
    assert.ok(projectWorktreeScreenshot.endsWith("task-dirbar-project-worktree-expanded-state.png"))
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => document.querySelector(".project-worktree-panel") === null)

    const semantics = await page.evaluate(() => {
      const trigger = document.querySelector<HTMLElement>('[data-ui="cwd-recent-trigger"]')
      const pathButton = document.querySelector<HTMLElement>(".task-dir-step")
      const currentNode = document.querySelector<HTMLElement>(".task-dir-node[data-current='true']")
      return {
        triggerTag: trigger?.tagName ?? "",
        triggerType: trigger?.getAttribute("type") ?? "",
        triggerClass: trigger?.className ?? "",
        triggerChrome: trigger?.dataset.chrome ?? "",
        pathButtonTag: pathButton?.tagName ?? "",
        triggerContainsPathButton: !!trigger && !!pathButton && trigger.contains(pathButton),
        pathButtonTriggerAncestor: !!pathButton?.closest('[data-ui="cwd-recent-trigger"]'),
        currentNodeTag: currentNode?.tagName ?? "",
        currentNodeCurrent: currentNode?.getAttribute("aria-current") ?? "",
        currentNodeSelected: currentNode?.getAttribute("aria-selected") ?? "",
        currentNodePressed: currentNode?.getAttribute("aria-pressed") ?? "",
      }
    })

    assert.deepEqual(
      {
        triggerTag: semantics.triggerTag,
        triggerType: semantics.triggerType,
        pathButtonTag: semantics.pathButtonTag,
        triggerContainsPathButton: semantics.triggerContainsPathButton,
        pathButtonTriggerAncestor: semantics.pathButtonTriggerAncestor,
      },
      {
        triggerTag: "BUTTON",
        triggerType: "button",
        pathButtonTag: "BUTTON",
        triggerContainsPathButton: false,
        pathButtonTriggerAncestor: false,
      },
    )
    assert.match(semantics.triggerClass, /\boc-button\b/)
    assert.equal(semantics.triggerChrome, "icon-action")
    assert.ok(["BUTTON", "SPAN"].includes(semantics.currentNodeTag), JSON.stringify(semantics))
    assert.deepEqual({
      currentNodeCurrent: semantics.currentNodeCurrent,
      currentNodeSelected: semantics.currentNodeSelected,
      currentNodePressed: semantics.currentNodePressed,
    }, {
      currentNodeCurrent: "location",
      currentNodeSelected: "",
      currentNodePressed: "",
    })

    const breadcrumbFocusStates: Record<
      string,
      {
        kind: string
        className: string
        background: string
        color: string
        outlineStyle: string
        outlineWidth: string
        outlineColor: string
      }
    > = {}
    let breadcrumbFocusScreenshot = ""
    await page.evaluate(() => {
      document.body.setAttribute("tabindex", "-1")
      document.body.focus()
      document.body.removeAttribute("tabindex")
    })
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await page.keyboard.press("Tab")
      const state = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        if (!active) return null
        const kind = active.matches(".task-dir-step")
          ? "step"
          : active.matches(".task-dir-node")
            ? "node"
            : active.matches(".task-dir-tool")
              ? "tool"
              : ""
        if (!kind) return null
        const style = getComputedStyle(active)
        return {
          kind,
          className: active.className,
          background: style.backgroundColor,
          color: style.color,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineColor: style.outlineColor,
        }
      })
      if (!state || breadcrumbFocusStates[state.kind]) continue
      breadcrumbFocusStates[state.kind] = state
      if (!breadcrumbFocusScreenshot) {
        breadcrumbFocusScreenshot = await saveElementScreenshot(
          page,
          ".task-cwd-dropdown",
          "task-dirbar-breadcrumb-focus-visible.png",
        )
      }
      if (breadcrumbFocusStates.step && breadcrumbFocusStates.node && breadcrumbFocusStates.tool) break
    }
    assert.deepEqual(Object.keys(breadcrumbFocusStates).sort(), ["node", "step", "tool"])
    for (const state of Object.values(breadcrumbFocusStates)) {
      assert.notEqual(state.background, "rgba(0, 0, 0, 0)", JSON.stringify(breadcrumbFocusStates))
      assert.notEqual(state.color, "", JSON.stringify(breadcrumbFocusStates))
      assert.equal(state.outlineStyle, "solid", JSON.stringify(breadcrumbFocusStates))
      assert.notEqual(state.outlineWidth, "0px", JSON.stringify(breadcrumbFocusStates))
      assert.notEqual(state.outlineColor, "rgba(0, 0, 0, 0)", JSON.stringify(breadcrumbFocusStates))
    }
    assert.ok(breadcrumbFocusScreenshot.endsWith("task-dirbar-breadcrumb-focus-visible.png"))

    await page.focus(".task-dir-step")
    await page.keyboard.press("Enter")
    await new Promise((resolve) => setTimeout(resolve, 150))
    const afterPathKey = await page.evaluate(() => ({
      panelPresent: !!document.querySelector(".recent-dir-panel"),
      triggerExpanded: document.querySelector('[data-ui="cwd-recent-trigger"]')?.getAttribute("aria-expanded") ?? "",
    }))
    assert.deepEqual(afterPathKey, { panelPresent: false, triggerExpanded: "false" })

    await page.focus('[data-ui="cwd-recent-trigger"]')
    await page.keyboard.press("Enter")
    await page.waitForSelector(".recent-dir-panel", { visible: true })
    await page.waitForSelector('[data-ui="cwd-path-input"]', { visible: true })
    await page.waitForFunction(
      () => document.querySelectorAll('.recent-dir-row[data-active="true"] .recent-dir-item[aria-current="location"]').length >= 1,
    )

    const openState = await page.evaluate(() => ({
      panelVisible: !!document.querySelector(".recent-dir-panel"),
      panelRole: document.querySelector(".recent-dir-panel")?.getAttribute("role") ?? "",
      panelLabel: document.querySelector(".recent-dir-panel")?.getAttribute("aria-label") ?? "",
      menuRoleCount: document.querySelectorAll('.recent-dir-panel [role="menu"], .recent-dir-panel [role="menuitem"]').length,
      triggerExpanded: document.querySelector('[data-ui="cwd-recent-trigger"]')?.getAttribute("aria-expanded") ?? "",
      shellOpen: document.querySelector(".task-cwd-dropdown")?.getAttribute("data-open") ?? "",
      recentRows: document.querySelectorAll('.recent-dir-list[data-kind="recent"] .recent-dir-row').length,
      currentRows: Array.from(document.querySelectorAll<HTMLElement>(".recent-dir-row")).map((row) => {
        const item = row.querySelector<HTMLElement>(".recent-dir-item")
        return {
          title: item?.getAttribute("title") ?? "",
          active: row.dataset.active ?? "",
          current: item?.getAttribute("aria-current") ?? "",
          selected: item?.getAttribute("aria-selected") ?? "",
          pressed: item?.getAttribute("aria-pressed") ?? "",
        }
      }),
      geometry: (() => {
        const shell = document.querySelector<HTMLElement>(".task-cwd-dropdown")?.getBoundingClientRect()
        const panel = document.querySelector<HTMLElement>(".recent-dir-panel")?.getBoundingClientRect()
        return shell && panel
          ? {
              leftDelta: Math.abs(Math.round(shell.left) - Math.round(panel.left)),
              panelLeft: Math.round(panel.left),
              shellLeft: Math.round(shell.left),
              panelWidth: Math.round(panel.width),
              shellWidth: Math.round(shell.width),
            }
          : null
      })(),
    }))
    assert.equal(openState.panelVisible, true)
    assert.equal(openState.panelRole, "dialog")
    assert.equal(openState.panelLabel, "Recent")
    assert.equal(openState.menuRoleCount, 0)
    assert.equal(openState.triggerExpanded, "true")
    assert.equal(openState.shellOpen, "true")
    assert.ok(openState.recentRows >= 3)
    assert.ok(openState.currentRows.filter((row) => row.active === "true").length >= 1)
    for (const row of openState.currentRows) {
      assert.equal(row.current, row.active === "true" ? "location" : "", JSON.stringify(openState.currentRows))
      assert.equal(row.selected, "")
      assert.equal(row.pressed, "")
    }
    assert.ok(openState.geometry)
    assert.ok(openState.geometry.leftDelta <= 2, JSON.stringify(openState.geometry))
    assert.ok(openState.geometry.panelWidth > 240)
    assert.ok(openState.geometry.panelWidth <= openState.geometry.shellWidth)

    await page.focus('[data-ui="cwd-path-input"]')
    const pathInputState = await page.$eval('[data-ui="cwd-path-input"]', (node) => {
      const input = node as HTMLInputElement
      const styles = getComputedStyle(input)
      return {
        active: document.activeElement === input,
        className: input.className,
        appearance: styles.appearance,
        borderTopColor: styles.borderTopColor,
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        boxShadow: styles.boxShadow,
      }
    })
    assert.equal(pathInputState.active, true)
    assert.match(pathInputState.className, /\bfield-input\b/)
    assert.equal(pathInputState.appearance, "none")
    assert.notEqual(pathInputState.borderTopColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(pathInputState.backgroundColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(pathInputState.color, "rgba(0, 0, 0, 0)")
    assert.notEqual(pathInputState.boxShadow, "none")
    const focusedInputScreenshot = await saveElementScreenshot(
      page,
      ".recent-dir-panel",
      "task-dirbar-recent-path-input-field-input.png",
    )
    assert.ok(focusedInputScreenshot.endsWith("task-dirbar-recent-path-input-field-input.png"))

    const tabOrder: Array<{ tag: string; dataUI: string; className: string }> = []
    for (let index = 0; index < 5; index += 1) {
      await page.keyboard.press("Tab")
      tabOrder.push(
        await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null
          return {
            tag: active?.tagName ?? "",
            dataUI: active?.dataset.ui ?? "",
            className: active?.className ?? "",
          }
        }),
      )
    }
    assert.ok(tabOrder.some((item) => item.dataUI === "recent-dir-edit-submit"), JSON.stringify(tabOrder))
    assert.ok(tabOrder.some((item) => /\brecent-dir-item\b/.test(item.className)), JSON.stringify(tabOrder))
    assert.ok(tabOrder.some((item) => item.dataUI === "recent-dir-remove"), JSON.stringify(tabOrder))

    await page.focus('.recent-dir-list[data-kind="recent"] .recent-dir-item')
    await page.waitForSelector('.recent-dir-list[data-kind="recent"] .recent-dir-row:focus-within')
    const focusedRecentState = await page.$eval(
      '.recent-dir-list[data-kind="recent"] .recent-dir-row:focus-within',
      (node) => {
        const row = node as HTMLElement
        const item = row.querySelector<HTMLElement>(".recent-dir-item")
        const remove = row.querySelector<HTMLElement>('[data-ui="recent-dir-remove"]')
        const rowStyles = getComputedStyle(row)
        const removeStyles = remove ? getComputedStyle(remove) : null
        return {
          active: document.activeElement === item,
          borderTopColor: rowStyles.borderTopColor,
          removeOpacity: removeStyles?.opacity ?? "",
          removePointerEvents: removeStyles?.pointerEvents ?? "",
        }
      },
    )
    assert.equal(focusedRecentState.active, true)
    assert.notEqual(focusedRecentState.borderTopColor, "rgba(0, 0, 0, 0)")
    assert.equal(focusedRecentState.removeOpacity, "1")
    assert.equal(focusedRecentState.removePointerEvents, "auto")
    const focusedRecentScreenshot = await saveElementScreenshot(
      page,
      ".recent-dir-panel",
      "task-dirbar-recent-focused-row.png",
    )
    assert.ok(focusedRecentScreenshot.endsWith("task-dirbar-recent-focused-row.png"))

    const actionSemantics = await page.evaluate(() => {
      const submit = document.querySelector<HTMLButtonElement>('[data-ui="recent-dir-edit-submit"]')
      const remove = document.querySelector<HTMLButtonElement>(
        '.recent-dir-list[data-kind="recent"] .recent-dir-row:nth-child(2) [data-ui="recent-dir-remove"]',
      )
      return {
        submitTag: submit?.tagName ?? "",
        submitClass: submit?.className ?? "",
        submitChrome: submit?.dataset.chrome ?? "",
        submitSize: submit?.dataset.size ?? "",
        submitTitle: submit?.getAttribute("title") ?? "",
        submitLabel: submit?.getAttribute("aria-label") ?? "",
        removeTag: remove?.tagName ?? "",
        removeClass: remove?.className ?? "",
        removeChrome: remove?.dataset.chrome ?? "",
        removeSize: remove?.dataset.size ?? "",
        removeTone: remove?.dataset.tone ?? "",
        removeTitle: remove?.getAttribute("title") ?? "",
        removeLabel: remove?.getAttribute("aria-label") ?? "",
      }
    })
    assert.match(actionSemantics.submitClass, /\boc-button\b/)
    assert.match(actionSemantics.removeClass, /\boc-button\b/)
    assert.deepEqual(
      {
        submitTag: actionSemantics.submitTag,
        submitChrome: actionSemantics.submitChrome,
        submitSize: actionSemantics.submitSize,
        submitTitle: actionSemantics.submitTitle,
        submitLabel: actionSemantics.submitLabel,
        removeTag: actionSemantics.removeTag,
        removeChrome: actionSemantics.removeChrome,
        removeSize: actionSemantics.removeSize,
        removeTone: actionSemantics.removeTone,
        removeTitle: actionSemantics.removeTitle,
        removeLabel: actionSemantics.removeLabel,
      },
      {
        submitTag: "BUTTON",
        submitChrome: "icon-action",
        submitSize: "icon",
        submitTitle: "Save",
        submitLabel: "Save",
        removeTag: "BUTTON",
        removeChrome: "icon-action",
        removeSize: "icon",
        removeTone: "danger",
        removeTitle: "Delete",
        removeLabel: "Delete",
      },
    )

    await page.$eval('[data-ui="cwd-path-input"]', (node) => {
      const input = node as HTMLInputElement
      input.value = ""
      input.dispatchEvent(new InputEvent("input", { bubbles: true }))
    })
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('[data-ui="recent-dir-edit-submit"]')?.disabled)
    const disabledSubmit = await page.$eval('[data-ui="recent-dir-edit-submit"]', (node) => {
      const element = node as HTMLButtonElement
      const styles = getComputedStyle(element)
      return {
        disabled: element.disabled,
        opacity: styles.opacity,
        color: styles.color,
      }
    })
    assert.equal(disabledSubmit.disabled, true)
    assert.equal(disabledSubmit.opacity, "1")
    assert.notEqual(disabledSubmit.color, "rgba(0, 0, 0, 0)")

    await page.$eval(
      '[data-ui="cwd-path-input"]',
      (node, value) => {
        const input = node as HTMLInputElement
        input.value = String(value)
        input.dispatchEvent(new InputEvent("input", { bubbles: true }))
      },
      PROJECT_DIRECTORY,
    )
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-ui="recent-dir-edit-submit"]')?.disabled)
    await page.focus('[data-ui="recent-dir-edit-submit"]')
    const submitFocus = await page.$eval('[data-ui="recent-dir-edit-submit"]', (node) => {
      const element = node as HTMLButtonElement
      return {
        active: document.activeElement === element,
        className: element.className,
      }
    })
    assert.equal(submitFocus.active, true)
    assert.match(submitFocus.className, /\boc-button\b/)

    const recentRowSelector = '.recent-dir-list[data-kind="recent"] .recent-dir-row:nth-child(2)'
    await page.hover(recentRowSelector)
    await new Promise((resolve) => setTimeout(resolve, 260))
    const removeGeometry = await page.$eval(recentRowSelector, (row) => {
      const item = row.querySelector<HTMLElement>(".recent-dir-item")!.getBoundingClientRect()
      const remove = row.querySelector<HTMLElement>('[data-ui="recent-dir-remove"]')!
      const removeRect = remove.getBoundingClientRect()
      const styles = getComputedStyle(remove)
      return {
        itemRight: item.right,
        removeLeft: removeRect.left,
        opacity: styles.opacity,
        pointerEvents: styles.pointerEvents,
      }
    })
    assert.ok(
      removeGeometry.itemRight <= removeGeometry.removeLeft,
      `expected recent directory text to end before remove action: ${removeGeometry.itemRight} <= ${removeGeometry.removeLeft}`,
    )
    assert.equal(removeGeometry.opacity, "1")
    assert.equal(removeGeometry.pointerEvents, "auto")

    assert.deepEqual(badResponses, [])

    const actionScreenshot = await saveElementScreenshot(
      page,
      ".recent-dir-panel",
      "task-dirbar-recent-actions-button-primitive.png",
    )
    assert.ok(actionScreenshot.endsWith("task-dirbar-recent-actions-button-primitive.png"))
    await saveScreenshot(page, "task-dirbar-recent-trigger-keyboard.png")
  } finally {
    await browser.close()
    await server.close()
  }
}, { timeout: 60_000 })

test("cwd popup surfaces project discovery failures instead of rendering an empty detected-project state", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture((req) =>
    taskDirbarFixtureResponse(req, {
      discovery: {
        status: 503,
        body: { error: "discovery unavailable" },
      },
    }),
  )

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const unexpectedBadResponses: string[] = []
    page.on("response", (response: any) => {
      if (response.status() >= 400 && !response.url().endsWith("/global/projects/discover")) {
        unexpectedBadResponses.push(`${response.status()} ${response.url()}`)
      }
    })
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument((input: { directory: string; serverUrl: string }) => {
      localStorage.setItem("oc_directory", input.directory)
      localStorage.setItem("oc_saved_directory", input.directory)
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_server_url", input.serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem(
        "oc_recent_directories",
        JSON.stringify([input.directory, "D:/overlay/workspace/tools", "D:/overlay/workspace/docs"]),
      )
    }, { directory: PROJECT_DIRECTORY, serverUrl: server.origin })

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector(".task-cwd-dropdown", { visible: true })
    await page.waitForSelector('[data-ui="cwd-recent-trigger"]', { visible: true })
    await page.focus('[data-ui="cwd-recent-trigger"]')
    await page.keyboard.press("Enter")
    await page.waitForSelector('[data-testid="cwd-discovery-error"]', { visible: true })

    const state = await page.evaluate(() => ({
      text: document.querySelector('[data-testid="cwd-discovery-error"]')?.textContent || "",
      role: document.querySelector('[data-testid="cwd-discovery-error"]')?.getAttribute("role") || "",
      detectedRows: document.querySelectorAll(".recent-dir-section .recent-dir-row").length,
      recentRows: document.querySelectorAll('.recent-dir-list[data-kind="recent"] .recent-dir-row').length,
      hasManualPathInput: !!document.querySelector('[data-ui="cwd-path-input"]'),
      panelVisible: !!document.querySelector(".recent-dir-panel"),
    }))

    assert.deepEqual(state, {
      text: "Project discovery failed: API 503 global/projects/discover: discovery unavailable",
      role: "status",
      detectedRows: 0,
      recentRows: 3,
      hasManualPathInput: true,
      panelVisible: true,
    })
    assert.deepEqual(unexpectedBadResponses, [])
    const errorScreenshot = await saveElementScreenshot(page, ".recent-dir-panel", "task-dirbar-discovery-error.png")
    assert.ok(errorScreenshot.endsWith("task-dirbar-discovery-error.png"))
  } finally {
    await browser.close()
    await server.close()
  }
}, { timeout: 60_000 })
