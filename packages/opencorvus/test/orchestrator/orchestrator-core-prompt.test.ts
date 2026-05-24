import { expect, test } from "bun:test"

test("orchestrator core prompt wires Integrity history guidance", async () => {
  const prompt = await Bun.file(new URL("../../src/prompt/core/orchestrator-core.txt", import.meta.url)).text()
  expect(prompt).toContain("Persistent blocking roots")
  expect(prompt).toContain("SpecSnapshotLineage")
  expect(prompt).toContain("build lane has stopped converging")
  expect(prompt).toContain("modify_goal` must not add a new capability")
})
