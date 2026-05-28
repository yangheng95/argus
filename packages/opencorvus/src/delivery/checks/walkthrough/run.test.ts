import { describe, expect, test } from "bun:test"
import { runWalkthroughWithDependencies } from "./run"
import type { WalkthroughPage } from "./dsl"

describe("runWalkthrough", () => {
  test("launches headless and returns screenshot evidence", async () => {
    const launchInputs: unknown[] = []
    const result = await runWalkthroughWithDependencies({
      spec: scenarioSpec(),
      baseUrl: "http://127.0.0.1:3000",
      outDir: "tmp/walkthrough",
    }, {
      translate: async () => [{ action: "goto", path: "/" }, { action: "assertSelector", selector: "#app" }],
      findBrowserExecutable: async () => "chrome",
      puppeteer: {
        launch: async (input) => {
          launchInputs.push(input)
          return { newPage: async () => fakePage({ selectors: new Set(["#app"]) }), close: async () => undefined }
        },
      },
    })
    expect((launchInputs[0] as { headless?: boolean }).headless).toBe(true)
    expect(result.passed).toBe(true)
    expect(result.screenshotPath).toContain("acc-runtime.png")
  })

  test("preserves first failure evidence", async () => {
    const result = await runWalkthroughWithDependencies({
      spec: scenarioSpec(),
      baseUrl: "http://127.0.0.1:3000",
      outDir: "tmp/walkthrough",
    }, {
      translate: async () => [{ action: "assertSelector", selector: "#missing" }],
      findBrowserExecutable: async () => "chrome",
      puppeteer: { launch: async () => ({ newPage: async () => fakePage(), close: async () => undefined }) },
    })
    expect(result.passed).toBe(false)
    expect(result.evidence.join("\n")).toContain("first_failure=0")
  })

  test("forwards task config scope to scenario translation", async () => {
    const scopes: unknown[] = []
    await runWalkthroughWithDependencies({
      spec: scenarioSpec(),
      baseUrl: "http://127.0.0.1:3000",
      outDir: "tmp/walkthrough",
      taskID: "task-a",
      sessionID: "session-a",
    }, {
      translate: async (input) => {
        scopes.push({ taskID: input.taskID, sessionID: input.sessionID })
        return [{ action: "assertSelector", selector: "#app" }]
      },
      findBrowserExecutable: async () => "chrome",
      puppeteer: { launch: async () => ({ newPage: async () => fakePage({ selectors: new Set(["#app"]) }), close: async () => undefined }) },
    })
    expect(scopes).toEqual([{ taskID: "task-a", sessionID: "session-a" }])
  })
})

function fakePage(input?: { selectors?: Set<string> }): WalkthroughPage & {
  screenshot: (input: { path: string; type: "png" }) => Promise<unknown>
} {
  let url = "http://127.0.0.1:3000/"
  return {
    goto: async (nextUrl: string) => { url = nextUrl },
    waitForNavigation: async () => undefined,
    type: async () => undefined,
    click: async () => undefined,
    keyboard: {
      down: async () => undefined,
      up: async () => undefined,
      press: async () => undefined,
    },
    $: async (selector: string) => input?.selectors?.has(selector) ? { selector } : null,
    evaluate: async <T>() => true as T,
    url: () => url,
    on: () => undefined,
    screenshot: async () => undefined,
  }
}

function scenarioSpec() {
  return {
    id: "acc-runtime",
    source_requirement_id: "REQ-runtime",
    goal_id: "gol-runtime",
    title: "Runtime scenario",
    scenario: { given: ["the app is open"], when: ["the user views it"], then: ["the app is visible"] },
    scorers: [{ type: "llm_judge" as const, name: "runtime_behavior", criteria: "The runtime page satisfies the described scenario." }],
    severity: "essential" as const,
  }
}
