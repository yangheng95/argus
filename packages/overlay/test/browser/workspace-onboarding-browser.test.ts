import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser, type OverlayPage } from "../launch.ts"
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

type OnboardingFixtureOptions = {
  projectPath: string
  discovery: { body: unknown; status?: number }
  requestedDirectories?: string[]
}

async function onboardingFixtureResponse(req: Request, options: OnboardingFixtureOptions): Promise<Response> {
  const url = new URL(req.url)
  const path = route(url)
  const directory = url.searchParams.get("directory")
  if (directory) options.requestedDirectories?.push(directory)
  if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
  if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
  const staticResponse = await overlayStaticResponse(path)
  if (staticResponse) return staticResponse
  if (path === "/global/projects/discover") return send(options.discovery.body, { status: options.discovery.status ?? 200 })
  if (path === "/global/health") return send({ version: "1.2.3" })
  if (path === "/mission") return send([])
  if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
  if (path === "/session") return send([])
  if (path === "/path") return send({ directory: directory ?? options.projectPath })
  if (path === "/vcs")
    return send({
      branch: "main",
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
  if (path === "/config/prompt") return send([])
  if (path === "/config") return send({})
  if (path === "/agent") return send([])
  if (path === "/channel") return send([])
  if (path === "/executor") return send([])
  if (path === "/skill/installed" || path === "/skill") return send([])
  if (path === "/mcp") return send({})
  if (path === "/panel/knowledge/memory") return send([])
  if (path === "/panel/knowledge/preference") return send([])
  if (path === "/log" && req.method === "POST") return send({ ok: true })
  return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
}

async function saveDialogScreenshot(page: OverlayPage) {
  const dialog = await page.$(".workspace-onboarding-form")
  assert.ok(dialog, "workspace onboarding dialog should exist before screenshot")
  const target = resolve(".scratch/workspace-onboarding-discovery-error.png")
  mkdirSync(dirname(target), { recursive: true })
  const screenshot = await dialog.screenshot({})
  assert.ok(screenshot.length > 0, "workspace onboarding error screenshot should not be empty")
  writeFileSync(target, screenshot)
  return target
}

async function saveElementScreenshot(page: OverlayPage, selector: string, name: string) {
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const target = resolve(".scratch", name)
  mkdirSync(dirname(target), { recursive: true })
  const screenshot = await element.screenshot({})
  assert.ok(screenshot.length > 0, `${name} screenshot should not be empty`)
  writeFileSync(target, screenshot)
  return target
}

async function focusByTab(page: OverlayPage, testID: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.keyboard.press("Tab")
    const activeTestID = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? "")
    if (activeTestID === testID) return
  }
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? ""), testID)
}

test("browser overlay opens a project by submitting an explicit server path", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requestedDirectories: string[] = []
  const projectPath = "D:/browser-overlay/project"
  const server = await startBrowserFixture((req) =>
    onboardingFixtureResponse(req, {
      projectPath,
      requestedDirectories,
      discovery: {
        body: {
          root: "D:/browser-overlay",
          defaultDirectory: "",
          projects: [],
        },
      },
    }),
  )

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1120, height: 720 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.removeItem("oc_directory")
    }, server.port)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-testid="workspace-onboarding-browser-path-form"]', { visible: true })
    await page.focus('[data-testid="workspace-onboarding-browser-path-input"]')
    const pathInputState = await page.$eval('[data-testid="workspace-onboarding-browser-path-input"]', (node) => {
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
    assert.ok(
      (await saveElementScreenshot(
        page,
        ".workspace-onboarding-form",
        "workspace-onboarding-path-input-field-input.png",
      )).endsWith("workspace-onboarding-path-input-field-input.png"),
    )
    await page.type('[data-testid="workspace-onboarding-browser-path-input"]', projectPath)
    await page.click('[data-testid="workspace-onboarding-browser-path-submit"]')
    await page.waitForFunction((expected) => (window as any).settingsStore.directory === expected, {}, projectPath)

    const state = await page.evaluate(() => ({
      hostIsBrowser: !("__TAURI__" in window),
      directory: (window as any).settingsStore.directory,
      savedDirectory: (window as any).settingsStore.savedDirectory,
      persistedDirectory: localStorage.getItem("oc_directory"),
      hasNativeOpenButton: !!document.querySelector('[data-testid="workspace-onboarding-open-folder"]'),
    }))

    assert.deepEqual(state, {
      hostIsBrowser: true,
      directory: projectPath,
      savedDirectory: projectPath,
      persistedDirectory: projectPath,
      hasNativeOpenButton: false,
    })
    assert.ok(requestedDirectories.includes(projectPath))
  } finally {
    await browser.close()
    await server.close()
  }
})

test("browser onboarding surfaces project discovery failures instead of rendering an empty detected-project state", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture((req) =>
    onboardingFixtureResponse(req, {
      projectPath: "D:/browser-overlay/project",
      discovery: {
        status: 503,
        body: { error: "discovery unavailable" },
      },
    }),
  )

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1120, height: 720 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.removeItem("oc_directory")
    }, server.port)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-testid="workspace-onboarding-discovery-error"]', { visible: true })

    const state = await page.evaluate(() => ({
      directory: (window as any).settingsStore.directory,
      text: document.querySelector('[data-testid="workspace-onboarding-discovery-error"]')?.textContent || "",
      detectedCount: document.querySelectorAll('[data-testid^="workspace-onboarding-detected-"]').length,
      hasManualPathForm: !!document.querySelector('[data-testid="workspace-onboarding-browser-path-form"]'),
    }))

    assert.deepEqual(state, {
      directory: "",
      text: "Project discovery failed: API 503 global/projects/discover: discovery unavailable",
      detectedCount: 0,
      hasManualPathForm: true,
    })
    assert.ok((await saveDialogScreenshot(page)).endsWith("workspace-onboarding-discovery-error.png"))
  } finally {
    await browser.close()
    await server.close()
  }
})

test("browser onboarding directory rows use Button focus chrome and keep setDirectory actions", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requestedDirectories: string[] = []
  const detectedPath = "D:/browser-overlay/detected-app"
  const recentPath = "D:/browser-overlay/recent-app"
  const discovery = {
    body: {
      root: "D:/browser-overlay",
      defaultDirectory: "",
      projects: [{ name: "detected-app", directory: detectedPath, marker: ".opencorvus" }],
    },
  }
  const server = await startBrowserFixture((req) =>
    onboardingFixtureResponse(req, {
      projectPath: detectedPath,
      requestedDirectories,
      discovery,
    }),
  )

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const openOnboardingPage = async () => {
      const page = await browser.newPage()
      await page.setViewport({ width: 1120, height: 760 })
      await page.evaluateOnNewDocument(
        ({ portValue, recentDirectory }) => {
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.removeItem("oc_directory")
          localStorage.setItem("oc_recent_directories", JSON.stringify([recentDirectory]))
        },
        { portValue: server.port, recentDirectory: recentPath },
      )
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await page.waitForSelector('[data-testid="workspace-onboarding-detected-0"]', { visible: true })
      await page.waitForSelector('[data-testid="workspace-onboarding-recent-0"]', { visible: true })
      return page
    }

    const page = await openOnboardingPage()
    const rowState = await page.evaluate(() => {
      const detected = document.querySelector<HTMLButtonElement>('[data-testid="workspace-onboarding-detected-0"]')
      const recent = document.querySelector<HTMLButtonElement>('[data-testid="workspace-onboarding-recent-0"]')
      return {
        oldClassCount: document.querySelectorAll(".workspace-onboarding-recent-item").length,
        detectedClass: detected?.className ?? "",
        recentClass: recent?.className ?? "",
        detectedDataUi: detected?.dataset.ui ?? "",
        recentDataUi: recent?.dataset.ui ?? "",
        detectedVariant: detected?.dataset.variant ?? "",
        recentVariant: recent?.dataset.variant ?? "",
        detectedSize: detected?.dataset.size ?? "",
        recentSize: recent?.dataset.size ?? "",
        detectedTone: detected?.dataset.tone ?? "",
        recentTone: recent?.dataset.tone ?? "",
      }
    })
    assert.deepEqual(rowState, {
      oldClassCount: 0,
      detectedClass: "oc-button",
      recentClass: "oc-button",
      detectedDataUi: "workspace-onboarding-directory-row",
      recentDataUi: "workspace-onboarding-directory-row",
      detectedVariant: "ghost",
      recentVariant: "ghost",
      detectedSize: "md",
      recentSize: "md",
      detectedTone: "neutral",
      recentTone: "neutral",
    })

    await focusByTab(page, "workspace-onboarding-detected-0")
    const detectedFocus = await page.$eval('[data-testid="workspace-onboarding-detected-0"]', (node) => {
      const button = node as HTMLElement
      const style = getComputedStyle(button)
      const rect = button.getBoundingClientRect()
      return {
        active: document.activeElement === button,
        focusVisible: button.matches(":focus-visible"),
        display: style.display,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        backgroundColor: style.backgroundColor,
        width: rect.width,
        height: rect.height,
      }
    })
    assert.equal(detectedFocus.active, true)
    assert.equal(detectedFocus.focusVisible, true)
    assert.equal(detectedFocus.display, "grid")
    assert.notEqual(detectedFocus.outlineStyle, "none")
    assert.notEqual(detectedFocus.outlineWidth, "0px")
    assert.notEqual(detectedFocus.backgroundColor, "rgba(0, 0, 0, 0)")
    assert.ok(detectedFocus.width > 400, JSON.stringify(detectedFocus))
    assert.ok(detectedFocus.height >= 50, JSON.stringify(detectedFocus))
    assert.ok((await saveElementScreenshot(page, ".workspace-onboarding-form", "workspace-onboarding-detected-row-focus.png")).endsWith("workspace-onboarding-detected-row-focus.png"))

    await focusByTab(page, "workspace-onboarding-recent-0")
    const recentFocus = await page.$eval('[data-testid="workspace-onboarding-recent-0"]', (node) => {
      const button = node as HTMLElement
      const style = getComputedStyle(button)
      const rect = button.getBoundingClientRect()
      return {
        active: document.activeElement === button,
        focusVisible: button.matches(":focus-visible"),
        display: style.display,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        backgroundColor: style.backgroundColor,
        width: rect.width,
        height: rect.height,
      }
    })
    assert.equal(recentFocus.active, true)
    assert.equal(recentFocus.focusVisible, true)
    assert.equal(recentFocus.display, "grid")
    assert.notEqual(recentFocus.outlineStyle, "none")
    assert.notEqual(recentFocus.outlineWidth, "0px")
    assert.notEqual(recentFocus.backgroundColor, "rgba(0, 0, 0, 0)")
    assert.ok(recentFocus.width > 400, JSON.stringify(recentFocus))
    assert.ok(recentFocus.height >= 50, JSON.stringify(recentFocus))
    assert.ok((await saveElementScreenshot(page, ".workspace-onboarding-form", "workspace-onboarding-recent-row-focus.png")).endsWith("workspace-onboarding-recent-row-focus.png"))

    await page.click('[data-testid="workspace-onboarding-detected-0"]')
    await page.waitForFunction((expected) => (window as any).settingsStore.directory === expected, {}, detectedPath)
    await page.close()

    const recentPage = await openOnboardingPage()
    await recentPage.click('[data-testid="workspace-onboarding-recent-0"]')
    await recentPage.waitForFunction((expected) => (window as any).settingsStore.directory === expected, {}, recentPath)
    await recentPage.close()

    assert.ok(requestedDirectories.includes(detectedPath))
    assert.ok(requestedDirectories.includes(recentPath))
  } finally {
    await browser.close()
    await server.close()
  }
})
