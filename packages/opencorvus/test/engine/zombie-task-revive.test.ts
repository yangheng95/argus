import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Restart/resume contract:
 *
 * Re-opening the overlay after an OpenCorvus process restart must restore
 * visible task context only. Runtime polling must not restart the
 * orchestrator loop for an active task just because this process has no
 * in-memory loop handle; the next wake must be a real user message.
 */

describe("EngineRuntime — passive restart resume", () => {
  test("monitorRuns does not auto-revive active tasks after sync wave", async () => {
    const runtimeSrc = await fs.readFile(path.join(import.meta.dir, "..", "..", "src", "engine", "runtime.ts"), "utf8")
    expect(runtimeSrc).not.toMatch(/async function reviveZombieTasks\b/)
    expect(runtimeSrc).not.toMatch(/await reviveZombieTasks\(\)/)
    expect(runtimeSrc).not.toMatch(/resumeActiveTaskLoop/)
    expect(runtimeSrc).not.toMatch(/isLoopInFlight/)
    expect(runtimeSrc).not.toMatch(/hasExplicitOrchestratorStreamErrorSinceTaskStart/)
  })

  test("describe.ts keeps stream-error facts for the next user-driven wake", async () => {
    const describeSrc = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "src", "engine", "describe.ts"),
      "utf8",
    )
    expect(describeSrc).toMatch(/listOrchestratorStreamErrorArtifacts/)
    expect(describeSrc).toMatch(/recent_stream_failures/)
    expect(describeSrc).toMatch(/Recent orchestrator stream failures/)
    expect(describeSrc).toMatch(/next user-driven wake/)
  })
})
