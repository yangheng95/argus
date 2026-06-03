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
  const text = orchestratorUserText({ id: "tsk_operator_msg", request: "build the requested feature" })

  expect(text).toContain("build the requested feature")
  expect(text).toContain(".opencorvus/runtime/tasks/tsk_operator_msg/intent/request.md")
  expect(text).toContain("Full user request:")
  expect(text).toContain("Audit copy:")
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

test("acceptanceRework wake note carries iteration + reason + summary so re-dispatch context is unambiguous", () => {
  const note = OrchestratorEventNote.acceptanceRework({
    reason: "render_prerequisite_failed:bun_install",
    iteration: 0,
    summary: "bun install pre-launch exited code=1 in merged worktree",
    affectedGoalCount: 0,
  })

  expect(note).toContain("iteration 0")
  expect(note).toContain("render_prerequisite_failed:bun_install")
  expect(note).toContain("No goal attempt was reopened")
  expect(note).toContain("bun install pre-launch exited code=1 in merged worktree")
})

test("acceptanceRework wake note reports exact affected goal count for agent-attributed rework", () => {
  const note = OrchestratorEventNote.acceptanceRework({
    reason: "agent_verdict_rejected",
    iteration: 2,
    summary: "two scoped issues",
    affectedGoalCount: 2,
  })

  expect(note).toContain("2 affected goal attempt(s) were reopened for rework")
  expect(note).toContain("two scoped issues")
})
