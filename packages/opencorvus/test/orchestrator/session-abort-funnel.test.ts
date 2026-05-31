import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findRun } from "../../src/engine/store"
import { Identifier } from "../../src/id/id"
import { Orchestrator } from "../../src/orchestrator/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Database, and, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { installControlModel } from "../workspace/mock-control-model"

/**
 * Regression for the orchestrator-abort-during-prompt funnel
 * (two-bug investigation 2026-05-27, task tsk_e69f53874001ERv2QFHWICqGuW).
 *
 * Pre-fix, two bugs combined to silently lose work + leak resources when
 * `interruptTaskLoop` fired mid-prompt (the normal path for operator
 * messages and dispatch reorders):
 *
 *  Bug 2 — orchestrator-stream-error single source bypassed.
 *    The catch handler in `Orchestrator.processTask` returned early on
 *    `ctrl.signal.aborted`, so `recordOrchestratorStreamError` was never
 *    called. The next wake's describe block had no record of the prior
 *    turn being killed mid-flight; rule 23's "artifact is the single
 *    source of truth for stream failures" was violated.
 *
 *  Bug 3 — orphan child sessions.
 *    The orchestrator's `abortPrompt` listener only cancelled the
 *    orchestrator session itself; in-flight tool-spawned subagents
 *    (explore / requirements / frontend_design / architect / build) kept
 *    running, burning tokens on results no one was awaiting. Confirmed
 *    in production: a single `explore` ran 29+ minutes / 148k tokens /
 *    142 tool calls after its parent orchestrator had been aborted.
 *
 * These tests freeze the post-fix behaviour at the funnel boundary.
 */

function insertActiveRun(input: {
  taskID: string
  runID: string
  rootSessionID: string
  now: number
}) {
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: Instance.project.id,
        session_id: input.rootSessionID,
        source: "test",
        title: "Orchestrator abort funnel",
        request: "do work",
        kind: "workflow",
        priority: "normal",
        time_created: input.now,
        time_updated: input.now,
        time_started: input.now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: input.runID,
        task_id: input.taskID,
        run_id: input.runID,
        kind: "run",
        label: "run-running",
        payload: {
          plan_version_id: null,
          session_id: input.rootSessionID,
          executor: "opencorvus",
          status: "running",
          phase: "dispatch",
          blocking_reason: null,
          error: null,
          retry_count: 0,
          executor_ref: null,
          metadata: null,
          time_started: input.now,
          time_completed: null,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  })
}

function streamErrorArtifacts(taskID: string) {
  return Database.use((db) =>
    db.select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "orchestrator-stream-error")))
      .all(),
  )
}

describe("orchestrator abort funnel", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("ctrl-abort mid-prompt records an orchestrator-stream-error artifact (Bug 2)", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const root = await Session.create({ kind: "root", title: "abort funnel root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: { model: "mock-control/control" },
        })
        insertActiveRun({ taskID, runID, rootSessionID: root.id, now })

        // Simulate `interruptTaskLoop` firing while SessionPrompt.prompt is
        // in flight: the test pretends to be a slow LLM call by waiting on
        // a manually-resolved deferred; meanwhile we trigger
        // `Orchestrator.abort(taskID)` which aborts the orchestrator's
        // ctrl, which fires the abortPrompt listener, which would have
        // called SessionPrompt.cancel in production. The mock skips the
        // SessionPrompt machinery and directly emulates the cancel
        // outcome: rejection with `new Error("session cancelled")` is what
        // `SessionPromptState.cancel` produces in real code.
        const prompt = spyOn(SessionPrompt, "prompt")
        prompt.mockImplementation((async () => {
          // Schedule an abort that races the prompt's resolution.
          queueMicrotask(() => Orchestrator.abort(taskID))
          // Yield enough microtasks for ctrl.abort to flip the signal
          // (the production SessionPromptState.cancel does this
          // synchronously, but here we mimic the timing).
          await new Promise<void>((resolve) => setTimeout(resolve, 5))
          throw new Error("session cancelled")
        }) as never)

        await Orchestrator.processTask(taskID)

        // Rule 23: stream failures land as append-only artifacts so the
        // next wake's describe surfaces them to the LLM. Ctrl-abort is a
        // stream failure from the orchestrator's perspective: the prior
        // turn was killed before deciding anything.
        const artifacts = streamErrorArtifacts(taskID)
        expect(artifacts).toHaveLength(1)
        const payload = artifacts[0]!.payload as { errorName?: string; reason?: string }
        expect(payload.errorName).toBe("OrchestratorAborted")
        expect(payload.reason).toContain("OrchestratorAborted")
        expect(payload.reason).toContain("orchestrator aborted")

        // blockActiveRunForTask must mark the run blocked so subsequent
        // wakes/monitorRuns see the same fact via the engine_artifact
        // run row's blocking_reason column.
        const run = findRun(runID)
        expect(run?.status).toBe("blocked")
        expect(run?.blocking_reason).toBe("orchestrator_stream_error")

        // Aborts MUST NOT stamp task.error: aborts are control-flow
        // signals (operator restarting with a new event, or explicit
        // cancel), not "task is broken". UI/orphan-recovery would
        // otherwise treat the next wake as stuck on a hard failure.
        const refreshed = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(refreshed?.error ?? null).toBeNull()
      },
    })
  })

  test("orchestrator abort cascades cancel to descendant sessions (Bug 3)", async () => {
    installControlModel()
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const root = await Session.create({ kind: "root", title: "cascade root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: { model: "mock-control/control" },
        })
        insertActiveRun({ taskID, runID, rootSessionID: root.id, now })

        // Capture SessionPrompt.cancel calls without breaking other
        // SessionPrompt namespace behaviour. The orchestrator's abort
        // cascade walks Session.tree(orchestratorSessionID) and calls
        // cancel on every descendant — including the orchestrator itself.
        const cancelled: string[] = []
        const cancelSpy = spyOn(SessionPrompt, "cancel").mockImplementation((sessionID: string) => {
          cancelled.push(sessionID)
        })

        // While SessionPrompt.prompt runs (mocked to wait), spawn two
        // child sessions under the orchestrator session to simulate
        // in-flight `explore` / `requirements` tool dispatchers. Then
        // abort the orchestrator and assert all descendants were
        // cancelled, not just the orchestrator session itself.
        const prompt = spyOn(SessionPrompt, "prompt")
        prompt.mockImplementation((async (input) => {
          // The orchestrator session is the one SessionPrompt.prompt was
          // called against — sitting directly under root.
          const orchestratorSessionID = input.sessionID
          const childA = await Session.createNext({
            kind: "explore",
            parentID: orchestratorSessionID,
            title: "child explore A",
            directory: Instance.directory,
          })
          const childB = await Session.createNext({
            kind: "explore",
            parentID: orchestratorSessionID,
            title: "child explore B",
            directory: Instance.directory,
          })
          // Spawn a grandchild to verify recursion depth > 1.
          const grandchild = await Session.createNext({
            kind: "explore",
            parentID: childA.id,
            title: "grandchild explore",
            directory: Instance.directory,
          })
          void grandchild
          // Surface the orchestrator session ID into the closure so the
          // outer test can compare cancelled IDs.
          ;(globalThis as Record<string, unknown>).__orchSession = orchestratorSessionID
          ;(globalThis as Record<string, unknown>).__childA = childA.id
          ;(globalThis as Record<string, unknown>).__childB = childB.id
          ;(globalThis as Record<string, unknown>).__grandchild = grandchild.id
          // Schedule abort to race the prompt's "wait".
          queueMicrotask(() => Orchestrator.abort(taskID))
          await new Promise<void>((resolve) => setTimeout(resolve, 20))
          throw new Error("session cancelled")
        }) as never)

        await Orchestrator.processTask(taskID)

        // Give the cascade async walk a moment to complete (abortPrompt
        // fires-and-forgets via void IIFE so processTask may return
        // before Session.tree resolves on slower CI).
        await new Promise<void>((resolve) => setTimeout(resolve, 50))

        const orchSession = (globalThis as Record<string, unknown>).__orchSession as string
        const childA = (globalThis as Record<string, unknown>).__childA as string
        const childB = (globalThis as Record<string, unknown>).__childB as string
        const grandchild = (globalThis as Record<string, unknown>).__grandchild as string

        // Every session under the orchestrator must have been cancelled,
        // including the orchestrator session itself. Without the cascade
        // fix the children kept running indefinitely.
        expect(cancelled).toContain(orchSession)
        expect(cancelled).toContain(childA)
        expect(cancelled).toContain(childB)
        expect(cancelled).toContain(grandchild)

        // Order: descendants first, then ancestor — so a parent's
        // processor sees its tool's child session already terminal when
        // it unwinds. Find each ID's index and assert grandchild < childA
        // and childA < orchestrator (we don't pin exact childA/childB
        // order because they're siblings).
        const idxOrch = cancelled.indexOf(orchSession)
        const idxChildA = cancelled.indexOf(childA)
        const idxGrand = cancelled.indexOf(grandchild)
        expect(idxGrand).toBeLessThan(idxChildA)
        expect(idxChildA).toBeLessThan(idxOrch)

        cancelSpy.mockRestore()
      },
    })
  })
})
