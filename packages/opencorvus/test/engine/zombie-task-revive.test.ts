import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Engine wedge fix (specs/engine-stream-error-wedge-2026-04-30.md):
 *
 * Earlier this test pinned the inverted contract — `reviveZombieTasks`
 * refused to wake any task that had an `orchestrator-stream-error`
 * artifact, "waiting for external wake". In autonomous CLI bench mode
 * there is no external wake source, so a single transient HTTP 401 on
 * the first orchestrator wake (e.g. the international
 * `alibaba-coding-plan` endpoint rejecting 国内 sk-sp-* keys, fixed in
 * commit `5fe320b28`) wedged the task forever.
 *
 * The fix:
 *   - `engine/describe.ts` now projects recent
 *     `orchestrator-stream-error` artifacts into
 *     `TaskDesc.recent_stream_failures`, and
 *     `renderTaskDescription` renders them as a "Recent orchestrator
 *     stream failures" section in the orchestrator prompt.
 *   - `reviveZombieTasks` resumes the task regardless of stream-error
 *     history; the LLM reads the failure list on its next wake and
 *     decides `retry_task` / `restart_from_stage` / `fail_task`
 *     itself (rule 13 — no engine state machine deciding for the LLM).
 *
 * This test pins the wiring at the source level so a future refactor
 * can't quietly reintroduce the wedge.
 */

describe("EngineRuntime — zombie task revive wiring", () => {
  test("monitorRuns calls reviveZombieTasks after sync wave", async () => {
    const runtimeSrc = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "src", "engine", "runtime.ts"),
      "utf8",
    )
    expect(runtimeSrc).toMatch(/async function reviveZombieTasks\b/)
    expect(runtimeSrc).toMatch(/await reviveZombieTasks\(\)/)
    expect(runtimeSrc).toMatch(/resumeActiveTaskLoop/)
    expect(runtimeSrc).toMatch(/isLoopInFlight/)
  })

  test("reviveZombieTasks no longer guards on orchestrator stream-error artifacts", async () => {
    const runtimeSrc = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "src", "engine", "runtime.ts"),
      "utf8",
    )
    // The legacy guard helper and its log line must be gone — the wedge
    // they produced is the regression this test exists to prevent.
    expect(runtimeSrc).not.toMatch(/hasExplicitOrchestratorStreamErrorSinceTaskStart/)
    expect(runtimeSrc).not.toMatch(/waiting for external wake/)
  })

  test("describe.ts is the new consumer of orchestrator-stream-error artifacts", async () => {
    const describeSrc = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "src", "engine", "describe.ts"),
      "utf8",
    )
    // Single source for projecting the artifacts into the LLM prompt — if
    // this projection is ever dropped, the LLM goes blind to stream errors
    // and the wedge effectively returns even with the runtime guard gone.
    expect(describeSrc).toMatch(/listOrchestratorStreamErrorArtifacts/)
    expect(describeSrc).toMatch(/recent_stream_failures/)
    expect(describeSrc).toMatch(/Recent orchestrator stream failures/)
  })

  test("queue exports the helpers reviveZombieTasks depends on", async () => {
    const queue = await import("../../src/engine/queue")
    expect(typeof queue.resumeActiveTaskLoop).toBe("function")
    expect(typeof queue.isLoopInFlight).toBe("function")
  })
})
