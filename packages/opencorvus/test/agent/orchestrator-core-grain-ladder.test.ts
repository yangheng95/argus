import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const promptPath = path.join(repoRoot, "packages/opencorvus/src/prompt/core/orchestrator-core.txt")
const removedStageRewindTool = ["restart", "_from", "_stage"].join("")

describe("orchestrator-core workflow backtracking prohibition", () => {
  test("does not advertise the removed stage-rewind tool", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).not.toContain(removedStageRewindTool)
    expect(text).not.toMatch(/Restart the task from a specific stage/)
    expect(text).not.toMatch(/redo requirements\/plan from scratch/)
  })

  test("states workflow tasks do not go backward in place", async () => {
    const text = await Bun.file(promptPath).text()
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("Workflow tasks do not go backward in place")
    expect(normalized).toContain("do not rewind to earlier requirements / plan / executor stages inside the same task")
    expect(normalized).toContain("Use same-task repair tools when the current contract is still valid")
    expect(normalized).toContain("`modify_goal` for point contract repair")
    expect(normalized).toContain("`architect` for graph repair")
    expect(normalized).toContain("targeted `build` for implementation repair")
  })

  test("routes fundamentally wrong workflow contracts to a new inheriting task", async () => {
    const text = await Bun.file(promptPath).text()
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("active workflow contract is fundamentally wrong")
    expect(normalized).toContain("cannot be repaired inside the current task")
    expect(normalized).toContain("create a separate inheriting workflow task with `propose_task`")
    expect(normalized).toContain("choose `fail_task` or `question` when the blocker is terminal or external")
  })

  test("does NOT advertise the prior single-line repair ladder", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).not.toContain("Cheaper repairs first: `modify_goal` (contract patch) > `build({ goalID })`")
  })
})

/**
 * 2026-05-20 (user directive): the system delivers a project through its
 * specialist agent team via the workflow pipeline. The orchestrator was
 * shortcutting `kind=workflow` tasks straight to `build({ request })`,
 * skipping requirements/architect (no goal graph, no contracts, nothing
 * for integrity to gate). Direct build is reserved for kind=build and
 * post-review scoped fixes only. Prompt-only fix (rule 6.1); pin the
 * load-bearing copy + the absence of the prior permissive phrasing so a
 * future edit cannot silently re-open the bypass.
 */
describe("orchestrator-core workflow-bypass prohibition", () => {
  test("states the agent-team acceptance principle", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("The system delivers a project through its specialist agent team")
    expect(text).toContain("the team IS the\nacceptance mechanism")
  })

  test("prohibits jumping straight to direct build on a fresh workflow task", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("Bypassing the workflow is prohibited in principle")
    expect(text).toMatch(/MUST NOT jump straight to `build\(\{ request \}\)`/)
    expect(text).toContain("task simplicity is the Architect's call")
    const norm = text.replace(/\s+/g, " ")
    expect(norm).toContain("started by a direct `build` bypass is NOT accepted by the `integrity` agent")
    expect(norm).toContain("it cannot return a pass and the task cannot complete")
  })

  test("direct build is the narrow exception: kind=build or post-review fix", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toMatch(/Direct `build\(\{ request, directBuildIntent: "modify_files" \}\)` is the narrow\nexception/)
    expect(text).toContain("explicit `kind=build` tasks")
    expect(text).toContain("subsequent, concretely-scoped problem fix after a `build`/`integrity`")
  })

  test("does NOT advertise the prior permissive direct-build copy", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).not.toContain("workflow tasks where a direct\ntask-level edit is the smallest responsible path")
    expect(text).not.toContain("Direct build is supported:")
  })
})
