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
  expect(text).toContain("`fail_task`, `question`, `modify_goal`, or `architect`")
})
