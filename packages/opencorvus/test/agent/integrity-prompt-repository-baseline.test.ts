import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const integrityPromptPath = path.join(repoRoot, "packages/opencorvus/src/prompt/core/integrity-team-core.txt")
const orchestratorToolsPath = path.join(repoRoot, "packages/opencorvus/src/orchestrator/tools.ts")

describe("integrity review scope boundaries", () => {
  test("keeps repository baseline as evidence instead of a separate review surface", async () => {
    const integrity = await Bun.file(integrityPromptPath).text()
    const normalized = integrity.replace(/\s+/g, " ")

    expect(integrity).not.toContain("## Repository Baseline")
    expect(normalized).toContain("repository baseline")
    expect(normalized).toContain("evidence")
    expect(normalized).toContain("not trusted truth")
  })

  test("does not route every build wave through standalone integrity", async () => {
    const tools = (await Bun.file(orchestratorToolsPath).text()).replace(/\\`/g, "`")

    expect(tools).not.toContain("call `integrity` ONCE")
    expect(tools).not.toContain("wave-level architecture review")
    expect(tools).not.toContain("Call `integrity` as the final workflow gate")
    expect(tools).toContain("standalone integrity is")
    expect(tools).toContain("not routine wave-level review")
    expect(tools).toContain("A post-build pass verdict records review evidence for the Orchestrator's completion decision")
    expect(tools).toContain("it does not complete or block the task by itself")
  })
})
