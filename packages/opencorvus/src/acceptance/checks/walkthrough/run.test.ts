import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { runWalkthroughWithDependencies } from "./run"
import type { WalkthroughPage } from "./dsl"

describe("runWalkthrough", () => {
  test("launches headless and returns screenshot evidence", async () => {
    const launchInputs: unknown[] = []
    const result = await runWalkthroughWithDependencies(
      {
        spec: scenarioSpec(),
        baseUrl: "http://127.0.0.1:3000",
        outDir: "tmp/walkthrough",
      },
      {
        translate: async () => [
          { action: "goto", path: "/" },
          { action: "assertSelector", selector: "#app" },
        ],
        browserRuntime: {
          launch: async (input) => {
            launchInputs.push(input)
            return fakeBrowser(fakePage({ selectors: new Set(["#app"]) }))
          },
        },
      },
    )
    expect((launchInputs[0] as { headless?: boolean }).headless).toBe(true)
    expect(result.passed).toBe(true)
    expect(result.screenshotPath).toContain("acc-runtime.png")
  })

  test("preserves first failure evidence", async () => {
    const result = await runWalkthroughWithDependencies(
      {
        spec: scenarioSpec(),
        baseUrl: "http://127.0.0.1:3000",
        outDir: "tmp/walkthrough",
      },
      {
        translate: async () => [{ action: "assertSelector", selector: "#missing" }],
        browserRuntime: { launch: async () => fakeBrowser(fakePage()) },
      },
    )
    expect(result.passed).toBe(false)
    expect(result.evidence.join("\n")).toContain("first_failure=0")
  })

  test("forwards task config scope to scenario translation", async () => {
    const scopes: unknown[] = []
    await runWalkthroughWithDependencies(
      {
        spec: scenarioSpec(),
        baseUrl: "http://127.0.0.1:3000",
        outDir: "tmp/walkthrough",
        taskID: "task-a",
        sessionID: "session-a",
      },
      {
        translate: async (input) => {
          scopes.push({ taskID: input.taskID, sessionID: input.sessionID })
          return [{ action: "assertSelector", selector: "#app" }]
        },
        browserRuntime: { launch: async () => fakeBrowser(fakePage({ selectors: new Set(["#app"]) })) },
      },
    )
    expect(scopes).toEqual([{ taskID: "task-a", sessionID: "session-a" }])
  })

  test("Node sidecar walkthrough owns navigation and assertions by browser inactivity", async () => {
    const source = await fs.readFile(path.join(import.meta.dir, "run.ts"), "utf8")
    expect(source).toContain("browserInactivityTimeoutMs: RUNTIME_CAPTURE_DEFAULTS.wait_timeout_ms")
    expect(source).toContain('page.goto(url, { waitUntil: "networkidle", timeout: 0 })')
    expect(source).toContain(
      'page.waitForFunction((expectedPath) => window.location.pathname.includes(expectedPath), step.path, { timeout: 0 })',
    )
    expect(source).toContain(
      'page.waitForSelector(step.selector, { state: present ? "attached" : "detached", timeout: 0 })',
    )
    expect(source).toContain('on("requestfailed", (payload) => fail(activityLabel("requestfailed", payload)));')
    expect(source).toContain('on("pageerror", (payload) => fail(activityLabel("pageerror", payload)));')
    expect(source).toContain("request_failures=")
    expect(source).not.toContain('page.goto(new URL(step.path, baseUrl).toString(), { waitUntil: "networkidle" })')
    expect(source).not.toContain("waitForNavigation({ timeout: 5_000")
    expect(source).not.toContain('on("requestfailed", (payload) => reset(activityLabel("requestfailed", payload)))')
    expect(source).not.toContain('on("pageerror", (payload) => reset(activityLabel("pageerror", payload)))')
  })
})

function fakePage(input?: { selectors?: Set<string> }): WalkthroughPage & {
  screenshot: (input: { path: string; type: "png" }) => Promise<unknown>
} {
  let url = "http://127.0.0.1:3000/"
  return {
    goto: async (nextUrl: string) => {
      url = nextUrl
    },
    waitForSelector: async (selector: string, options?: Record<string, unknown>) => {
      const present = input?.selectors?.has(selector) ?? false
      if (options?.state === "detached") {
        if (present) throw new Error(`expected selector ${selector} to be absent`)
        return null
      }
      if (!present) throw new Error(`expected selector ${selector}`)
      return { selector }
    },
    waitForFunction: async <T>() => true as T,
    type: async () => undefined,
    click: async () => undefined,
    keyboard: {
      down: async () => undefined,
      up: async () => undefined,
      press: async () => undefined,
    },
    $: async (selector: string) => (input?.selectors?.has(selector) ? { selector } : null),
    evaluate: async <T>() => true as T,
    url: () => url,
    on: () => undefined,
    screenshot: async () => undefined,
  }
}

function fakeBrowser(page: ReturnType<typeof fakePage>) {
  return {
    newContext: async () => ({
      newPage: async () => page,
    }),
    close: async () => undefined,
  } as never
}

function scenarioSpec() {
  return {
    id: "acc-runtime",
    source_requirement_id: "REQ-runtime",
    goal_id: "gol-runtime",
    title: "Runtime scenario",
    scenario: { given: ["the app is open"], when: ["the user views it"], then: ["the app is visible"] },
    scorers: [
      {
        type: "llm_judge" as const,
        name: "runtime_behavior",
        criteria: "The runtime page satisfies the described scenario.",
      },
    ],
    severity: "essential" as const,
  }
}
