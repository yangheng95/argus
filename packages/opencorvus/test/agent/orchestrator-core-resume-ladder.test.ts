import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const promptPath = path.join(
  repoRoot,
  "packages/opencorvus/src/prompt/core/orchestrator-core.txt",
)

describe("orchestrator-core resume ladder", () => {
  test("pins the stuck-child resume priority order", async () => {
    const text = await Bun.file(promptPath).text()

    expect(text).toContain("## Resume ladder for stuck child agents")
    const rung1 = text.indexOf("1. `steer_subagent`")
    const rung2 = text.indexOf("2. `cancel_subagent`")
    const rung3 = text.indexOf("3. `modify_goal`")
    const rung4 = text.indexOf("4. `restart_from_stage`")

    expect(rung1).toBeGreaterThan(-1)
    expect(rung2).toBeGreaterThan(rung1)
    expect(rung3).toBeGreaterThan(rung2)
    expect(rung4).toBeGreaterThan(rung3)
  })

  test("keeps session-level restart ahead of contract or workflow rewrites", async () => {
    const text = await Bun.file(promptPath).text()
    const normalized = text.replace(/\s+/g, " ")

    expect(normalized).toContain("re-dispatch the SAME stage or SAME goal under the SAME contract")
    expect(normalized).toContain("This rung is session-level recovery, not contract change")
    expect(normalized).toContain("Do not jump to `modify_goal` or `restart_from_stage` while rung 1 or rung 2 is still viable")
    expect(normalized).toContain("\"Resume\" does NOT mean \"regenerate the workflow\"")
  })
})
