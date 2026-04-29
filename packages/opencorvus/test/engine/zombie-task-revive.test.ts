import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * 2026-04-30 — overlay-web-benchmark wedged indefinitely after the
 * orchestrator's first wake hit `AbortError: stream idle > 180000ms` from
 * `alibaba-coding-plan-cn` (transient connection blip documented in
 * MEMORY/feedback_alibaba_connection.md). `Orchestrator.processTask`
 * returned (abort caught inside session.processor as cancel),
 * orchestrator-loop logged "task loop exited", and nothing else fired —
 * task stayed `status=active` with no in-flight loop and no downstream
 * wake. Same wedge pattern as the inject_message gap (commit 5861ebc3b)
 * and the delivery_rework gap, but on the upstream side: no decision
 * means no decision-driven wake.
 *
 * `resumeActiveTaskLoop` was defined for exactly this safety net but was
 * never called from anywhere — the comment `the poll safety net` was
 * aspirational. EngineRuntime.monitorRuns now invokes
 * `reviveZombieTasks()` after every sync wave, sweeping active tasks
 * with no in-flight loop and resuming them.
 *
 * This pins the wiring at the source level: any future refactor that
 * drops the call from monitorRuns or removes the helper fails CI.
 */

describe("EngineRuntime — zombie task revive wiring", () => {
  test("monitorRuns calls reviveZombieTasks after sync wave", async () => {
    const runtimeSrc = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "src", "engine", "runtime.ts"),
      "utf8",
    )
    expect(runtimeSrc).toMatch(/async function reviveZombieTasks\b/)
    expect(runtimeSrc).toMatch(/await reviveZombieTasks\(\)/)
    // Pin the dependency on resumeActiveTaskLoop so a queue-side rename
    // doesn't quietly orphan the safety net.
    expect(runtimeSrc).toMatch(/resumeActiveTaskLoop/)
    expect(runtimeSrc).toMatch(/isLoopInFlight/)
  })

  test("queue exports the helpers reviveZombieTasks depends on", async () => {
    const queue = await import("../../src/engine/queue")
    expect(typeof queue.resumeActiveTaskLoop).toBe("function")
    expect(typeof queue.isLoopInFlight).toBe("function")
  })
})
