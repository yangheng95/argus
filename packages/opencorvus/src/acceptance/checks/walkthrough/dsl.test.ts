import { describe, expect, test } from "bun:test"
import { executeWalkthrough, type WalkthroughPage } from "./dsl"

describe("walkthrough DSL", () => {
  test("runs goto and selector assertions", async () => {
    const result = await executeWalkthrough({
      page: fakePage({ selectors: new Set(["#ready"]) }),
      baseUrl: "http://127.0.0.1:3000",
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
      "waitForNavigation:5000:load",
      "click:#submit",
    ])
  })

  test("waits for click navigation before path assertions", async () => {
    const page = fakePage({ navigationPath: "/chat/abc123" })
    const result = await executeWalkthrough({
      page,
      baseUrl: "http://127.0.0.1:3000",
      steps: [
        { action: "click", selector: "#submit" },
        { action: "assertPath", path: "/chat" },
      ],
    })
    expect(result.passed).toBe(true)
    expect(result.finalPath).toBe("/chat/abc123")
  })

  test("supports negative selector assertions", async () => {
    const result = await executeWalkthrough({
      page: fakePage({ selectors: new Set(["#ready"]) }),
      baseUrl: "http://127.0.0.1:3000",
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
      steps: [{ action: "assertText", text: "Settings" }],
    })
    expect(result.passed).toBe(false)
    expect(result.firstFailure?.message).toContain("Settings")
  })
})

function fakePage(input?: { selectors?: Set<string>; bodyText?: string; navigationPath?: string }): WalkthroughPage & { events: string[] } {
  let url = "http://127.0.0.1:3000/"
  const events: string[] = []
  return {
    events,
    goto: async (nextUrl: string) => { url = nextUrl },
    waitForNavigation: async (options?: Record<string, unknown>) => {
      events.push(`waitForNavigation:${String(options?.timeout)}:${String(options?.waitUntil)}`)
      if (input?.navigationPath) url = new URL(input.navigationPath, url).toString()
    },
    type: async (selector: string, value: string) => { events.push(`type:${selector}:${value}`) },
    click: async (selector: string) => { events.push(`click:${selector}`) },
    keyboard: {
      down: async (key: string) => { events.push(`key:down:${key}`) },
      up: async (key: string) => { events.push(`key:up:${key}`) },
      press: async (key: string) => { events.push(`key:press:${key}`) },
    },
    $: async (selector: string) => input?.selectors?.has(selector) ? { selector } : null,
    evaluate: async <R, Arg = unknown>(_fn: string | ((arg: Arg) => R), arg?: Arg) =>
      (input?.bodyText ?? "").includes(String(arg ?? "")) as R,
    url: () => url,
    on: () => undefined,
  }
}
