import { describe, expect, test } from "bun:test"
import { executeWalkthrough, type WalkthroughPage } from "./dsl"

describe("walkthrough DSL", () => {
  test("runs goto and selector assertions", async () => {
    const result = await executeWalkthrough({
      page: fakePage({ selectors: new Set(["#ready"]) }),
      baseUrl: "http://127.0.0.1:3000",
      browserInactivityTimeoutMs: 25,
      steps: [
        { action: "goto", path: "/dashboard" },
        { action: "assertPath", path: "/dashboard" },
        { action: "assertSelector", selector: "#ready" },
      ],
    })
    expect(result.passed).toBe(true)
    expect(result.finalPath).toBe("/dashboard")
  })

  test("fails fast on the first broken assertion", async () => {
    const result = await executeWalkthrough({
      page: fakePage(),
      baseUrl: "http://127.0.0.1:3000",
      browserInactivityTimeoutMs: 25,
      steps: [
        { action: "assertSelector", selector: "#missing" },
        { action: "assertPath", path: "/never" },
      ],
    })
    expect(result.passed).toBe(false)
    expect(result.firstFailure?.index).toBe(0)
  })

  test("fills and clicks controls", async () => {
    const page = fakePage()
    const result = await executeWalkthrough({
      page,
      baseUrl: "http://127.0.0.1:3000",
      browserInactivityTimeoutMs: 25,
      steps: [
        { action: "fill", selector: "#email", value: "user@example.com" },
        { action: "click", selector: "#submit" },
      ],
    })
    expect(result.passed).toBe(true)
    expect(page.events).toEqual([
      "click:#email",
      "key:down:Control",
      "key:press:A",
      "key:up:Control",
      "key:press:Backspace",
      "type:#email:user@example.com",
      "click:#submit",
    ])
  })

  test("waits for click navigation before path assertions", async () => {
    const page = fakePage({ navigationPath: "/chat/abc123" })
    const result = await executeWalkthrough({
      page,
      baseUrl: "http://127.0.0.1:3000",
      browserInactivityTimeoutMs: 25,
      steps: [
        { action: "click", selector: "#submit" },
        { action: "assertPath", path: "/chat" },
      ],
    })
    expect(result.passed).toBe(true)
    expect(result.finalPath).toBe("/chat/abc123")
    expect(page.events).toContain("waitForFunction:0")
    expect(page.events).not.toContain("waitForNavigation:5000:load")
  })

  test("supports negative selector assertions", async () => {
    const result = await executeWalkthrough({
      page: fakePage({ selectors: new Set(["#ready"]) }),
      baseUrl: "http://127.0.0.1:3000",
      browserInactivityTimeoutMs: 25,
      steps: [
        { action: "assertSelector", selector: "#error", present: false },
        { action: "assertSelector", selector: "#ready" },
      ],
    })
    expect(result.passed).toBe(true)
  })

  test("fails missing text assertions", async () => {
    const result = await executeWalkthrough({
      page: fakePage({ bodyText: "Welcome" }),
      baseUrl: "http://127.0.0.1:3000",
      browserInactivityTimeoutMs: 25,
      steps: [{ action: "assertText", text: "Settings" }],
    })
    expect(result.passed).toBe(false)
    expect(result.firstFailure?.message).toContain("Settings")
  })

  test("treats request failures as pass-blocking browser failures", async () => {
    const result = await executeWalkthrough({
      page: fakePage({ requestFailureOnGoto: "net::ERR_CONNECTION_RESET" }),
      baseUrl: "http://127.0.0.1:3000",
      browserInactivityTimeoutMs: 25,
      steps: [{ action: "goto", path: "/dashboard" }],
    })

    expect(result.passed).toBe(false)
    expect(result.requestFailures.join("\n")).toContain("net::ERR_CONNECTION_RESET")
    expect(result.firstFailure?.message).toContain("requestfailed")
  })
})

function fakePage(input?: {
  selectors?: Set<string>
  bodyText?: string
  navigationPath?: string
  requestFailureOnGoto?: string
}): WalkthroughPage & { events: string[] } {
  let url = "http://127.0.0.1:3000/"
  const events: string[] = []
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  const emit = (event: string, ...args: unknown[]) => {
    for (const handler of handlers.get(event) ?? []) handler(...args)
  }
  return {
    events,
    goto: async (nextUrl: string, options?: Record<string, unknown>) => {
      events.push(`goto:${String(options?.timeout)}:${String(options?.waitUntil)}`)
      url = nextUrl
      if (input?.requestFailureOnGoto) {
        emit("requestfailed", {
          url: () => nextUrl,
          errorText: input.requestFailureOnGoto,
        })
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
    },
    waitForSelector: async (selector: string, options?: Record<string, unknown>) => {
      events.push(`waitForSelector:${selector}:${String(options?.state)}:${String(options?.timeout)}`)
      const present = input?.selectors?.has(selector) ?? false
      if (options?.state === "detached") {
        if (present) throw new Error(`expected selector ${selector} to be absent`)
        return null
      }
      if (!present) throw new Error(`expected selector ${selector}`)
      return { selector }
    },
    waitForFunction: async <R, Arg = unknown>(fn: string | ((arg: Arg) => R), arg?: Arg, options?: Record<string, unknown>) => {
      events.push(`waitForFunction:${String(options?.timeout)}`)
      const source = String(fn)
      if (source.includes("location.pathname.includes")) {
        if (!new URL(url).pathname.includes(String(arg ?? ""))) {
          throw new Error(`expected path containing ${String(arg ?? "")}`)
        }
        return true
      }
      if (source.includes("textContent")) {
        if (!(input?.bodyText ?? "").includes(String(arg ?? ""))) throw new Error(`expected text ${String(arg ?? "")}`)
        return true
      }
      return true
    },
    type: async (selector: string, value: string) => {
      events.push(`type:${selector}:${value}`)
    },
    click: async (selector: string) => {
      events.push(`click:${selector}`)
      if (input?.navigationPath) url = new URL(input.navigationPath, url).toString()
    },
    keyboard: {
      down: async (key: string) => {
        events.push(`key:down:${key}`)
      },
      up: async (key: string) => {
        events.push(`key:up:${key}`)
      },
      press: async (key: string) => {
        events.push(`key:press:${key}`)
      },
    },
    $: async (selector: string) => (input?.selectors?.has(selector) ? { selector } : null),
    evaluate: async <R, Arg = unknown>(_fn: string | ((arg: Arg) => R), arg?: Arg) =>
      (input?.bodyText ?? "").includes(String(arg ?? "")) as R,
    url: () => url,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((item) => item !== handler),
      )
    },
  }
}
