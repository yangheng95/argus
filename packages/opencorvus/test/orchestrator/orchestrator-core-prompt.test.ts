import { expect, test } from "bun:test"

test("orchestrator core prompt wires Integrity history guidance", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  expect(prompt).toContain("Persistent blocking roots")
  expect(prompt).toContain("SpecSnapshotLineage")
  expect(prompt).toContain("build lane has stopped converging")
  expect(prompt).toContain("modify_goal` must not add a new capability")
})

test("orchestrator core prompt routes webpage PRD research to frontend_research beside frontend_design", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  expect(prompt).toContain("For a PRD/SPEC/report request about a webpage")
  expect(prompt).toContain("call `frontend_research` with the supplied")
  expect(prompt).toContain("`frontend_research` and `frontend_design` are siblings")
  expect(prompt).toContain("Frontend_research")
  expect(prompt).toContain("not acquire webpage evidence")
  expect(prompt).toContain("Do not apply the UI-replication rule to document/research requests")
  expect(prompt).toContain("research this page and form a PRD")
  expect(prompt).toContain("the URL is evidence for")
  expect(prompt).toContain("`frontend_research`")
})
