import { AppiumDriver } from "./adapters/appium"
import { PlaywrightDriver } from "./adapters/playwright"
import type { DriverInput } from "./driver"

const DEFAULT_PLAYWRIGHT_GLOBAL = "__opencorvus_playwright_page"
const DEFAULT_APPIUM_GLOBAL = "__opencorvus_appium_client"

type Context = {
  playwright?: PlaywrightDriver.Opt
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

export namespace AutomationRuntime {
  export const Global = {
    playwright: DEFAULT_PLAYWRIGHT_GLOBAL,
    appium: DEFAULT_APPIUM_GLOBAL,
  } as const

  export function setPlaywright(input: PlaywrightDriver.Opt) {
    state.playwright = input
    touch()
  }

  export function setAppium(input: AppiumDriver.Opt) {
    state.appium = input
    touch()
  }

  export function clear(kind?: "playwright" | "appium") {
    if (kind === "playwright") {
      delete state.playwright
      touch()
      return
    }
    if (kind === "appium") {
      delete state.appium
      touch()
      return
    }
    delete state.playwright
    delete state.appium
    touch()
  }

  export function status() {
    return {
      playwright: !!state.playwright,
      appium: !!state.appium,
      globals: {
        playwright: DEFAULT_PLAYWRIGHT_GLOBAL,
        appium: DEFAULT_APPIUM_GLOBAL,
      },
      updatedAt: state.updatedAt,
    }
  }

  export function attach(input: {
    playwrightGlobal?: string
    appiumGlobal?: string
    appiumAppId?: string
  } = {}) {
    const pkey = input.playwrightGlobal ?? DEFAULT_PLAYWRIGHT_GLOBAL
    const akey = input.appiumGlobal ?? DEFAULT_APPIUM_GLOBAL
    const p = asPlaywrightPage(pick(pkey))
    if (p) {
      state.playwright = { page: p }
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
      appium: !!a,
      globals: { playwright: pkey, appium: akey },
      updatedAt: state.updatedAt,
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
