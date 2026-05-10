import { beforeEach, describe, expect, mock, test } from "bun:test"

let captureImpl: () => Promise<unknown>

mock.module("@/delivery/runtime-capture", () => ({
  captureRuntimePage: () => captureImpl(),
}))

import { computeRuntimeEvidence, runtimeLayerViolations } from "./runtime-evidence"

beforeEach(() => {
  captureImpl = async () => captured()
})

describe("runtime evidence", () => {
  test("maps JavaScript runtime errors", () => {
    const violations = runtimeLayerViolations(captured({
      js: { passed: false, console_errors: ["boom"], page_errors: ["crash"] },
    }).layers)
    expect(violations.map((item) => item.kind)).toEqual(["js_runtime_error", "js_runtime_error"])
  })

  test("maps HTTP failures", () => {
    const violations = runtimeLayerViolations(captured({
      http: { passed: false, status: 500, content_type: "text/html", body_length: 12, reason: "bad status" },
    }).layers)
    expect(violations[0]?.kind).toBe("http_failure")
  })

  test("maps asset failures", () => {
    const violations = runtimeLayerViolations(captured({
      asset: { passed: false, total: 1, failed: [{ url: "/missing.js", status: 404, reason: "not found" }] },
    }).layers)
    expect(violations[0]?.kind).toBe("asset_failure")
  })

  test("maps missing expected selectors and text", () => {
    const violations = runtimeLayerViolations(captured({
      expected: { passed: false, missing_selectors: ["#app"], missing_texts: ["Ready"] },
    }).layers)
    expect(violations.map((item) => item.kind)).toEqual(["expected_missing", "expected_missing"])
  })

  test("adds failed scenario walkthrough evidence", async () => {
    const report = await computeRuntimeEvidence({
      projectDir: "/repo",
      outDir: "/repo/.opencorvus/runtime",
      previewUrl: "http://127.0.0.1:3000",
      scenarios: [scenarioSpec()],
      walkthroughRunner: async () => ({
        specId: "acc-runtime",
        scenarioTitle: "Runtime scenario",
        passed: false,
        steps: [{ action: "assertSelector", selector: "#missing" }],
        finalPath: "/",
        pageErrors: [],
        consoleErrors: [],
        firstFailure: { index: 0, step: { action: "assertSelector", selector: "#missing" }, message: "expected selector #missing" },
        evidence: ["scenario_id=acc-runtime", "first_failure=0:expected selector #missing"],
      }),
    })
    expect(report.passed).toBe(false)
    expect(report.violations[0]?.kind).toBe("walkthrough_failed")
    expect(report.evidence.walkthroughs?.[0]?.specId).toBe("acc-runtime")
  })
})

function captured(overrides?: {
  http?: { passed: boolean; status: number; content_type: string; body_length: number; reason: string }
  asset?: { passed: boolean; total: number; failed: Array<{ url: string; status: number; reason: string }> }
  js?: { passed: boolean; console_errors: string[]; page_errors: string[] }
  expected?: { passed: boolean; missing_selectors: string[]; missing_texts: string[] }
}) {
  return {
    captured: true as const,
    passed: true,
    url: "http://127.0.0.1:3000",
    target_url: "http://127.0.0.1:3000",
    path: "/tmp/rendered.png",
    sha: "abc",
    bytes: 123,
    size: { width: 1440, height: 900 },
    requested_viewport: { width: 1440, height: 900 },
    viewport: { width: 1440, height: 900, capped: false },
    dom: { textLength: 200, nodeCount: 80, bodyDescendantCount: 80, hasBodyChildren: true, isEmptyRootShell: false },
    layers: {
      http: { passed: true, status: 200, content_type: "text/html", body_length: 1000, reason: "ok" },
      asset: { passed: true, total: 0, failed: [] },
      dom: { passed: true, body_descendants: 80, required: 60 },
      js: { passed: true, console_errors: [], page_errors: [] },
      pixel: { passed: true, variance: 100, floor: 25, screenshot_path: "/tmp/rendered.png" },
      expected: { passed: true, missing_selectors: [], missing_texts: [] },
      ...overrides,
    },
    summary: "ok",
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
