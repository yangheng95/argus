import { createHash } from "crypto"
import { Automation } from "../engine"

function wait(ms: number, abort: AbortSignal) {
  if (ms <= 0) return Promise.resolve()
  if (abort.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      abort.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    abort.addEventListener("abort", done, { once: true })
  })
}

function escaped(value: string) {
  if (!value.includes("\"")) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`
  return `concat("${value.split("\"").join("\", '\"', \"")}")`
}

function detail(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function sort(target: Automation.Locator[]) {
  return target
    .map((x, i) => ({ x, i, w: x.weight ?? 0 }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.x)
}

export namespace AppiumDriver {
  export interface ElementRect {
    x: number
    y: number
    width: number
    height: number
  }

  export interface Element {
    elementId?: string
    click(): Promise<void>
    isDisplayed(): Promise<boolean>
    isEnabled(): Promise<boolean>
    clear?(): Promise<void>
    setValue(value: string): Promise<void>
    getText?(): Promise<string>
    getAttribute?(name: string): Promise<string | null>
    getRect?(): Promise<ElementRect>
  }

  export interface Client {
    $$(selector: string): Promise<Element[]>
    keys(keys: string | string[]): Promise<void>
    pause(ms: number): Promise<void>
    execute(script: string, args?: unknown[]): Promise<unknown>
    takeScreenshot(): Promise<string>
    back?(): Promise<void>
    activateApp?(appId: string): Promise<void>
  }

  export interface Opt {
    client: Client
    appId?: string
    stableDelayMs?: number
    recover?: () => Promise<boolean>
  }

  function selectors(target: Automation.Locator) {
    if (target.kind === "aid") {
      return [
        `~${target.value}`,
        `//*[@content-desc=${escaped(target.value)} or @name=${escaped(target.value)}]`,
      ]
    }
    if (target.kind === "role") {
      if (target.name) {
        return [
          `//*[@role=${escaped(target.value)} and (@text=${escaped(target.name)} or @label=${escaped(target.name)} or @name=${escaped(target.name)})]`,
        ]
      }
      return [`//*[@role=${escaped(target.value)} or @class=${escaped(target.value)}]`]
    }
    if (target.kind === "text") {
      if (target.exact) {
        return [
          `//*[@text=${escaped(target.value)} or @label=${escaped(target.value)} or @name=${escaped(target.value)}]`,
        ]
      }
      return [
        `//*[contains(@text, ${escaped(target.value)}) or contains(@label, ${escaped(target.value)}) or contains(@name, ${escaped(target.value)})]`,
      ]
    }
    return []
  }

  export function create(input: Opt): Automation.Driver {
    const client = input.client
    const stableDelay = input.stableDelayMs ?? 100
    const node = new Map<string, Element>()
    let seq = 0

    function getId(element: Element) {
      if (element.elementId && element.elementId.length > 0) return element.elementId
      seq += 1
      return `app-${seq}`
    }

    function resolve(ref: Automation.Node | null) {
      if (!ref) return null
      return node.get(ref.id) ?? null
    }

    return {
      locate: async (ctx) => {
        const result = await sort(ctx.target).reduce(
          async (hit, target) => {
            const current = await hit
            if (current) return current
            if (ctx.abort.aborted) {
              return {
                ok: false,
                kind: "aborted",
                detail: "aborted",
              } satisfies Automation.Probe<Automation.Node>
            }
            const found = await selectors(target).reduce(
              async (value, selector) => {
                const existing = await value
                if (existing) return existing
                const list = await client.$$(selector)
                return list[0] ?? null
              },
              Promise.resolve<Element | null>(null),
            )
            if (!found) return null
            const id = getId(found)
            node.set(id, found)
            return {
              ok: true,
              data: {
                id,
                attrs: { kind: target.kind, value: target.value },
              },
            } satisfies Automation.Probe<Automation.Node>
          },
          Promise.resolve<Automation.Probe<Automation.Node> | null>(null),
        )
        if (result) return result
        return {
          ok: false,
          kind: "not_found",
          detail: "appium locator not found",
        } satisfies Automation.Probe<Automation.Node>
      },
      check: async (ctx) => {
        const element = resolve(ctx.node)
        if (!element) {
          return {
            ok: false,
            kind: "not_found",
            detail: "node not found",
          } satisfies Automation.Probe
        }
        const check = ctx.check
        if (check.kind === "exists") return { ok: true } satisfies Automation.Probe
        if (check.kind === "visible") {
          const ok = await element.isDisplayed()
          return ok
            ? ({ ok: true } satisfies Automation.Probe)
            : ({ ok: false, kind: "state_mismatch", detail: "not visible" } satisfies Automation.Probe)
        }
        if (check.kind === "enabled") {
          const ok = await element.isEnabled()
          return ok
            ? ({ ok: true } satisfies Automation.Probe)
            : ({ ok: false, kind: "not_interactable", detail: "not enabled" } satisfies Automation.Probe)
        }
        if (check.kind === "focused") {
          const value = await element.getAttribute?.("focused")
          const selected = await element.getAttribute?.("selected")
          const ok = value === "true" || selected === "true"
          return ok
            ? ({ ok: true } satisfies Automation.Probe)
            : ({ ok: false, kind: "state_mismatch", detail: "not focused" } satisfies Automation.Probe)
        }
        if (check.kind === "stable") {
          if (!element.getRect) return { ok: true } satisfies Automation.Probe
          const first = await element.getRect()
          await wait(stableDelay, ctx.abort)
          const second = await element.getRect()
          const ok = first.x === second.x
            && first.y === second.y
            && first.width === second.width
            && first.height === second.height
          return ok
            ? ({ ok: true } satisfies Automation.Probe)
            : ({ ok: false, kind: "state_mismatch", detail: "element is moving" } satisfies Automation.Probe)
        }
        if (check.key === "text") {
          const text = await element.getText?.() ?? ""
          const value = String(check.value)
          return text.includes(value)
            ? ({ ok: true } satisfies Automation.Probe)
            : ({ ok: false, kind: "state_mismatch", detail: `text missing: ${value}` } satisfies Automation.Probe)
        }
        if (check.key.startsWith("attr:")) {
          const name = check.key.slice(5)
          const value = String(check.value)
          const attr = await element.getAttribute?.(name)
          return String(attr ?? "") === value
            ? ({ ok: true } satisfies Automation.Probe)
            : ({ ok: false, kind: "state_mismatch", detail: `attr mismatch: ${name}` } satisfies Automation.Probe)
        }
        return {
          ok: false,
          kind: "state_mismatch",
          detail: `unsupported state key: ${check.key}`,
        } satisfies Automation.Probe
      },
      act: async (ctx) => {
        const action = ctx.act
        const element = resolve(ctx.node)
        if (action.kind === "hotkey") {
          return client.keys(action.keys)
            .then(() => ({ ok: true } satisfies Automation.Probe))
            .catch((error) => ({ ok: false, kind: "infra", detail: detail(error) } satisfies Automation.Probe))
        }
        if (action.kind === "scroll") {
          const amount = action.amount ?? 3
          const script = "mobile: scrollGesture"
          const args = [{
            direction: action.direction,
            percent: Math.max(0.2, Math.min(1, amount / 5)),
          }]
          return client.execute(script, args)
            .then(() => ({ ok: true } satisfies Automation.Probe))
            .catch(() => {
              const key = action.direction === "down" ? "PageDown" : "PageUp"
              return client.keys([key])
                .then(() => ({ ok: true } satisfies Automation.Probe))
                .catch((error) => ({ ok: false, kind: "infra", detail: detail(error) } satisfies Automation.Probe))
            })
        }
        if (action.kind === "wait") {
          return client.pause(action.ms)
            .then(() => ({ ok: true } satisfies Automation.Probe))
            .catch((error) => ({ ok: false, kind: "infra", detail: detail(error) } satisfies Automation.Probe))
        }
        if (action.kind === "custom") {
          if (action.name === "back" && client.back) {
            return client.back()
              .then(() => ({ ok: true } satisfies Automation.Probe))
              .catch((error) => ({ ok: false, kind: "infra", detail: detail(error) } satisfies Automation.Probe))
          }
          if (action.name === "activate_app" && client.activateApp && input.appId) {
            return client.activateApp(input.appId)
              .then(() => ({ ok: true } satisfies Automation.Probe))
              .catch((error) => ({ ok: false, kind: "infra", detail: detail(error) } satisfies Automation.Probe))
          }
          return {
            ok: false,
            kind: "infra",
            detail: `unsupported custom action: ${action.name}`,
          } satisfies Automation.Probe
        }
        if (action.kind === "type") {
          if (!element) {
            return client.keys(action.text)
              .then(() => ({ ok: true } satisfies Automation.Probe))
              .catch((error) => ({ ok: false, kind: "not_interactable", detail: detail(error) } satisfies Automation.Probe))
          }
          const clear = element.clear ? element.clear() : Promise.resolve()
          return clear
            .then(() => element.setValue(action.text))
            .then(() => ({ ok: true } satisfies Automation.Probe))
            .catch((error) => ({ ok: false, kind: "not_interactable", detail: detail(error) } satisfies Automation.Probe))
        }
        if (!element) {
          return {
            ok: false,
            kind: "not_found",
            detail: "action requires located node",
          } satisfies Automation.Probe
        }
        if (action.kind === "click") {
          return element.click()
            .then(() => ({ ok: true } satisfies Automation.Probe))
            .catch((error) => ({ ok: false, kind: "not_interactable", detail: detail(error) } satisfies Automation.Probe))
        }
        return {
          ok: false,
          kind: "infra",
          detail: "unsupported action",
        } satisfies Automation.Probe
      },
      recover: async (ctx) => {
        if (ctx.abort.aborted) {
          return {
            ok: false,
            kind: "aborted",
            detail: "aborted",
          } satisfies Automation.Probe
        }
        if (input.recover) {
          const ok = await input.recover()
          return ok
            ? ({ ok: true } satisfies Automation.Probe)
            : ({ ok: false, kind: "state_mismatch", detail: "custom recovery failed" } satisfies Automation.Probe)
        }
        if (!client.activateApp || !input.appId) return { ok: true } satisfies Automation.Probe
        return client.activateApp(input.appId)
          .then(() => ({ ok: true } satisfies Automation.Probe))
          .catch((error) => ({ ok: false, kind: "infra", detail: detail(error) } satisfies Automation.Probe))
      },
      snapshot: async (ctx) => {
        if (ctx.abort.aborted) return null
        return client.takeScreenshot()
          .then((base64) => {
            const hash = createHash("md5").update(Buffer.from(base64, "base64")).digest("hex")
            return {
              id: `appium:${ctx.label}:${hash}`,
              at: Date.now(),
            } satisfies Automation.Snapshot
          })
          .catch(() => null)
      },
    }
  }
}
