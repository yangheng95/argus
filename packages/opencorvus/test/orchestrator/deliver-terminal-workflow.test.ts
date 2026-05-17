import { expect, test } from "bun:test"

test("orchestrator workflow treats deliver as the default scheduler endpoint", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  const agent = await Bun.file(new URL("../../src/orchestrator/agent.ts", import.meta.url)).text()
  const workflow = await Bun.file(new URL("../../src/engine/workflow.ts", import.meta.url)).text()
  const tools = await Bun.file(new URL("../../src/orchestrator/tools.ts", import.meta.url)).text()
  const normalizedPrompt = prompt.replace(/\s+/g, " ")

  expect(prompt).toContain("Stop\nthe scheduler when `deliver` returns its result unless dynamic Auto Iteration")
  expect(prompt).toContain("assistant.auto_iteration=false")
  expect(prompt).toContain("assistant.auto_iteration=true")
  expect(normalizedPrompt).toContain("Always tell the user they can continue with follow-up questions or further changes in the same task.")
  expect(prompt).toContain("deliveries complete the task inside the tool")
  expect(normalizedPrompt).toContain("rejected deliveries are user-visible results")
  expect(prompt).toContain("Some failed while `assistant.auto_iteration=false`")

  expect(workflow).toContain("deliver 是默认调度终点")
  expect(workflow).toContain("Rejected 默认直接报告结果并停止调度")

  expect(agent).toContain("## Auto Iteration Mode")
  expect(agent).toContain("assistant.auto_iteration=false: `deliver` is the scheduler endpoint")
  expect(agent).toContain("assistant.auto_iteration=true: rejected deliveries")

  expect(tools).toContain("Default scheduling stops at deliver; assistant.auto_iteration=false")
  expect(tools).toContain("const autoIteration = (await EngineConfig.get()).auto_iteration === true")
  expect(tools).toContain("if (autoIteration)")
  expect(tools).toContain("requestStopAfterCurrentStep(\"delivery_rejected\")")
  expect(tools).toContain("requestStopAfterCurrentStep(\"delivery_rework\")")
  expect(tools).toContain("dispatchTaskLoop({")
  expect(tools).toContain("continue with follow-up questions or further changes in this task")
  expect(tools).not.toContain("You can call refine to analyze the project and suggest improvements for the next iteration.")
})
