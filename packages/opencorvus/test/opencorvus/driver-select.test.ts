import { describe, expect, test } from "bun:test"
import { Automation } from "../../src/opencorvus/automation/engine"
import { selectDriver } from "../../src/opencorvus/automation/driver"
import { PlaywrightDriver } from "../../src/opencorvus/automation/adapters/playwright"
import { AppiumDriver } from "../../src/opencorvus/automation/adapters/appium"

function desktop() {
  return {
    locate: async () => ({ ok: true, data: { id: "d" } }),
    check: async () => ({ ok: true }),
    act: async () => ({ ok: true }),
  } satisfies Automation.Driver
}

function page() {
  const locator: PlaywrightDriver.Locator = {
    count: async () => 0,
    first: () => locator,
    click: async () => {},
    fill: async () => {},
    isVisible: async () => true,
    isEnabled: async () => true,
    evaluate: async <T>(fn: (element: Element, arg?: unknown) => T | Promise<T>, arg?: unknown) => fn({} as Element, arg),
  }
  return {
    locator: () => locator,
    getByRole: () => locator,
    getByText: () => locator,
    keyboard: { press: async () => {} },
    mouse: { wheel: async () => {} },
    screenshot: async () => new Uint8Array([1]),
  } satisfies PlaywrightDriver.Page
}

function client() {
  return {
    $$: async () => [],
    keys: async () => {},
    pause: async () => {},
    execute: async () => true,
    takeScreenshot: async () => "",
  } satisfies AppiumDriver.Client
}

describe("automation driver select", () => {
  test("prefers explicit desktop", () => {
    const result = selectDriver({
      kind: "desktop",
      desktop: desktop(),
      playwright: { page: page() },
      appium: { client: client() },
    })
    expect(result.kind).toBe("desktop")
  })

  test("auto prefers playwright over appium and desktop", () => {
    const result = selectDriver({
      kind: "auto",
      desktop: desktop(),
      playwright: { page: page() },
      appium: { client: client() },
    })
    expect(result.kind).toBe("playwright")
  })

  test("falls back to desktop when requested appium is unavailable", () => {
    const result = selectDriver({
      kind: "appium",
      desktop: desktop(),
    })
    expect(result.kind).toBe("desktop")
  })

  test("uses env override when kind is omitted", () => {
    const previous = process.env.OPENCORVUS_AUTOMATION_DRIVER
    process.env.OPENCORVUS_AUTOMATION_DRIVER = "appium"
    try {
      const result = selectDriver({
        desktop: desktop(),
        appium: { client: client() },
      })
      expect(result.kind).toBe("appium")
    } finally {
      if (previous === undefined) delete process.env.OPENCORVUS_AUTOMATION_DRIVER
      else process.env.OPENCORVUS_AUTOMATION_DRIVER = previous
    }
  })

  test("throws when no driver is available", () => {
    expect(() => selectDriver({ kind: "desktop" })).toThrow("No automation driver available")
  })
})
