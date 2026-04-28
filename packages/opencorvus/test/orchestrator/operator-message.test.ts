import { expect, test } from "bun:test"
import { OrchestratorEventNote, orchestratorUserText } from "../../src/orchestrator/agent"

test("operator message wake note preserves authored text without synthetic framing", () => {
  const text = "继续，任务卡死了"
  const note = OrchestratorEventNote.operatorMessage({ text })

  expect(note).toBe(text)
  expect(note).not.toContain("Operator message received")
  expect(note).not.toContain("Latest user message")
  expect(note).not.toContain("Decide whether")
})

test("orchestrator wake without caller note reuses the original task request", () => {
  const text = orchestratorUserText({ request: "build the requested feature" })

  expect(text).toBe("build the requested feature")
  expect(text).not.toContain("Task state has advanced")
  expect(text).not.toContain("Re-read the context snapshot")
})

test("orchestrator wake with caller note preserves the caller-authored note", () => {
  const text = orchestratorUserText(
    { request: "original task" },
    { note: "operator provided this exact follow-up" },
  )

  expect(text).toBe("operator provided this exact follow-up")
})
