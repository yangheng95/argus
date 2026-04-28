import { expect, test } from "bun:test"
import { OrchestratorEventNote } from "../../src/orchestrator/agent"

test("operator message wake note preserves authored text without synthetic framing", () => {
  const text = "继续，任务卡死了"
  const note = OrchestratorEventNote.operatorMessage({ text })

  expect(note).toBe(text)
  expect(note).not.toContain("Operator message received")
  expect(note).not.toContain("Latest user message")
  expect(note).not.toContain("Decide whether")
})
