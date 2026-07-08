import { expect, test } from "bun:test"

test("orchestrator core prompt wires Integrity history guidance", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  expect(prompt).toContain("Persistent blocking roots")
  expect(prompt).toContain("SpecSnapshotLineage")
  expect(prompt).toContain("build lane has stopped converging")
  expect(prompt).toContain("`manage_task` action=modify_goal must not add a new capability")
})

test("orchestrator core prompt leaves frontend evidence details outside the global scheduler core", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  const normalized = prompt.replace(/\s+/g, " ")

  expect(normalized).toContain("Use scheduler-projected webpage/source-evidence tools only when they are visible")
  expect(normalized).toContain("the Orchestrator only decides whether the current workflow needs the visible evidence lane now")
  expect(normalized).toContain("Source-evidence and visual-handoff tools are bounded evidence producers")
  expect(normalized).toContain("consume the persisted artifact downstream")
  expect(normalized).toContain("Domain-specific replica scope")
  expect(normalized).toContain("belong to the active expert squad, tool descriptions, and specialist prompts")
  expect(prompt).not.toContain("Page Skeleton Blueprint")
  expect(prompt).not.toContain("visual_feedback_verification_failed_attempts")
  expect(prompt).not.toContain("Same source URL with a different focus")
  expect(prompt).not.toContain("Different focus text for the same URL does not create a new page scope")
  expect(prompt).not.toContain("call `frontend_research` with the supplied")
  expect(prompt).not.toContain("MUST be first")
  expect(prompt).not.toContain("Typical shape")
})

test("orchestrator core prompt forbids prose-only workflow decisions", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  const normalized = prompt.replace(/\s+/g, " ")

  expect(normalized).toContain("Narrative text is never a task decision")
  expect(normalized).toContain("must also call the deciding tool (`select_expert_squad`, `dispatch_agent`, `manage_task`, `question`, or another real decision tool)")
  expect(normalized).toContain("`skill`, `read_context`, `manage_task` action=query_failed_goals, and plain prose do not count as a workflow decision")
})

test("orchestrator recovery guidance repairs unsatisfied producer evidence without dependency bypass or generic Architect re-entry", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  const agentSource = await Bun.file(new URL("../../src/orchestrator/agent.ts", import.meta.url)).text()
  const toolsSource = await Bun.file(new URL("../../src/orchestrator/tools.ts", import.meta.url)).text()
  const combined = `${prompt}\n${agentSource}\n${toolsSource}`.replace(/\s+/g, " ")

  expect(combined).toContain("producer evidence unsatisfied")
  expect(combined).toContain("Do not delete a dependency edge to bypass unsatisfied producer evidence")
  expect(combined).toContain("target=architect mode=structural_reentry")
  expect(combined).toContain("invalid_architect_artifact_id")
  expect(combined).not.toContain("Re-run architect")
})

test("orchestrator dynamic workflow prompt passes task id for persisted step projection", async () => {
  const source = await Bun.file(new URL("../../src/orchestrator/agent.ts", import.meta.url)).text()
  expect(source).toContain("renderWorkflowPrompt(workflow, workflowState, task.id)")
  expect(source).not.toContain("renderWorkflowPrompt(workflow, workflowState))")
})
