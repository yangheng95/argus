import { describe, expect, test } from "bun:test"
import { PlaywrightDriver } from "../../src/opencorvus/automation/adapters/playwright"

class LocatorStub implements PlaywrightDriver.Locator {
  clicks = 0
  fills: string[] = []
  scrolls = 0

  constructor(
    private state: {
      count: number
      visible: boolean
      enabled: boolean
      text: string
      attrs: Record<string, string>
      rect: { x: number; y: number; width: number; height: number }
    },
  ) {}

  count() {
    return Promise.resolve(this.state.count)
  }

  first() {
    return this
  }

  click() {
    this.clicks += 1
    return Promise.resolve()
  }

  fill(value: string) {
    this.fills.push(value)
    this.state.text = value
    return Promise.resolve()
  }

  isVisible() {
    return Promise.resolve(this.state.visible)
  }

  isEnabled() {
    return Promise.resolve(this.state.enabled)
  }

  evaluate<T>(fn: (element: Element, arg?: unknown) => T | Promise<T>, arg?: unknown) {
    const element = {
      textContent: this.state.text,
      getAttribute: (name: string) => this.state.attrs[name] ?? null,
      getBoundingClientRect: () => this.state.rect,
    } as unknown as Element
    return Promise.resolve(fn(element, arg))
  }

  scrollIntoViewIfNeeded() {
    this.scrolls += 1
    return Promise.resolve()
  }
}

describe("playwright automation adapter", () => {
  test("locates by weight, executes click, and takes snapshot", async () => {
    const calls: string[] = []
    const miss = new LocatorStub({
      count: 0,
      visible: true,
      enabled: true,
      text: "none",
      attrs: {},
      rect: { x: 0, y: 0, width: 10, height: 10 },
    })
    const role = new LocatorStub({
      count: 1,
      visible: true,
      enabled: true,
      text: "Save",
      attrs: { "data-saved": "yes" },
      rect: { x: 10, y: 20, width: 30, height: 40 },
    })
    const page: PlaywrightDriver.Page = {
      locator: () => {
        calls.push("aid")
        return miss
      },
      getByRole: () => {
        calls.push("role")
        return role
      },
      getByText: () => {
        calls.push("text")
        return miss
      },
      keyboard: {
        press: async () => {},
      },
      mouse: {
        wheel: async () => {},
      },
      screenshot: async () => new Uint8Array([1, 2, 3]),
    }
    const driver = PlaywrightDriver.create({ page })
    const abort = new AbortController().signal
    const locate = await driver.locate({
      step: { id: "save", act: { kind: "click" } },
      target: [
        { kind: "text", value: "missing", weight: 0 },
        { kind: "role", value: "button", name: "Save", weight: 4 },
        { kind: "aid", value: "save-btn", weight: 2 },
      ],
      abort,
    })
    expect(locate.ok).toBe(true)
    expect(calls).toEqual(["role"])

    const node = locate.ok && locate.data ? locate.data : null
    const visible = await driver.check({
      step: { id: "save", act: { kind: "click" } },
      check: { kind: "visible" },
      node,
      stage: "pre",
      abort,
    })
    expect(visible.ok).toBe(true)

    const clicked = await driver.act({
      step: { id: "save", act: { kind: "click" } },
      act: { kind: "click" },
      node,
      abort,
    })
    expect(clicked.ok).toBe(true)
    expect(role.clicks).toBe(1)

    const shot = await driver.snapshot?.({
      step: { id: "save", act: { kind: "click" } },
      attempt: 1,
      label: "ok",
      abort,
    })
    expect(shot?.id.startsWith("pw:ok:")).toBe(true)
  })

  test("supports hotkey, type, and scroll actions without located node", async () => {
    const keys: string[] = []
    const typed: string[] = []
    const wheel: number[] = []
    const page: PlaywrightDriver.Page = {
      locator: () =>
        new LocatorStub({
          count: 0,
          visible: true,
          enabled: true,
          text: "",
          attrs: {},
          rect: { x: 0, y: 0, width: 10, height: 10 },
        }),
      getByRole: () =>
        new LocatorStub({
          count: 0,
          visible: true,
          enabled: true,
          text: "",
          attrs: {},
          rect: { x: 0, y: 0, width: 10, height: 10 },
        }),
      getByText: () =>
        new LocatorStub({
          count: 0,
          visible: true,
          enabled: true,
          text: "",
          attrs: {},
          rect: { x: 0, y: 0, width: 10, height: 10 },
        }),
      keyboard: {
        press: async (key) => {
          keys.push(key)
        },
        type: async (text) => {
          typed.push(text)
        },
      },
      mouse: {
        wheel: async (_x, y) => {
          wheel.push(y)
        },
      },
      screenshot: async () => new Uint8Array([5]),
    }
    const driver = PlaywrightDriver.create({ page })
    const abort = new AbortController().signal
    const hotkey = await driver.act({
      step: { id: "k", act: { kind: "hotkey", keys: ["ctrl", "l"] } },
      act: { kind: "hotkey", keys: ["ctrl", "l"] },
      node: null,
      abort,
    })
    expect(hotkey.ok).toBe(true)
    expect(keys).toEqual(["ctrl+l"])

    const type = await driver.act({
      step: { id: "t", act: { kind: "type", text: "hello" } },
      act: { kind: "type", text: "hello" },
      node: null,
      abort,
    })
    expect(type.ok).toBe(true)
    expect(typed).toEqual(["hello"])

    const scroll = await driver.act({
      step: { id: "s", act: { kind: "scroll", direction: "down", amount: 2 } },
      act: { kind: "scroll", direction: "down", amount: 2 },
      node: null,
      abort,
    })
    expect(scroll.ok).toBe(true)
    expect(wheel).toEqual([240])
  })

  test("locates image target via metadata selector", async () => {
    const miss = new LocatorStub({
      count: 0,
      visible: true,
      enabled: true,
      text: "",
      attrs: {},
      rect: { x: 0, y: 0, width: 10, height: 10 },
    })
    const image = new LocatorStub({
      count: 1,
      visible: true,
      enabled: true,
      text: "",
      attrs: {},
      rect: { x: 0, y: 0, width: 10, height: 10 },
    })
    let selector = ""
    const page: PlaywrightDriver.Page = {
      locator: (value) => {
        selector = value
        if (value.includes("save-icon")) return image
        return miss
      },
      getByRole: () => miss,
      getByText: () => miss,
      keyboard: {
        press: async () => {},
      },
      mouse: {
        wheel: async () => {},
      },
      screenshot: async () => new Uint8Array([3]),
    }
    const driver = PlaywrightDriver.create({ page })
    const locate = await driver.locate({
      step: { id: "img", act: { kind: "click" } },
      target: [{ kind: "image", value: "save-icon" }],
      abort: new AbortController().signal,
    })
    expect(locate.ok).toBe(true)
    expect(selector.includes('img[alt*="save-icon"]')).toBe(true)
  })

  test("recovery scrolls node into view for interactability failures", async () => {
    const node = new LocatorStub({
      count: 1,
      visible: true,
      enabled: true,
      text: "",
      attrs: {},
      rect: { x: 0, y: 0, width: 10, height: 10 },
    })
    let bring = 0
    const page: PlaywrightDriver.Page = {
      locator: () => node,
      getByRole: () => node,
      getByText: () => node,
      keyboard: {
        press: async () => {},
      },
      mouse: {
        wheel: async () => {},
      },
      screenshot: async () => new Uint8Array([4]),
      bringToFront: async () => {
        bring++
      },
    }
    const driver = PlaywrightDriver.create({ page })
    const located = await driver.locate({
      step: { id: "btn", act: { kind: "click" }, target: [{ kind: "aid", value: "save" }] },
      target: [{ kind: "aid", value: "save" }],
      abort: new AbortController().signal,
    })
    const ref = located.ok ? (located.data ?? null) : null
    const recovered = await driver.recover?.({
      step: { id: "btn", act: { kind: "click" } },
      attempt: 1,
      node: ref,
      kind: "not_interactable",
      detail: "covered",
      abort: new AbortController().signal,
    })
    expect(recovered?.ok).toBe(true)
    expect(node.scrolls).toBe(1)
    expect(bring).toBe(0)
  })
})
