/**
 * Goal-run wall-clock liveness scanner.
 *
 * Reads engine_goal_run.last_progress_at — a chunk-driven wall-clock
 * stamp written by pipeline/executor.ts on every observed executor
 * event — and fails any live row whose last progress is older than
 * EngineConfig.activity.goal_run_idle_ms.
 *
 * This is the LAST line of defence below the session-llm gate
 * (session/processor.ts) and the executor-events gate (util/event-
 * queue.ts). If both inner gates somehow miss a silent stall, the
 * scanner's own setInterval tick is the independent wall-clock that
 * catches the corpse — unlike the old approach, nothing about this
 * scanner is driven by the thing it is supposed to be watching.
 *
 * Not a state machine: the scanner only writes `status = "failed"` +
 * an error message. Readiness, retry, replan are all decided by the
 * orchestrator LLM on its next turn (rule #23).
 */

import { Scheduler } from "@/scheduler"
import { Database, and, eq, inArray, sql, lt } from "@/storage/db"
import { EngineGoalRunTable } from "./engine.sql"
import { updateGoalRun } from "./persist"
import { EngineConfig } from "./config"
import { Log } from "@/util/log"

const log = Log.create({ service: "goal-run-watchdog" })
const SCAN_INTERVAL_MS = 60_000
const LIVE_STATUSES = ["queued", "running", "retrying", "evaluating", "planning"] as const

export namespace GoalRunWatchdog {
  export function init() {
    Scheduler.register({
      id: "goal-run-watchdog.scan",
      interval: SCAN_INTERVAL_MS,
      run: scan,
      scope: "instance",
    })
    log.info("goal-run watchdog initialized")
  }

  async function scan() {
    const cfg = await EngineConfig.get()
    const cutoff = Date.now() - cfg.activity.goal_run_idle_ms
    // last_progress_at IS NULL guards newly-claimed rows that have not yet
    // received their first chunk: those are covered by the session-llm gate
    // and the executor-events gate, and we must not kill them before they
    // get a chance to stamp. time_started older than cutoff AND
    // last_progress_at still NULL means "started, never progressed" —
    // that's the signal we want.
    const stale = Database.use((db) =>
      db
        .select()
        .from(EngineGoalRunTable)
        .where(
          and(
            inArray(EngineGoalRunTable.status, [...LIVE_STATUSES]),
            sql`(
              (${EngineGoalRunTable.last_progress_at} IS NOT NULL AND ${EngineGoalRunTable.last_progress_at} < ${cutoff})
              OR (${EngineGoalRunTable.last_progress_at} IS NULL AND ${EngineGoalRunTable.time_started} IS NOT NULL AND ${EngineGoalRunTable.time_started} < ${cutoff})
            )`,
          ),
        )
        .all(),
    )
    for (const row of stale) {
      const ageMs = Date.now() - (row.last_progress_at ?? row.time_started ?? 0)
      log.warn("failing silently-stalled goal_run", {
        goalRunID: row.id,
        goalID: row.goal_id,
        status: row.status,
        ageMs,
      })
      try {
        updateGoalRun(row.id, {
          status: "failed",
          error: `Goal run produced no executor events for ${Math.round(ageMs / 1000)}s ` +
            `(goal_run_idle_ms=${cfg.activity.goal_run_idle_ms}ms). Scanner-level kill — ` +
            `LLM-stream and executor-event gates both missed the stall.`,
        })
      } catch (err) {
        log.warn("goal-run watchdog updateGoalRun failed", {
          goalRunID: row.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}
