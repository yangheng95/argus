import { describe, expect, test } from "bun:test"
import { AppiumDriver } from "../../src/opencorvus/automation/adapters/appium"

class ElementStub implements AppiumDriver.Element {
  elementId?: string
  clicks = 0
  value = ""
  attrs: Record<string, string> = {}

  constructor(id: string) {
    this.elementId = id
  }

  click() {
    this.clicks += 1
    return Promise.resolve()
  }

  isDisplayed() {
    return Promise.resolve(true)
  }

  isEnabled() {
    return Promise.resolve(true)
  }

  clear() {
    this.value = ""
    return Promise.resolve()
  }

  setValue(value: string) {
    this.value = value
    return Promise.resolve()
  }

  getText() {
    return Promise.resolve(this.value)
  }

  getAttribute(name: string) {
    return Promise.resolve(this.attrs[name] ?? null)
  }

  getRect() {
    return Promise.resolve({ x: 1, y: 2, width: 3, height: 4 })
  }
}

describe("appium automation adapter", () => {
  test("locates by accessibility id, types, and reads state", async () => {
    const username = new ElementStub("u-1")
    username.attrs["checked"] = "true"
    const lookup: Record<string, AppiumDriver.Element[]> = {
      "~username": [username],
    }
    const keys: Array<string | string[]> = []
    const scripts: string[] = []
    const client: AppiumDriver.Client = {
      $$: async (selector) => lookup[selector] ?? [],
      keys: async (value) => {
        keys.push(value)
      },
      pause: async () => {},
      execute: async (script) => {
        scripts.push(script)
        return true
      },
      takeScreenshot: async () => Buffer.from("image").toString("base64"),
      back: async () => {},
    }
    const driver = AppiumDriver.create({ client, appId: "com.demo.app" })
    const abort = new AbortController().signal
    const locate = await driver.locate({
      step: { id: "username", act: { kind: "type", text: "alice" } },
      target: [{ kind: "aid", value: "username" }],
      abort,
    })
    expect(locate.ok).toBe(true)
    const node = locate.ok && locate.data ? locate.data : null

    const type = await driver.act({
      step: { id: "username", act: { kind: "type", text: "alice" } },
      act: { kind: "type", text: "alice" },
      node,
      abort,
    })
    expect(type.ok).toBe(true)
    expect(username.value).toBe("alice")

    const state = await driver.check({
      step: { id: "username", act: { kind: "click" } },
      check: { kind: "state", key: "text", value: "ali" },
      node,
      stage: "post",
      abort,
    })
    expect(state.ok).toBe(true)

    const attr = await driver.check({
      step: { id: "username", act: { kind: "click" } },
      check: { kind: "state", key: "attr:checked", value: "true" },
      node,
      stage: "post",
      abort,
    })
    expect(attr.ok).toBe(true)

    const shot = await driver.snapshot?.({
      step: { id: "username", act: { kind: "click" } },
      attempt: 1,
      label: "ok",
      abort,
    })
    expect(shot?.id.startsWith("appium:ok:")).toBe(true)
    expect(keys).toHaveLength(0)
    expect(scripts).toHaveLength(0)
  })

  test("falls back to key scroll when mobile execute fails", async () => {
    const client: AppiumDriver.Client = {
      $$: async () => [],
      keys: async () => {},
      pause: async () => {},
      execute: async () => {
        throw new Error("gesture not supported")
      },
      takeScreenshot: async () => "",
    }
    const used: Array<string | string[]> = []
    client.keys = async (value) => {
      used.push(value)
    }
    const driver = AppiumDriver.create({ client })
    const abort = new AbortController().signal
    const result = await driver.act({
      step: { id: "scroll", act: { kind: "scroll", direction: "down", amount: 2 } },
      act: { kind: "scroll", direction: "down", amount: 2 },
      node: null,
      abort,
    })
    expect(result.ok).toBe(true)
    expect(used).toEqual([["PageDown"]])
  })

  test("types through client.keys when no element is located", async () => {
    const used: Array<string | string[]> = []
    const client: AppiumDriver.Client = {
      $$: async () => [],
      keys: async (value) => {
        used.push(value)
      },
      pause: async () => {},
      execute: async () => true,
      takeScreenshot: async () => "",
    }
    const driver = AppiumDriver.create({ client })
    const abort = new AbortController().signal
    const result = await driver.act({
      step: { id: "type", act: { kind: "type", text: "hello" } },
      act: { kind: "type", text: "hello" },
      node: null,
      abort,
    })
    expect(result.ok).toBe(true)
    expect(used).toEqual(["hello"])
  })
})
