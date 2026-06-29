import { expect, test } from "bun:test"

test("orchestrator workflow retires deliver and completes through explicit integrity-backed complete_task", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  const agent = await Bun.file(new URL("../../src/orchestrator/agent.ts", import.meta.url)).text()
  const workflow = await Bun.file(new URL("../../src/engine/workflow.ts", import.meta.url)).text()
  const tools = await Bun.file(new URL("../../src/orchestrator/tools.ts", import.meta.url)).text()
  const normalizedPrompt = prompt.replace(/\s+/g, " ")

  expect(normalizedPrompt).toContain("Integrity is the final adversarial acceptance evidence producer")
  expect(normalizedPrompt).toContain("no separate final acceptance object")
  expect(normalizedPrompt).toContain("host-owned final acceptance object")
  expect(normalizedPrompt).toContain("There is no `deliver` or `publish_acceptance` tool")
  expect(normalizedPrompt).toContain(
    "post-build pass verdict from its adversarial reviewer team and you call `complete_task`",
  )
  expect(normalizedPrompt).toContain("Valid next actions include task-level build")
  expect(prompt).not.toContain("Accepted deliveries complete the task inside the tool")
  expect(prompt).not.toContain("Rejected `deliver` returns evidence")

  expect(workflow).toContain("integrity 是 session-bound final gate")
  expect(workflow).not.toContain('tool: "deliver"')
  expect(workflow).not.toContain("deliver →")
  expect(workflow).not.toContain("deliver 是唯一接受闸")
  expect(workflow).not.toContain("停止调度")

  expect(agent).toContain("build")
  expect(agent).toContain("integrity")
  expect(agent).not.toContain('"deliver",')
  expect(agent).not.toContain('"publish_acceptance",')
  expect(agent).not.toContain("withStepHook")
  expect(agent).not.toContain("stopSignal")

  expect(tools).not.toContain("deliver: tool")
  expect(tools).not.toContain("publish_acceptance: tool")
  expect(tools).toContain("complete_task")
  expect(tools).toContain("Pass evidence persisted")
  expect(tools).not.toContain("Task completed by passing integrity gate")
  expect(tools).not.toContain("requestStopAfterCurrentStep")
  expect(tools).not.toContain("finalizeDeferredStop")
  expect(tools).not.toContain("stopAfterDispatch")
  // Retirement removed the acceptance-rework auto-wake loop: the host no longer
  // re-dispatches the task loop to queue repair work after a verdict.
  expect(tools).not.toContain("dispatchTaskLoop({")
  expect(tools).not.toContain("queueAcceptanceReworkWake")
  expect(tools).not.toContain("acceptanceRework")
})
