import { expect, test } from "bun:test"

test("orchestrator core prompt wires Integrity history guidance", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  expect(prompt).toContain("Persistent blocking roots")
  expect(prompt).toContain("SpecSnapshotLineage")
  expect(prompt).toContain("build lane has stopped converging")
  expect(prompt).toContain("modify_goal` must not add a new capability")
})

test("orchestrator core prompt leaves frontend evidence tool selection to orchestrator judgment", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  expect(prompt).toContain("For a PRD/SPEC/report request about a webpage")
  expect(prompt).toContain("Decide whether to invoke it from the")
  expect(prompt).toContain("`frontend_research` and `frontend_design` are sibling evidence tools")
  expect(prompt).toContain("frontend_research")
  expect(prompt).toContain("not acquire webpage evidence")
  expect(prompt).toContain("call `frontend_research` before `frontend_design`")
  expect(prompt).toContain("do not call `frontend_design` first")
  expect(prompt).toContain("missing or unusable prepared evidence")
  expect(prompt).toContain(
    "Same source URL with a different focus, viewport, interaction state, component, region, fidelity risk, or missing-detail question is still the same source-page scope",
  )
  expect(prompt).toContain("Different focus text for the same URL does not create a new page scope")
  expect(prompt).toContain("not a hard-coded pair")
  expect(prompt).toContain("not fixed lifecycle gates")
  expect(prompt).toContain("Do not apply the UI-replication rule to document/research requests")
  expect(prompt).toContain("research this page and form a PRD")
  expect(prompt).toContain("the URL may be evidence for")
  expect(prompt).toContain("`frontend_research`")
  expect(prompt).not.toContain("call `frontend_research` with the supplied")
  expect(prompt).not.toContain("MUST be first")
  expect(prompt).not.toContain("Typical shape")
})

test("orchestrator dynamic workflow prompt passes task id for persisted step projection", async () => {
  const source = await Bun.file(new URL("../../src/orchestrator/agent.ts", import.meta.url)).text()
  expect(source).toContain("renderWorkflowPrompt(workflow, workflowState, task.id)")
  expect(source).not.toContain("renderWorkflowPrompt(workflow, workflowState))")
})
