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
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
}

function escapedRegex(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
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

export namespace PlaywrightDriver {
  export interface Locator {
    count(): Promise<number>
    first(): Locator
    click(input?: { button?: "left" | "right" | "middle"; clickCount?: number }): Promise<void>
    dblclick?(input?: { button?: "left" | "right" | "middle" }): Promise<void>
    fill(value: string): Promise<void>
    isVisible(input?: { timeout?: number }): Promise<boolean>
    isEnabled(input?: { timeout?: number }): Promise<boolean>
    evaluate<T>(fn: (element: Element, arg?: unknown) => T | Promise<T>, arg?: unknown): Promise<T>
    scrollIntoViewIfNeeded?(input?: { timeout?: number }): Promise<void>
  }

  export interface Page {
    locator(selector: string): Locator
    getByRole(role: string, input?: { name?: string }): Locator
    getByText(text: string | RegExp, input?: { exact?: boolean }): Locator
    keyboard: {
      press(key: string): Promise<void>
      type?(text: string): Promise<void>
    }
    mouse: {
      wheel(x: number, y: number): Promise<void>
    }
    screenshot(input?: { type?: "png"; fullPage?: boolean }): Promise<Uint8Array>
    bringToFront?(): Promise<void>
  }

  export interface Opt {
    page: Page
    defaultTimeoutMs?: number
    stableDelayMs?: number
    recover?: () => Promise<boolean>
  }

  function makeLocator(page: Page, target: Automation.Locator) {
    if (target.kind === "aid") {
      const q = escaped(target.value)
      return page.locator(
        `[data-testid="${q}"], [data-test-id="${q}"], [data-qa="${q}"], [aria-label="${q}"]`,
      )
    }
    if (target.kind === "role") {
      return page.getByRole(target.value, target.name ? { name: target.name } : undefined)
    }
    if (target.kind === "text") {
      if (target.exact) return page.getByText(target.value, { exact: true })
      return page.getByText(new RegExp(escapedRegex(target.value), "i"))
    }
    return null
  }

  export function create(input: Opt): Automation.Driver {
    const page = input.page
    const timeout = input.defaultTimeoutMs ?? 2000
    const stableDelay = input.stableDelayMs ?? 90
    const node = new Map<string, Locator>()
    let seq = 0

    function store(locator: Locator, target: Automation.Locator) {
      seq += 1
      const id = `pw-${seq}`
      node.set(id, locator.first())
      return {
        ok: true,
        data: {
          id,
          attrs: { kind: target.kind, value: target.value },
        },
      } satisfies Automation.Probe<Automation.Node>
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
            if (target.kind === "image") {
              return null
            }
            const locator = makeLocator(page, target)
            if (!locator) return null
            const count = await locator.count()
            if (count <= 0) return null
            return store(locator, target)
          },
          Promise.resolve<Automation.Probe<Automation.Node> | null>(null),
        )
        if (result) return result
        return {
          ok: false,
          kind: "not_found",
          detail: "playwright locator not found",
        } satisfies Automation.Probe<Automation.Node>
      },
      check: async (ctx) => {
        const locator = resolve(ctx.node)
        if (!locator) {
          return {
            ok: false,
            kind: "not_found",
            detail: "node not found",
          } satisfies Automation.Probe
        }
        const check = ctx.check
        if (check.kind === "exists") {
          const count = await locator.count()
          return count > 0
            ? { ok: true }
            : { ok: false, kind: "not_found", detail: "element does not exist" }
        }
        if (check.kind === "visible") {
          const ok = await locator.isVisible({ timeout })
          return ok ? { ok: true } : { ok: false, kind: "state_mismatch", detail: "not visible" }
        }
        if (check.kind === "enabled") {
          const ok = await locator.isEnabled({ timeout })
          return ok ? { ok: true } : { ok: false, kind: "not_interactable", detail: "not enabled" }
        }
        if (check.kind === "focused") {
          const ok = await locator.evaluate((element) => element === document.activeElement)
          return ok ? { ok: true } : { ok: false, kind: "state_mismatch", detail: "not focused" }
        }
        if (check.kind === "stable") {
          const first = await locator.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return `${rect.x}:${rect.y}:${rect.width}:${rect.height}`
          })
          await wait(stableDelay, ctx.abort)
          const second = await locator.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return `${rect.x}:${rect.y}:${rect.width}:${rect.height}`
          })
          return first === second
            ? { ok: true }
            : { ok: false, kind: "state_mismatch", detail: "element is moving" }
        }
        if (check.key === "text") {
          const text = await locator.evaluate((element) => element.textContent ?? "")
          const value = String(check.value)
          return text.includes(value)
            ? { ok: true }
            : { ok: false, kind: "state_mismatch", detail: `text missing: ${value}` }
        }
        if (check.key.startsWith("attr:")) {
          const name = check.key.slice(5)
          const attr = await locator.evaluate((element, key) => element.getAttribute(String(key)), name)
          const value = String(check.value)
          return String(attr ?? "") === value
            ? { ok: true }
            : { ok: false, kind: "state_mismatch", detail: `attr mismatch: ${name}` }
        }
        return { ok: false, kind: "state_mismatch", detail: `unsupported state key: ${check.key}` }
      },
      act: async (ctx) => {
        const action = ctx.act
        const locator = resolve(ctx.node)
        if (action.kind === "hotkey") {
          return page.keyboard.press(action.keys.join("+"))
            .then(() => ({ ok: true } satisfies Automation.Probe))
            .catch((error) => ({ ok: false, kind: "infra", detail: detail(error) } satisfies Automation.Probe))
        }
        if (action.kind === "scroll") {
          const unit = action.amount ?? 3
          const y = action.direction === "down" ? unit * 120 : -unit * 120
          return page.mouse.wheel(0, y)
            .then(() => ({ ok: true } satisfies Automation.Probe))
            .catch((error) => ({ ok: false, kind: "infra", detail: detail(error) } satisfies Automation.Probe))
        }
        if (action.kind === "wait") {
          await wait(action.ms, ctx.abort)
          return { ok: true } satisfies Automation.Probe
        }
        if (!locator) {
          return {
            ok: false,
            kind: "not_found",
            detail: "action requires located node",
          } satisfies Automation.Probe
        }
        if (action.kind === "click") {
          const button = action.button === "double" ? "left" : action.button
          const run = action.button === "double" && locator.dblclick
            ? locator.dblclick({ button: "left" })
            : locator.click({ button, clickCount: action.button === "double" ? 2 : undefined })
          return run
            .then(() => ({ ok: true } satisfies Automation.Probe))
            .catch((error) => ({ ok: false, kind: "not_interactable", detail: detail(error) } satisfies Automation.Probe))
        }
        if (action.kind === "type") {
          if (!locator) {
            if (!page.keyboard.type) {
              return {
                ok: false,
                kind: "not_interactable",
                detail: "type requires target node or keyboard.type support",
              } satisfies Automation.Probe
            }
            return page.keyboard.type(action.text)
              .then(() => ({ ok: true } satisfies Automation.Probe))
              .catch((error) => ({ ok: false, kind: "not_interactable", detail: detail(error) } satisfies Automation.Probe))
          }
          return locator.fill(action.text)
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
        if (!page.bringToFront) return { ok: true } satisfies Automation.Probe
        return page.bringToFront()
          .then(() => ({ ok: true } satisfies Automation.Probe))
          .catch((error) => ({ ok: false, kind: "infra", detail: detail(error) } satisfies Automation.Probe))
      },
      snapshot: async (ctx) => {
        if (ctx.abort.aborted) return null
        return page.screenshot({ type: "png" })
          .then((image) => {
            const hash = createHash("md5").update(image).digest("hex")
            return { id: `pw:${ctx.label}:${hash}`, at: Date.now() } satisfies Automation.Snapshot
          })
          .catch(() => null)
      },
    }
  }
}
