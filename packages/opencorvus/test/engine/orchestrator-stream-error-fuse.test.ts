import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import {
  ORCHESTRATOR_STREAM_ERROR_FUSE_THRESHOLD,
  ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS,
  maybeTripOrchestratorStreamErrorFuse,
} from "../../src/engine/persist"
import { findTask } from "../../src/engine/store"
import { isTaskTerminal } from "../../src/engine/task-status"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

/**
 * Stream-error retry circuit breaker. See
 * specs/new-arch/2026-05-08-stream-early-death-and-retry-fuse.md.
 *
 * Three orchestrator-stream-error artifacts within
 * ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS for the same task records a
 * visible task error without writing terminal failed. The scheduler sees the
 * durable artifacts/error and decides repair vs fail_task explicitly. This
 * caps the deterministic-replay loop observed on
 * tsk_e078e1f2a001t4ZwUl5SWgoG8o (277 identical DeepSeek 400s in 2.5 minutes)
 * without making a host-side terminal lifecycle decision.
 */

let projectID = ""
let taskID = ""
let stamp = ""

function seedTask(taskStartedMs: number) {
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "stream-error fuse test",
        sandboxes: [],
        time_created: taskStartedMs,
        time_updated: taskStartedMs,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "stream-error fuse",
        request: "test",
        kind: "workflow",
        priority: "normal",
        time_created: taskStartedMs,
        time_updated: taskStartedMs,
        time_started: taskStartedMs,
      })
      .run()
  })
}

function seedStreamError(input: { artifactID: string; timeCreated: number; reason: string; errorName?: string }) {
  Database.transaction((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: input.artifactID,
        task_id: taskID,
        run_id: null,
        kind: "orchestrator-stream-error",
        label: "orchestrator-stream-error",
        payload: {
          reason: input.reason,
          errorName: input.errorName ?? null,
          sessionID: null,
        },
        time_created: input.timeCreated,
        time_updated: input.timeCreated,
      })
      .run()
  })
}

beforeEach(async () => {
  await resetDatabase()
  stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  projectID = `proj_fuse_${stamp}`
  taskID = `tsk_fuse_${stamp}`
})

afterEach(async () => {
  await resetDatabase()
})

describe("maybeTripOrchestratorStreamErrorFuse", () => {
  test("threshold and window constants are stable contract", () => {
    // The 2026-05-08 incident produced ~1.8 errors/sec for 2.5 minutes.
    // Threshold=3 in 60s means the fuse trips within ~5s under that load,
    // not within 5 minutes. Loosening these values silently regresses the
    // tight-loop bound, so pin them.
    expect(ORCHESTRATOR_STREAM_ERROR_FUSE_THRESHOLD).toBe(3)
    expect(ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS).toBe(60_000)
  })

  test("does not trip with fewer than threshold errors in window", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedTask(now - 10_000)
        seedStreamError({ artifactID: `art_a_${stamp}`, timeCreated: now - 2_000, reason: "first" })
        seedStreamError({ artifactID: `art_b_${stamp}`, timeCreated: now - 1_000, reason: "second" })

        const result = await maybeTripOrchestratorStreamErrorFuse({
          taskID,
          now,
          lastReason: "second",
        })

        expect(result.tripped).toBe(false)
        expect(result.consecutive).toBe(2)
        const task = findTask(taskID)
        expect(task).toBeDefined()
        expect(isTaskTerminal(task!)).toBe(false)
      },
    })
  })

  test("trips when threshold reached in window — records scheduler-visible error without failing task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedTask(now - 10_000)
        seedStreamError({ artifactID: `art_a_${stamp}`, timeCreated: now - 3_000, reason: "first" })
        seedStreamError({ artifactID: `art_b_${stamp}`, timeCreated: now - 2_000, reason: "second" })
        seedStreamError({ artifactID: `art_c_${stamp}`, timeCreated: now - 1_000, reason: "third" })

        const result = await maybeTripOrchestratorStreamErrorFuse({
          taskID,
          now,
          lastReason: "APIError: Provider deepseek returned HTTP 400: Invalid assistant message",
        })

        expect(result.tripped).toBe(true)
        expect(result.consecutive).toBeGreaterThanOrEqual(3)
        const task = findTask(taskID)
        expect(task).toBeDefined()
        expect(isTaskTerminal(task!)).toBe(false)
        expect(task!.error).toContain("consecutive")
        expect(task!.error).toContain("HTTP 400")
        expect(task!.time_completed).toBeNull()
      },
    })
  })

  test("does not trip when 3rd error is outside the window (older than 60s)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedTask(now - 200_000)
        // One stale error from 90s ago — should not count.
        seedStreamError({ artifactID: `art_old_${stamp}`, timeCreated: now - 90_000, reason: "stale" })
        // Two recent errors.
        seedStreamError({ artifactID: `art_a_${stamp}`, timeCreated: now - 2_000, reason: "first" })
        seedStreamError({ artifactID: `art_b_${stamp}`, timeCreated: now - 1_000, reason: "second" })

        const result = await maybeTripOrchestratorStreamErrorFuse({
          taskID,
          now,
          lastReason: "second",
        })

        expect(result.tripped).toBe(false)
        expect(result.consecutive).toBe(2)
        const task = findTask(taskID)
        expect(isTaskTerminal(task!)).toBe(false)
      },
    })
  })

  test("does not re-fail an already-terminal task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const startedAt = now - 10_000
        seedTask(startedAt)
        // Pre-mark task as cancelled (terminal but not failed) to verify the
        // fuse does not overwrite a different terminal verdict.
        Database.transaction((db) => {
          db.update(EngineTaskTable)
            .set({
              time_completed: now - 5_000,
              metadata: { cancelled: true },
              error: "Cancelled by operator",
              time_updated: now - 5_000,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })
        seedStreamError({ artifactID: `art_a_${stamp}`, timeCreated: now - 3_000, reason: "first" })
        seedStreamError({ artifactID: `art_b_${stamp}`, timeCreated: now - 2_000, reason: "second" })
        seedStreamError({ artifactID: `art_c_${stamp}`, timeCreated: now - 1_000, reason: "third" })

        const result = await maybeTripOrchestratorStreamErrorFuse({
          taskID,
          now,
          lastReason: "third",
        })

        // Threshold reached but task is already terminal — fuse must not
        // re-touch it.
        expect(result.tripped).toBe(false)
        const task = findTask(taskID)
        expect(task!.error).toBe("Cancelled by operator")
      },
    })
  })
})
