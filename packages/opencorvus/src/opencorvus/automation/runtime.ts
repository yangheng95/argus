import { AppiumDriver } from "./adapters/appium"
import { PlaywrightDriver } from "./adapters/playwright"
import type { DriverInput } from "./driver"

const DEFAULT_PLAYWRIGHT_GLOBAL = "__opencorvus_playwright_page"
const DEFAULT_PLAYWRIGHT_LAUNCHER_GLOBAL = "__opencorvus_playwright_launcher"
const DEFAULT_APPIUM_GLOBAL = "__opencorvus_appium_client"

export type WaitUntil = "load" | "domcontentloaded" | "networkidle"

type PlaywrightPage = PlaywrightDriver.Page & {
  goto?: (url: string, input?: { waitUntil?: WaitUntil; timeout?: number }) => Promise<unknown>
  close?: () => Promise<void>
  url?: () => string
  title?: () => Promise<string>
  context?: () => PlaywrightContext
}

type PlaywrightContext = {
  newPage: () => Promise<PlaywrightPage>
  pages: () => PlaywrightPage[]
  close?: () => Promise<void>
}

type PlaywrightBrowser = {
  newContext: (input?: Record<string, unknown>) => Promise<PlaywrightContext>
  close?: () => Promise<void>
}

type PlaywrightLauncher = {
  chromium: {
    launch: (input?: { headless?: boolean }) => Promise<PlaywrightBrowser>
  }
}

type PlaywrightSession = {
  browser?: PlaywrightBrowser
  context?: PlaywrightContext
  pages: PlaywrightPage[]
  active: number
  managed: boolean
}

type Context = {
  playwright?: PlaywrightDriver.Opt
  playwrightSession?: PlaywrightSession
  playwrightLauncher?: PlaywrightLauncher
  appium?: AppiumDriver.Opt
  updatedAt: number
}

const state: Context = {
  updatedAt: Date.now(),
}

function touch() {
  state.updatedAt = Date.now()
}

function hasMethod(value: unknown, name: string) {
  if (!value || typeof value !== "object") return false
  return typeof Reflect.get(value, name) === "function"
}

function asPlaywrightPage(value: unknown): PlaywrightDriver.Page | null {
  if (!hasMethod(value, "locator")) return null
  if (!hasMethod(value, "getByRole")) return null
  if (!hasMethod(value, "getByText")) return null
  if (!hasMethod(value, "screenshot")) return null
  const keyboard = value && typeof value === "object" ? Reflect.get(value, "keyboard") : null
  const mouse = value && typeof value === "object" ? Reflect.get(value, "mouse") : null
  if (!keyboard || typeof keyboard !== "object") return null
  if (!mouse || typeof mouse !== "object") return null
  if (typeof Reflect.get(keyboard, "press") !== "function") return null
  if (typeof Reflect.get(mouse, "wheel") !== "function") return null
  return value as PlaywrightDriver.Page
}

function asPlaywrightContext(value: unknown): PlaywrightContext | null {
  if (!hasMethod(value, "newPage")) return null
  if (!hasMethod(value, "pages")) return null
  return value as PlaywrightContext
}

function asPlaywrightBrowser(value: unknown): PlaywrightBrowser | null {
  if (!hasMethod(value, "newContext")) return null
  return value as PlaywrightBrowser
}

function asPlaywrightLauncher(value: unknown): PlaywrightLauncher | null {
  if (!value || typeof value !== "object") return null
  const chromium = Reflect.get(value, "chromium")
  if (!chromium || typeof chromium !== "object") return null
  if (typeof Reflect.get(chromium, "launch") !== "function") return null
  return value as PlaywrightLauncher
}

function asAppiumClient(value: unknown): AppiumDriver.Client | null {
  if (!hasMethod(value, "$$")) return null
  if (!hasMethod(value, "keys")) return null
  if (!hasMethod(value, "pause")) return null
  if (!hasMethod(value, "execute")) return null
  if (!hasMethod(value, "takeScreenshot")) return null
  return value as AppiumDriver.Client
}

function pick(key: string) {
  if (key.length === 0) return undefined
  return Reflect.get(globalThis as object, key)
}

function detail(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function asPage(value: unknown) {
  const page = asPlaywrightPage(value)
  if (!page) return null
  return page as PlaywrightPage
}

function pagesFromContext(context?: PlaywrightContext) {
  if (!context) return []
  const pages = context.pages()
  return pages.map((page) => asPage(page)).filter((page): page is PlaywrightPage => !!page)
}

function getSession() {
  if (!state.playwright && !state.playwrightSession) return null
  if (!state.playwrightSession) {
    const page = asPage(state.playwright?.page)
    if (!page) {
      delete state.playwright
      return null
    }
    const context = typeof page.context === "function" ? asPlaywrightContext(page.context()) : null
    const pages = context ? pagesFromContext(context) : [page]
    state.playwrightSession = {
      context: context ?? undefined,
      pages: pages.length > 0 ? pages : [page],
      active: Math.max(0, pages.indexOf(page)),
      managed: false,
    }
  }
  if (!state.playwrightSession) return null
  const session = state.playwrightSession
  const pages = session.context ? pagesFromContext(session.context) : session.pages
  if (pages.length > 0) session.pages = pages
  if (session.pages.length === 0) {
    delete state.playwright
    delete state.playwrightSession
    return null
  }
  session.active = Math.min(Math.max(session.active, 0), session.pages.length - 1)
  const page = session.pages[session.active]
  state.playwright = { page }
  return session
}

async function title(page: PlaywrightPage) {
  if (!page.title) return undefined
  return page.title().catch(() => undefined)
}

function url(page: PlaywrightPage) {
  if (!page.url) return ""
  return page.url()
}

async function list(session: PlaywrightSession) {
  const tabs = await Promise.all(
    session.pages.map(async (page, index) => ({
      index,
      active: index === session.active,
      url: url(page),
      title: await title(page),
    })),
  )
  return {
    tabs,
    active: session.active,
    total: tabs.length,
    managed: session.managed,
  }
}

async function goto(
  page: PlaywrightPage,
  input: {
    url: string
    timeoutMs?: number
    waitUntil?: WaitUntil
  },
) {
  if (!page.goto) {
    return {
      ok: false,
      reason: "goto_unavailable",
      detail: "Attached page does not support goto.",
    }
  }
  const result = await page
    .goto(input.url, {
      timeout: input.timeoutMs,
      waitUntil: input.waitUntil,
    })
    .then(() => true)
    .catch((error) => error)
  if (result === true) return { ok: true }
  return {
    ok: false,
    reason: "navigation_failed",
    detail: detail(result),
  }
}

async function loadModule(id: string) {
  return import(id).catch(() => null)
}

async function launcher(globalKey?: string) {
  if (state.playwrightLauncher) return state.playwrightLauncher
  const key = globalKey ?? DEFAULT_PLAYWRIGHT_LAUNCHER_GLOBAL
  const globalLauncher = asPlaywrightLauncher(pick(key))
  if (globalLauncher) {
    state.playwrightLauncher = globalLauncher
    return globalLauncher
  }
  const mods = await Promise.all([
    loadModule("playwright"),
    loadModule("playwright-core"),
    loadModule("@playwright/test"),
  ])
  const found = mods
    .map((mod) => {
      if (!mod || typeof mod !== "object") return null
      return asPlaywrightLauncher(mod) ?? asPlaywrightLauncher(Reflect.get(mod, "default"))
    })
    .find((mod): mod is PlaywrightLauncher => !!mod)
  if (!found) return null
  state.playwrightLauncher = found
  return found
}

export namespace AutomationRuntime {
  export const Global = {
    playwright: DEFAULT_PLAYWRIGHT_GLOBAL,
    playwrightLauncher: DEFAULT_PLAYWRIGHT_LAUNCHER_GLOBAL,
    appium: DEFAULT_APPIUM_GLOBAL,
  } as const

  export function setPlaywright(input: PlaywrightDriver.Opt) {
    const page = asPage(input.page)
    if (!page) return
    const context = typeof page.context === "function" ? asPlaywrightContext(page.context()) : null
    const pages = context ? pagesFromContext(context) : [page]
    state.playwright = { ...input, page }
    state.playwrightSession = {
      context: context ?? undefined,
      pages: pages.length > 0 ? pages : [page],
      active: Math.max(0, pages.indexOf(page)),
      managed: false,
    }
    touch()
  }

  export function setPlaywrightLauncher(input?: unknown) {
    if (!input) {
      delete state.playwrightLauncher
      touch()
      return
    }
    const launcher = asPlaywrightLauncher(input)
    if (!launcher) return
    state.playwrightLauncher = launcher
    touch()
  }

  export function setAppium(input: AppiumDriver.Opt) {
    state.appium = input
    touch()
  }

  export function clear(kind?: "playwright" | "appium") {
    if (kind === "playwright") {
      delete state.playwright
      delete state.playwrightSession
      touch()
      return
    }
    if (kind === "appium") {
      delete state.appium
      touch()
      return
    }
    delete state.playwright
    delete state.playwrightSession
    delete state.appium
    touch()
  }

  export function status() {
    const session = getSession()
    return {
      playwright: !!state.playwright,
      appium: !!state.appium,
      playwrightTabs: session?.pages.length ?? 0,
      playwrightActiveTab: session?.active ?? -1,
      playwrightManaged: session?.managed ?? false,
      playwrightLauncher: !!state.playwrightLauncher,
      globals: {
        playwright: DEFAULT_PLAYWRIGHT_GLOBAL,
        playwrightLauncher: DEFAULT_PLAYWRIGHT_LAUNCHER_GLOBAL,
        appium: DEFAULT_APPIUM_GLOBAL,
      },
      updatedAt: state.updatedAt,
    }
  }

  export function attach(
    input: {
      playwrightGlobal?: string
      playwrightLauncherGlobal?: string
      appiumGlobal?: string
      appiumAppId?: string
    } = {},
  ) {
    const pkey = input.playwrightGlobal ?? DEFAULT_PLAYWRIGHT_GLOBAL
    const lkey = input.playwrightLauncherGlobal ?? DEFAULT_PLAYWRIGHT_LAUNCHER_GLOBAL
    const akey = input.appiumGlobal ?? DEFAULT_APPIUM_GLOBAL
    const p = asPage(pick(pkey))
    if (p) {
      setPlaywright({ page: p })
    }
    const l = asPlaywrightLauncher(pick(lkey))
    if (l) {
      state.playwrightLauncher = l
    }
    const a = asAppiumClient(pick(akey))
    if (a) {
      state.appium = {
        client: a,
        appId: input.appiumAppId,
      }
    }
    touch()
    return {
      playwright: !!p,
      playwrightLauncher: !!l,
      appium: !!a,
      globals: { playwright: pkey, playwrightLauncher: lkey, appium: akey },
      updatedAt: state.updatedAt,
    }
  }

  export async function startPlaywright(
    input: {
      headless?: boolean
      url?: string
      timeoutMs?: number
      waitUntil?: WaitUntil
      playwrightLauncherGlobal?: string
    } = {},
  ) {
    const current = getSession()
    if (current?.managed && current.pages.length > 0) {
      return {
        ok: true,
        started: false,
        reason: "already_started",
        ...(await list(current)),
      }
    }
    const init = await launcher(input.playwrightLauncherGlobal)
    if (!init) {
      return {
        ok: false,
        reason: "playwright_launcher_unavailable",
        detail: `No Playwright launcher found. Set globalThis.${DEFAULT_PLAYWRIGHT_LAUNCHER_GLOBAL} or install playwright.`,
      }
    }
    const browser = await init.chromium
      .launch({ headless: input.headless ?? true })
      .then((value) => asPlaywrightBrowser(value))
      .catch(() => null)
    if (!browser) {
      return {
        ok: false,
        reason: "browser_launch_failed",
        detail: "Failed to launch Chromium with Playwright.",
      }
    }
    const context = await browser
      .newContext()
      .then((value) => asPlaywrightContext(value))
      .catch(() => null)
    if (!context) {
      return {
        ok: false,
        reason: "context_create_failed",
        detail: "Failed to create browser context.",
      }
    }
    const page = await context
      .newPage()
      .then((value) => asPage(value))
      .catch(() => null)
    if (!page) {
      return {
        ok: false,
        reason: "page_create_failed",
        detail: "Failed to create browser tab.",
      }
    }
    state.playwrightSession = {
      browser,
      context,
      pages: [page],
      active: 0,
      managed: true,
    }
    state.playwright = { page }
    if (input.url) {
      const opened = await goto(page, {
        url: input.url,
        timeoutMs: input.timeoutMs,
        waitUntil: input.waitUntil,
      })
      if (!opened.ok) {
        touch()
        return {
          ok: false,
          reason: opened.reason,
          detail: opened.detail,
        }
      }
    }
    touch()
    return {
      ok: true,
      started: true,
      ...(await list(state.playwrightSession)),
    }
  }

  export async function stopPlaywright() {
    const session = getSession()
    if (!session) {
      return {
        ok: false,
        reason: "runtime_unavailable",
        detail: "Playwright runtime is not attached.",
      }
    }
    const closeContext =
      session.managed && session.context?.close
        ? session.context
            .close()
            .then(() => true)
            .catch(() => false)
        : Promise.resolve(false)
    const closeBrowser =
      session.managed && session.browser?.close
        ? session.browser
            .close()
            .then(() => true)
            .catch(() => false)
        : Promise.resolve(false)
    const closed = await Promise.all([closeContext, closeBrowser])
    delete state.playwright
    delete state.playwrightSession
    touch()
    return {
      ok: true,
      stopped: true,
      managed: session.managed,
      contextClosed: closed[0],
      browserClosed: closed[1],
    }
  }

  export async function listPlaywrightTabs() {
    const session = getSession()
    if (!session) {
      return {
        ok: false,
        reason: "runtime_unavailable",
        detail: "Playwright runtime is not attached.",
      }
    }
    touch()
    return {
      ok: true,
      ...(await list(session)),
    }
  }

  export async function openPlaywright(input: { url: string; timeoutMs?: number; waitUntil?: WaitUntil }) {
    const session = getSession()
    if (!session) {
      return {
        ok: false,
        reason: "runtime_unavailable",
        detail: "Playwright runtime is not attached.",
      }
    }
    const page = session.pages[session.active]
    const opened = await goto(page, input)
    if (!opened.ok) {
      return {
        ok: false,
        reason: opened.reason,
        detail: opened.detail,
      }
    }
    touch()
    return {
      ok: true,
      ...(await list(session)),
    }
  }

  export async function newPlaywrightTab(
    input: {
      url?: string
      timeoutMs?: number
      waitUntil?: WaitUntil
    } = {},
  ) {
    const session = getSession()
    if (!session) {
      return {
        ok: false,
        reason: "runtime_unavailable",
        detail: "Playwright runtime is not attached.",
      }
    }
    const page = session.pages[session.active]
    const context = session.context ?? (typeof page.context === "function" ? asPlaywrightContext(page.context()) : null)
    if (!context) {
      return {
        ok: false,
        reason: "context_unavailable",
        detail: "Active page does not expose a browser context.",
      }
    }
    const created = await context
      .newPage()
      .then((value) => asPage(value))
      .catch(() => null)
    if (!created) {
      return {
        ok: false,
        reason: "page_create_failed",
        detail: "Failed to create browser tab.",
      }
    }
    session.context = context
    const pages = pagesFromContext(context)
    session.pages = pages.length > 0 ? pages : [...session.pages, created]
    session.active = Math.max(
      0,
      session.pages.findIndex((item) => item === created),
    )
    state.playwright = { page: created }
    if (input.url) {
      const opened = await goto(created, {
        url: input.url,
        timeoutMs: input.timeoutMs,
        waitUntil: input.waitUntil,
      })
      if (!opened.ok) {
        touch()
        return {
          ok: false,
          reason: opened.reason,
          detail: opened.detail,
        }
      }
    }
    touch()
    return {
      ok: true,
      ...(await list(session)),
    }
  }

  export async function switchPlaywrightTab(input: { index: number }) {
    const session = getSession()
    if (!session) {
      return {
        ok: false,
        reason: "runtime_unavailable",
        detail: "Playwright runtime is not attached.",
      }
    }
    if (input.index < 0 || input.index >= session.pages.length) {
      return {
        ok: false,
        reason: "tab_not_found",
        detail: `Tab index out of range: ${input.index}.`,
      }
    }
    session.active = input.index
    const page = session.pages[input.index]
    state.playwright = { page }
    if (page.bringToFront) {
      await page.bringToFront().catch(() => {})
    }
    touch()
    return {
      ok: true,
      ...(await list(session)),
    }
  }

  export async function closePlaywrightTab(input: { index?: number } = {}) {
    const session = getSession()
    if (!session) {
      return {
        ok: false,
        reason: "runtime_unavailable",
        detail: "Playwright runtime is not attached.",
      }
    }
    const index = input.index ?? session.active
    if (index < 0 || index >= session.pages.length) {
      return {
        ok: false,
        reason: "tab_not_found",
        detail: `Tab index out of range: ${index}.`,
      }
    }
    const page = session.pages[index]
    if (!page.close) {
      return {
        ok: false,
        reason: "close_unavailable",
        detail: "Active tab does not support close().",
      }
    }
    const closed = await page
      .close()
      .then(() => true)
      .catch((error) => error)
    if (closed !== true) {
      return {
        ok: false,
        reason: "tab_close_failed",
        detail: detail(closed),
      }
    }
    const pages = session.context ? pagesFromContext(session.context) : session.pages.filter((_, i) => i !== index)
    if (pages.length === 0) {
      delete state.playwright
      delete state.playwrightSession
      touch()
      return {
        ok: true,
        total: 0,
        tabs: [],
        active: -1,
        managed: session.managed,
      }
    }
    session.pages = pages
    session.active = Math.min(index, session.pages.length - 1)
    state.playwright = { page: session.pages[session.active] }
    touch()
    return {
      ok: true,
      ...(await list(session)),
    }
  }

  export function merge(input: DriverInput): DriverInput {
    return {
      ...input,
      playwright: input.playwright ?? state.playwright,
      appium: input.appium ?? state.appium,
    }
  }
}
