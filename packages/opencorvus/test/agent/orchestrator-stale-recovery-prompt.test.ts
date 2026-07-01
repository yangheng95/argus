import { expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const promptPath = path.join(repoRoot, "packages/opencorvus/src/prompt/core/orchestrator-core.txt")

test("orchestrator prompt removes stale recovery as a build cancellation path", async () => {
  const text = await Bun.file(promptPath).text()
  const normalized = text.replace(/\s+/g, " ")
  expect(normalized).not.toContain("recover_stale")
  expect(normalized).not.toContain("recover/build loop")
  expect(normalized).toContain("Missing root build ownership is not child lifecycle evidence")
  expect(normalized).toContain("If a build child has not emitted terminal evidence")
})

test("orchestrator prompt forbids self-canceling short-running child agents", async () => {
  const text = await Bun.file(promptPath).text()
  const normalized = text.replace(/\s+/g, " ")
  expect(normalized).toContain("Do not infer child build liveness from elapsed time")
  expect(normalized).toContain("missing root tool ownership")
  expect(normalized).toContain("Do not self-initiate `cancel_subagent` unless")
  expect(normalized).toContain("target-scoped operator command")
  expect(normalized).toContain("park the wake instead")
})
