import { AppiumDriver } from "./adapters/appium"
import { PlaywrightDriver } from "./adapters/playwright"
import type { DriverInput } from "./driver"

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

export namespace AutomationRuntime {
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
