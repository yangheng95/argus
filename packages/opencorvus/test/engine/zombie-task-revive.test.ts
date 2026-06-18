import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Restart/resume contract:
 *
 * Re-opening the overlay after an OpenCorvus process restart must restore
 * visible task context without restoring old executor/status polling. The
 * only periodic runtime wake allowed here is the narrow no-live-goal liveness
 * check for a non-terminal task whose active run has no live child goal runs.
 */

describe("EngineRuntime — passive restart resume", () => {
  test("monitorRuns keeps only the no-live-goal liveness wake", async () => {
    const runtimeSrc = await fs.readFile(path.join(import.meta.dir, "..", "..", "src", "engine", "runtime.ts"), "utf8")
    const taskApiSrc = await fs.readFile(path.join(import.meta.dir, "..", "..", "src", "task-api", "index.ts"), "utf8")
    expect(runtimeSrc).not.toMatch(/async function reviveZombieTasks\b/)
    expect(runtimeSrc).not.toMatch(/await reviveZombieTasks\(\)/)
    expect(runtimeSrc).not.toMatch(/resumeActiveTaskLoop/)
    expect(runtimeSrc).not.toMatch(/isLoopInFlight/)
    expect(runtimeSrc).not.toMatch(/hasExplicitOrchestratorStreamErrorSinceTaskStart/)
    const monitorBody = runtimeSrc.match(/export async function monitorRuns[\s\S]*?\n  }\n\n  \/\*\*/)?.[0] ?? ""
    expect(monitorBody).toContain("syncRun(")
    expect(runtimeSrc).toContain("noLiveGoalWakeFingerprint")
    expect(runtimeSrc).not.toMatch(/ExecutorRegistry/)
    expect(runtimeSrc).not.toMatch(/executor\.status/)
    expect(runtimeSrc).not.toMatch(/queue\.status/)
    expect(runtimeSrc).not.toMatch(/auto-rejecting stale interaction/)
    expect(taskApiSrc).not.toContain('id: "engine.poll"')
    expect(taskApiSrc).toContain('id: "engine.liveness"')
    expect(taskApiSrc).toMatch(/Scheduler\.register\(\{[\s\S]*EngineRuntime\.monitorRuns/)
    expect(taskApiSrc).not.toContain('id: "task-queue-service.poll"')
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
