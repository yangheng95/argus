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
 * 1. Requirements Agent seeds: runtime, stack, frontend, test framework.
 * 2. Per-goal Eval Agent appends: discovered API contracts, DB paths, test commands.
 * 3. Subsequent goal Planners read: avoid re-discovering known decisions.
 */

import { Database, eq, and, desc } from "@/storage/db"
import { DecisionLogTable } from "./schema"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { ContractIRSchema, renderContractIR } from "@/architect/contract-ir"

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
  append(entry: { goalID?: string; phase: string; key: string; value: string; reason: string }): void
}

export interface DecisionLogReader {
  /** Read all decisions for this task, ordered by creation time. */
  read(): DecisionEntry[]
  /** Read all decisions for a specific phase (e.g., "architect", "requirements"). */
  readByPhase(phase: string): DecisionEntry[]
  /**
   * Read decisions for a specific phase that are either task-scoped
   * (goalID null — applies to all goals) or scoped to the given goalID.
   * This is the goal-scoped read used by per-goal sub-agents to avoid
   * inheriting peer goals' private decisions.
   */
  readByPhaseAndGoal(phase: string, goalID: string): DecisionEntry[]
  /** Read the latest decision for a specific key. */
  readByKey(key: string): DecisionEntry | undefined
  /**
   * Format all decisions as a text block for LLM context injection.
   * When `options.limit` is given, keeps the latest N entries (by
   * time_created, desc) and appends a short note about how many older
   * entries were omitted. Callers on hot paths (orchestrator read_context)
   * must pass a limit to avoid unbounded prompt growth as the log grows.
   */
  toPromptSection(options?: {
    limit?: number
    valueCap?: number
    /** Phases to omit from the section. Useful when the caller renders
     *  some phases in their own dedicated sections (e.g. `phase=review`
     *  surfaces as "## Architecture review history") and wants the
     *  general decision-log section to skip those — otherwise the
     *  high-frequency phase eats the latest-N window and pushes
     *  architect / requirements decisions out of prompt. */
    excludePhases?: string[]
  }): string
  /**
   * Format all decisions for a specific phase as a text block for prompt
   * injection. Includes both task-scoped entries and goal-scoped entries
   * under that phase so task-level reviewers can see the full contract
   * surface without reimplementing decision-log formatting.
   */
  phasePromptSection(phase: string, heading: string, options?: { limit?: number; valueCap?: number }): string
  /**
   * Format decisions for a specific phase, scoped to entries that are
   * either task-wide (no goalID) or attached to `goalID`. Per-goal
   * planners and executors use this so each prompt carries only the
   * decisions relevant to that goal — not every peer goal's local notes.
   * Returns "" when no entries match.
   *
   * `limit` caps entry count (latest-wins when exceeded); `valueCap`
   * caps each entry's value body so a single long LLM-written decision
   * cannot inflate the prompt. Both have conservative defaults so hot
   * callers (per-goal planner / runner, hit every goal-run) stay
   * bounded even without explicit tuning.
   */
  phasePromptSectionForGoal(
    phase: string,
    goalID: string,
    heading: string,
    options?: { limit?: number; valueCap?: number },
  ): string
  /**
   * Render the COMPLETE decision log as a phase-sectioned markdown document —
   * no value cap, no entry limit, every field (key/value/reason/goal/time).
   * This is the body `DecisionLogBundle` materializes under
   * `.opencorvus/runtime/tasks/<taskID>/decision-log.md` so a shell/worktree agent can read the full
   * WHY behind any decision the truncated inline `toPromptSection` summary
   * elided. The SQLite `decision_log` table stays the single source of truth;
   * this is a regenerated, read-only projection. "" when the log is empty.
   */
  toFullDocument(): string
}

export type DecisionLog = DecisionLogWriter & DecisionLogReader

/**
 * Default per-entry `value` cap applied when rendering to prompt text. The
 * decision_log row retains the full value — this cap governs prompt bytes
 * only. Picked to fit a typical interface-contract paragraph; callers with
 * a larger budget pass `valueCap` explicitly.
 */
const DEFAULT_ENTRY_VALUE_CAP = 600

/**
 * Single source of truth for the `toPromptSection({ limit })` entry cap used
 * by every late-stage / per-task consumer (orchestrator read_context,
 * orchestrator refine, integrity reviewer). Rationale: these prompts persist
 * for the life of a session; an unbounded decision log was the dominant
 * contributor to the orchestrator session growing ~10K → 125K tokens across
 * 16 turns. Caps preserve the LATEST state rather than full history.
 *
 * This MUST stay one exported constant — three call sites previously carried
 * divergent literals (20 vs 30), a rule-8 double-source. Do not reintroduce a
 * local literal; import this instead (rule 10 / rule 35).
 */
export const DECISION_LOG_PROMPT_LIMIT = 20

/**
 * Default entry-count cap for `phasePromptSectionForGoal`. Architect
 * sometimes writes one contract per interface — a busy multi-goal task
 * can land 20+ architect entries for a single goal. We keep the latest
 * 15 by default so planner / runner prompts stay bounded.
 */
const DEFAULT_PHASE_ENTRY_LIMIT = 15

function capEntryValue(value: string, cap: number): string {
  const renderedIR = renderContractIRValue(value)
  if (renderedIR) return renderedIR
  if (value.length <= cap) return value
  const omitted = value.length - cap
  // Point the reading agent at an actionable surface. The decision_log SQLite
  // row is not reachable by an LLM/shell agent; the full untruncated body is
  // materialized to the task-scoped DecisionLogBundle projection.
  return `${value.slice(0, cap)}… [+${omitted} chars truncated; full body in the task-scoped decision-log bundle]`
}

function renderContractIRValue(value: string): string | undefined {
  try {
    const parsed = ContractIRSchema.safeParse(JSON.parse(value))
    if (!parsed.success) return undefined
    return renderContractIR(parsed.data)
  } catch {
    return undefined
  }
}

function formatPromptSectionEntries(
  entries: DecisionEntry[],
  heading: string,
  options?: { limit?: number; valueCap?: number },
): string {
  if (entries.length === 0) return ""
  const limit = options?.limit ?? DEFAULT_PHASE_ENTRY_LIMIT
  const shown = entries.length > limit ? entries.slice(entries.length - limit) : entries
  const omitted = entries.length - shown.length
  const valueCap = options?.valueCap ?? DEFAULT_ENTRY_VALUE_CAP
  const lines = shown.map((e) => {
    const value = capEntryValue(e.value, valueCap)
    return `### ${e.key}\n${value}${e.reason ? `\n_Why: ${e.reason}_` : ""}${e.goalID ? ` [goal:${e.goalID.slice(-8)}]` : ""}`
  })
  const count =
    omitted > 0 ? `latest ${shown.length} of ${entries.length}; ${omitted} older omitted` : `${shown.length} entries`
  return `## ${heading} (${count})\n\n${lines.join("\n\n")}`
}

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
          db
            .insert(DecisionLogTable)
            .values({
              id,
              task_id: taskID,
              goal_id: entry.goalID ?? null,
              phase: entry.phase,
              key: entry.key,
              value: entry.value,
              reason: entry.reason,
              time_created: now,
            })
            .run(),
        )
        log.info("decision logged", { taskID, key: entry.key, value: entry.value, phase: entry.phase })
      } catch (err) {
        log.warn("decision log append failed (non-fatal)", { taskID, key: entry.key, error: String(err) })
      }
    },

    read(): DecisionEntry[] {
      return Database.use((db) =>
        db
          .select()
          .from(DecisionLogTable)
          .where(eq(DecisionLogTable.task_id, taskID))
          .orderBy(DecisionLogTable.time_created)
          .all(),
      ).map(rowToEntry)
    },

    readByPhase(phase: string): DecisionEntry[] {
      return Database.use((db) =>
        db
          .select()
          .from(DecisionLogTable)
          .where(and(eq(DecisionLogTable.task_id, taskID), eq(DecisionLogTable.phase, phase)))
          .orderBy(DecisionLogTable.time_created)
          .all(),
      ).map(rowToEntry)
    },

    readByPhaseAndGoal(phase: string, goalID: string): DecisionEntry[] {
      // SQL goal_id IS NULL covers task-scoped entries; equality covers
      // entries owned by this specific goal. We deliberately exclude entries
      // owned by peer goals so each per-goal prompt stays narrow.
      return Database.use((db) =>
        db
          .select()
          .from(DecisionLogTable)
          .where(and(eq(DecisionLogTable.task_id, taskID), eq(DecisionLogTable.phase, phase)))
          .orderBy(DecisionLogTable.time_created)
          .all(),
      )
        .filter((row) => row.goal_id === null || row.goal_id === goalID)
        .map(rowToEntry)
    },

    readByKey(key: string): DecisionEntry | undefined {
      const row = Database.use((db) =>
        db
          .select()
          .from(DecisionLogTable)
          .where(and(eq(DecisionLogTable.task_id, taskID), eq(DecisionLogTable.key, key)))
          .orderBy(desc(DecisionLogTable.time_created))
          .get(),
      )
      return row ? rowToEntry(row) : undefined
    },

    toPromptSection(options?: { limit?: number; valueCap?: number; excludePhases?: string[] }): string {
      const allRaw = this.read()
      if (allRaw.length === 0) return ""
      // Filter excluded phases first so the latest-N slice is taken AFTER
      // exclusion. Otherwise a high-frequency excluded phase would still
      // push other entries out of the read() ascending window before the
      // limit is applied.
      const excludeSet = new Set(options?.excludePhases ?? [])
      const all = excludeSet.size > 0 ? allRaw.filter((e) => !excludeSet.has(e.phase)) : allRaw
      if (all.length === 0) return ""
      const limit = options?.limit
      // `read()` returns ascending by time_created. Keep the latest slice so
      // recent decisions win when the log outgrows the budget.
      const entries = typeof limit === "number" && all.length > limit ? all.slice(all.length - limit) : all
      const omitted = all.length - entries.length
      // Per-entry value cap. Without this, a single LLM-written architect
      // decision of 20K chars would dominate the prompt even though entry
      // count is bounded. 600 chars ≈ one interface contract paragraph —
      // the full untruncated body is materialized to
      // the task-scoped runtime decision-log projection (DecisionLogBundle) so a shell/worktree
      // agent can read it directly when it needs the complete WHY.
      const valueCap = options?.valueCap ?? DEFAULT_ENTRY_VALUE_CAP
      const lines = entries.map((e) => {
        const value = capEntryValue(e.value, valueCap)
        return `- **${e.key}**: ${value}${e.reason ? ` (${e.reason})` : ""}${e.goalID ? ` [goal:${e.goalID.slice(-8)}]` : ""}`
      })
      const header =
        omitted > 0
          ? `## Decision Log (latest ${entries.length} of ${all.length}; ${omitted} older omitted)`
          : `## Decision Log (${entries.length} entries)`
      return `${header}\n\n${lines.join("\n")}`
    },

    phasePromptSection(phase: string, heading: string, options?: { limit?: number; valueCap?: number }): string {
      return formatPromptSectionEntries(this.readByPhase(phase), heading, options)
    },

    phasePromptSectionForGoal(
      phase: string,
      goalID: string,
      heading: string,
      options?: { limit?: number; valueCap?: number },
    ): string {
      return formatPromptSectionEntries(this.readByPhaseAndGoal(phase, goalID), heading, options)
    },

    toFullDocument(): string {
      const all = this.read()
      if (all.length === 0) return ""
      // Group by phase, preserving first-seen phase order and (since read()
      // is ascending by time_created) time order within each phase.
      const byPhase = new Map<string, DecisionEntry[]>()
      for (const e of all) {
        const bucket = byPhase.get(e.phase)
        if (bucket) bucket.push(e)
        else byPhase.set(e.phase, [e])
      }
      const lines: string[] = [
        "# Decision Log (complete)",
        "",
        "Materialized projection of this task's `decision_log` table. The " +
          "SQLite table is the source of truth; this file is regenerated and " +
          "read-only. Every entry carries WHY, not just WHAT.",
      ]
      for (const [phase, entries] of byPhase) {
        lines.push("", `## Phase: ${phase} (${entries.length})`)
        for (const e of entries) {
          // Reuse the shared per-entry value primitive with NO cap: a
          // contract-IR value still renders readably, but nothing is
          // truncated (Number.POSITIVE_INFINITY ≥ any value length).
          const value = capEntryValue(e.value, Number.POSITIVE_INFINITY)
          lines.push("", `### ${e.key}`, value)
          if (e.reason) lines.push(`_Why: ${e.reason}_`)
          const meta = [new Date(e.timeCreated).toISOString()]
          if (e.goalID) meta.push(`goal:${e.goalID}`)
          lines.push(`<sub>${meta.join(" · ")}</sub>`)
        }
      }
      return lines.join("\n")
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
