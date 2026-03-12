import { describe, expect, test } from "bun:test"
import { parsePlannerOutput } from "../../src/planner/agent"
import { parseSpecOutput } from "../../src/spec/agent"

describe("agent output parsing", () => {
  test("planner output throws when JSON is unrecoverable", () => {
    expect(() => parsePlannerOutput("{")).toThrow("planner output invalid JSON")
  })

  test("planner output throws when schema validation fails", () => {
    expect(() =>
      parsePlannerOutput(JSON.stringify({
        prd: 5,
        summary: "bad",
        subtasks: [],
        risks: [],
      })),
    ).toThrow("planner output failed schema validation")
  })

  test("spec output throws when JSON is unrecoverable", () => {
    expect(() => parseSpecOutput("{")).toThrow("spec output invalid JSON")
  })

  test("spec output throws when schema validation fails", () => {
    expect(() =>
      parseSpecOutput(JSON.stringify({
        summary: "bad",
        content: "bad",
        scope: 5,
        goals: [],
        spec_items: [],
        assumptions: [],
        risks: [],
        evidence_sources: [],
        unresolved_questions: [],
      })),
    ).toThrow("spec output failed schema validation")
  })
})
