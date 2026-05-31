/**
 * TaskContext — single live snapshot of "what the task knows so far".
 *
 * Stage agents (intent-analysis / requirements / frontend-design / architect /
 * integrity / build / delivery) used to start with a static system prompt
 * (`prompt/core/<kind>-core.txt`) that knew nothing about prior phases. The
 * benchmark caught the consequence: each agent's first move was a 14-48s
 * memory.search loop using task-title keywords as queries against an empty
 * temp home — pure waste, because the data the agent actually needed was
 * sitting in `engine_task` columns and the decision-log all along.
 *
 * This module pulls that data into a single markdown block injected at the
 * tail of every stage agent's system prompt by `agent/runner.ts`. One source
 * of truth (rule 22): the same DB rows the orchestrator already writes.
 */
import { Database, eq } from "@/storage/db"
import { EngineTaskTable, EngineGoalTable } from "@/engine/engine.sql"
import { goalStatusByID } from "@/engine/describe"
import { Log } from "@/util/log"
import { createDecisionLog } from "@/decision-log"
import { renderUserRequestSection } from "@/intent/request-prompt"

const log = Log.create({ service: "task-context" })

const RECENT_DECISION_LIMIT = 20
const VALUE_CAP_BYTES = 400

export namespace TaskContext {
  /**
   * Build a markdown block summarising the live state of `taskID`. Returns
   * an empty string when the task is unknown — the caller (runner) is
   * expected to inject the result unconditionally; an empty string is a no-op.
   */
  export function snapshot(taskID: string): string {
    if (!taskID) return ""

    const task = Database.use((db) =>
      db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
    )
    if (!task) {
      log.warn("snapshot: task not found", { taskID })
      return ""
    }

    const goals = Database.use((db) =>
      db
        .select()
        .from(EngineGoalTable)
        .where(eq(EngineGoalTable.task_id, taskID))
        .orderBy(EngineGoalTable.order_index)
        .all(),
    )

    const decisionLog = createDecisionLog(taskID)
    const recentDecisions = decisionLog
      .read()
      .slice(-RECENT_DECISION_LIMIT)

    const sections: string[] = []

    sections.push("## Live Task Context")
    sections.push("")
    sections.push(`**Title**: ${task.title}`)
    if (task.request) {
      sections.push(renderUserRequestSection({ heading: "### Request", request: String(task.request), taskID }))
    }

    const designSpecs = Array.isArray(task.design_specs) ? task.design_specs : []
    if (designSpecs.length > 0) {
      const byCategory = designSpecs.reduce<Record<string, number>>((acc, spec) => {
        const cat = (spec as { category?: string }).category ?? "other"
        acc[cat] = (acc[cat] ?? 0) + 1
        return acc
      }, {})
      const summary = Object.entries(byCategory)
        .map(([cat, n]) => `${cat}=${n}`)
        .join(", ")
      sections.push(`**Design specs**: ${designSpecs.length} total (${summary})`)
    }

    const attachments = Array.isArray(task.attachments) ? task.attachments : []
    if (attachments.length > 0) {
      sections.push(`**Attachments**: ${attachments.length}`)
    }

    if (goals.length > 0) {
      sections.push("")
      sections.push(`### Goals (${goals.length})`)
      for (const goal of goals) {
        const accept = Array.isArray(goal.acceptance_specs)
          ? goal.acceptance_specs.length
          : 0
        const objective = String(goal.objective ?? "").slice(0, 200)
        const status = goalStatusByID(goal.id)
        sections.push(
          `- **${goal.id}** [${status}] ${goal.title} — ${objective}` +
            (accept > 0 ? ` (${accept} acceptance specs)` : ""),
        )
      }
    }

    if (recentDecisions.length > 0) {
      sections.push("")
      sections.push(`### Decision Log (latest ${recentDecisions.length})`)
      for (const entry of recentDecisions) {
        const value = entry.value.slice(0, VALUE_CAP_BYTES)
        const goalSuffix = entry.goalID ? ` @${entry.goalID}` : ""
        sections.push(`- *${entry.phase}*${goalSuffix} **${entry.key}**: ${value}`)
      }
    }

    return sections.join("\n")
  }
}
