import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import type { StreamActivityMonitor } from "@/util/stream-activity"
import { Database, eq } from "@/storage/db"
import { SessionTable } from "./session.sql"
import { timelineOrderKey, timelineOrderKeyDomain } from "@/timeline/order"

export function sessionLifecycleOrderKey(sessionID: string): string {
  const row = Database.use((db) =>
    db.select({ timeCreated: SessionTable.time_created }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
  )
  if (!row) throw new Error(`session lifecycle ${sessionID} missing persisted row`)
  return timelineOrderKey({
    domain: "session",
    time: row.timeCreated,
    id: sessionID,
  })
}

function isSessionOrderKey(value: string): boolean {
  try {
    return timelineOrderKeyDomain(value, "session lifecycle orderKey") === "session"
  } catch {
    return false
  }
}

export namespace SessionStatus {
  /**
   * Session lifecycle phase. Single source of truth for overlay card spinner
   * state and terminal display — see `specs/current/architecture/07-panel-reactivity.md`.
   *
   *   streaming = LLM round-trip in flight (overlay shows spinner)
   *   retry     = streaming, currently sleeping between provider retries
   *   idle      = between turns, awaiting user message / next wake (no spinner)
   *   terminal  = session actor closed; reason explains why
   *
   * Replaces the per-phase `<phase>.completed` bus events that previously
   * served as the only terminal signal for subagent overlay cards.
   */
  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("streaming"),
      }),
      z.object({
        type: z.literal("terminal"),
        reason: z.enum(["completed", "error", "aborted", "artifact_missing"]),
        summary: z.string().min(1).optional(),
        error: z.string().optional(),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const LifecycleOrderKey = z.string().min(1).refine(isSessionOrderKey, {
    message: "expected session orderKey",
  })

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: z.string(),
        orderKey: LifecycleOrderKey,
        status: Info,
      }),
    ),
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: z.string(),
        orderKey: LifecycleOrderKey,
      }),
    ),
  }

  // Process-singleton, NOT lazyInstanceState. Sessions cross Instance
  // boundaries during their lifecycle: build sessions run their actor in the
  // worktree Instance (close() emits `terminal aborted`) while
  // runAgentSession returns in the caller / orchestrator Instance (emits
  // `terminal completed`). With a per-Instance map, each Instance's local
  // latch passed independently and the bus carried both — exactly the
  // duplicate-terminal shape audit §11.3 documented at bench lines
  // 19182-19183. One process = one map = one latch (rule 8 single source).
  const state: Record<string, Info> = {}
  const activityMonitors: Record<string, StreamActivityMonitor> = {}

  export function get(sessionID: string) {
    return (
      state[sessionID] ?? {
        type: "idle",
      }
    )
  }

  export function list() {
    return state
  }

  export function registerActivityMonitor(sessionID: string, monitor: StreamActivityMonitor): () => void {
    activityMonitors[sessionID] = monitor
    return () => {
      if (activityMonitors[sessionID] === monitor) {
        delete activityMonitors[sessionID]
      }
    }
  }

  export function getActivity(sessionID: string) {
    const monitor = activityMonitors[sessionID]
    if (!monitor) return undefined
    return {
      last_activity_at: monitor.lastActivityAt(),
    }
  }

  export function abortActivityMonitor(sessionID: string, reason?: unknown) {
    activityMonitors[sessionID]?.abort(reason)
  }

  export function set(sessionID: string, status: Info, options?: { publish?: boolean }) {
    // Single-source terminal guard (rule 8): once a session reaches a
    // terminal state, subsequent set() calls are silently dropped, except
    // artifact-missing integrity sessions which may be upgraded from an
    // already-completed tool lifecycle into a data-integrity terminal status.
    //
    // Without this guard, multiple cleanup paths each thought they were
    // authoritative and emitted their own terminal: prompt/state.ts cancel()
    // emitted `terminal aborted`, the actor's natural serve() exit emitted
    // `terminal completed` 6 ms later, and the bus carried both — producing
    // the `terminal=aborted` + `terminal=completed` double-fire that left
    // engine_artifact kind=goal_run_attempt permanently `running` in
    // tsk_ddc529dfd0011ajJTgBqdlroyk G4 (TLS error 03:32:16 → status=idle
    // 03:32:21.577 → status=terminal reason=aborted 03:32:21.595 →
    // status=terminal reason=completed 03:32:21.601 → goal_run never
    // reaches attempt-failed/aborted because the second terminal mis-classified
    // the session as a clean completion).
    //
    // First terminal wins. Streaming/retry/idle after terminal are also
    // dropped — there is no "back from terminal", and any late arrival
    // is a sign of a cleanup race we do NOT want to paper over by reopening
    // the session.
    const current = state[sessionID]
    if (
      current?.type === "terminal" &&
      !(current.reason === "completed" && status.type === "terminal" && status.reason === "artifact_missing")
    )
      return
    // Seal the latch BEFORE publishing. Bus.publish dispatches subscribers
    // synchronously; if a subscriber re-enters set() (audit §11.3 H1 —
    // observed when message-bridge handlers chain into other session writes),
    // the inner call must see the sealed state and short-circuit. Original
    // ordering (publish → write) opened a TOCTOU window where two concurrent
    // terminal calls could both pass the line-97 check before either wrote.
    if (status.type === "idle") {
      delete state[sessionID]
      delete activityMonitors[sessionID]
    } else {
      state[sessionID] = status
    }
    if (options?.publish !== false) {
      const orderKey = sessionLifecycleOrderKey(sessionID)
      Bus.publish(Event.Status, {
        sessionID,
        orderKey,
        status,
      })
      if (status.type === "idle") {
        Bus.publish(Event.Idle, {
          sessionID,
          orderKey,
        })
      }
    }
    // Terminal is kept in state (not deleted) so SessionStatus.get() can
    // distinguish a closed session from one that simply has no entry yet.
    // Idle is the default fallback in get(), so we delete idle to avoid
    // unbounded accumulation; terminal is rare and bounded by session count.
  }

  export function markArtifactMissing(sessionID: string, error: string) {
    set(sessionID, {
      type: "terminal",
      reason: "artifact_missing",
      error,
    })
  }
}
