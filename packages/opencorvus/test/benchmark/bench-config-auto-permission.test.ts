import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * 2026-04-30 — overlay-web-benchmark goal 002 (bootstrap) failed twice in a
 * row at the 5-minute permission timeout: build agent in worktree tried to
 * access parent project root → matched `external_directory:*=ask` (agent
 * default) → no UI to answer → 5min reject → goal failed.
 *
 * The fix is in writeBenchmarkModelConfig: emit `experimental.auto_permission
 * = true` so AutoPermission.subscribe (engine/auto-permission.ts) short-circuits
 * every permission ask with `reply:"once"`. The bench is unattended — every
 * permission prompt must be auto-approved upstream of the interaction queue,
 * because EngineInteraction.upsertPermission can race with the auto-reply
 * (resolveOwner may not yet see the new build session).
 *
 * This regression pins the contract: writeBenchmarkModelConfig output MUST
 * carry `experimental.auto_permission: true`.
 */

describe("bench config — unattended permission auto-approval", () => {
  test("writeBenchmarkModelConfig emits experimental.auto_permission=true", async () => {
    const benchScript = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "script", "benchmark", "overlay-web-benchmark.ts"),
      "utf8",
    )
    const fnMatch = benchScript.match(/async function writeBenchmarkModelConfig[\s\S]*?^}/m)
    expect(fnMatch).not.toBeNull()
    const body = fnMatch![0]
    expect(body).toContain("auto_permission: true")
    expect(body).toContain("experimental:")

    const blockMatch = body.match(/experimental:\s*\{[\s\S]*?\}/)
    expect(blockMatch).not.toBeNull()
    expect(blockMatch![0]).toContain("auto_permission: true")
  })
})
