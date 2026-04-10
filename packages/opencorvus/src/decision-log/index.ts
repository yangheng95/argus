/**
 * Decision Log — shared context for all agents.
 *
 * Design:
 * - Append-only: multiple agents can append concurrently (safe).
 * - Scoped per task_id: Task 2 does not read Task 1's decisions.
 * - Injected via constructor into each agent (not global singleton).
 * - Carries WHY (reason), not just WHAT (value).
 *
 * Lifecycle:
 * 1. Decompose Agent seeds: runtime, stack, frontend, test framework.
 * 2. Per-goal Eval Agent appends: discovered API contracts, DB paths, test commands.
 * 3. Subsequent goal Planners read: avoid re-discovering known decisions.
 */

import { Database, eq, and, desc } from "@/storage/db"
import { DecisionLogTable } from "./schema"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"

const log = Log.create({ service: "decision-log" })

export interface DecisionEntry {
  id: string
  taskID: string
  goalID: string | null
  phase: string
  key: string
  value: string
  reason: string
  timeCreated: number
}

export interface DecisionLogWriter {
  /** Append a decision entry. Safe to call concurrently. */
  append(entry: {
    goalID?: string
    phase: string
    key: string
    value: string
    reason: string
  }): void
}

export interface DecisionLogReader {
  /** Read all decisions for this task, ordered by creation time. */
  read(): DecisionEntry[]
  /** Read all decisions for a specific phase (e.g., "architect", "decompose"). */
  readByPhase(phase: string): DecisionEntry[]
  /** Read the latest decision for a specific key. */
  readByKey(key: string): DecisionEntry | undefined
  /** Format all decisions as a text block for LLM context injection. */
  toPromptSection(): string
  /**
   * Format decisions for a specific phase as a prompt section under the
   * given heading. Caller must supply the heading because the same phase
   * can be surfaced under different titles depending on context.
   * Returns "" when no entries exist for the phase.
   */
  phasePromptSection(phase: string, heading: string): string
}

export type DecisionLog = DecisionLogWriter & DecisionLogReader

/**
 * Create a DecisionLog instance scoped to a specific task.
 * Inject this into agents — do not use as a global singleton.
 */
export function createDecisionLog(taskID: string): DecisionLog {
  return {
    append(entry) {
      const id = Identifier.ascending("decision_log")
      const now = Date.now()
      try {
        Database.use((db) =>
          db.insert(DecisionLogTable).values({
            id,
            task_id: taskID,
            goal_id: entry.goalID ?? null,
            phase: entry.phase,
            key: entry.key,
            value: entry.value,
            reason: entry.reason,
            time_created: now,
          }).run(),
        )
        log.info("decision logged", { taskID, key: entry.key, value: entry.value, phase: entry.phase })
      } catch (err) {
        log.warn("decision log append failed (non-fatal)", { taskID, key: entry.key, error: String(err) })
      }
    },

    read(): DecisionEntry[] {
      return Database.use((db) =>
        db.select().from(DecisionLogTable)
          .where(eq(DecisionLogTable.task_id, taskID))
          .orderBy(DecisionLogTable.time_created)
          .all(),
      ).map(rowToEntry)
    },

    readByPhase(phase: string): DecisionEntry[] {
      return Database.use((db) =>
        db.select().from(DecisionLogTable)
          .where(and(eq(DecisionLogTable.task_id, taskID), eq(DecisionLogTable.phase, phase)))
          .orderBy(DecisionLogTable.time_created)
          .all(),
      ).map(rowToEntry)
    },

    readByKey(key: string): DecisionEntry | undefined {
      const row = Database.use((db) =>
        db.select().from(DecisionLogTable)
          .where(and(eq(DecisionLogTable.task_id, taskID), eq(DecisionLogTable.key, key)))
          .orderBy(desc(DecisionLogTable.time_created))
          .get(),
      )
      return row ? rowToEntry(row) : undefined
    },

    toPromptSection(): string {
      const entries = this.read()
      if (entries.length === 0) return ""
      const lines = entries.map((e) =>
        `- **${e.key}**: ${e.value}${e.reason ? ` (${e.reason})` : ""}${e.goalID ? ` [goal:${e.goalID.slice(-8)}]` : ""}`,
      )
      return `## Decision Log (${entries.length} entries)\n\n${lines.join("\n")}`
    },

    phasePromptSection(phase: string, heading: string): string {
      const entries = this.readByPhase(phase)
      if (entries.length === 0) return ""
      const lines = entries.map((e) =>
        `### ${e.key}\n${e.value}${e.reason ? `\n_Why: ${e.reason}_` : ""}${e.goalID ? ` [goal:${e.goalID.slice(-8)}]` : ""}`,
      )
      return `## ${heading} (${entries.length} entries)\n\n${lines.join("\n\n")}`
    },
  }
}

function rowToEntry(row: typeof DecisionLogTable.$inferSelect): DecisionEntry {
  return {
    id: row.id,
    taskID: row.task_id,
    goalID: row.goal_id ?? null,
    phase: row.phase,
    key: row.key,
    value: row.value,
    reason: row.reason,
    timeCreated: row.time_created,
  }
}

export { DecisionLogTable } from "./schema"
