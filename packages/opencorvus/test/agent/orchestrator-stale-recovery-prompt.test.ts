import { expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const promptPath = path.join(repoRoot, "packages/opencorvus/src/prompt/core/orchestrator-core.txt")

test("orchestrator prompt stops repeated stale build recover/build loops", async () => {
  const text = await Bun.file(promptPath).text()
  const normalized = text.replace(/\s+/g, " ")
  expect(normalized).toContain("If the same stale")
  expect(normalized).toContain("build evidence repeats after recovery")
  expect(text).toContain("stop the recover/build loop")
  expect(normalized).toContain("`fail_task`, `question`, `modify_goal`, or `architect`")
})

test("orchestrator prompt forbids self-canceling short-running child agents", async () => {
  const text = await Bun.file(promptPath).text()
  const normalized = text.replace(/\s+/g, " ")
  expect(normalized).toContain("Do not infer stale from elapsed time alone")
  expect(normalized).toContain("Do not self-initiate `cancel_subagent`/`recover_stale`")
  expect(normalized).toContain("running for less than 60 minutes")
  expect(normalized).toContain("target-scoped operator command or pending worker coordination request")
  expect(normalized).toContain("park the wake instead")
})
