/**
 * Group Dispatch — multi-executor goal group claiming, dispatching, and lifecycle management.
 *
 * Orchestrates the dispatch of goal groups to independent executor instances,
 * each with its own session, worktree, and brief.
 */

import type { GoalGroup } from "./goal-grouping"
import type { GoalRow, GoalRunRow, PlanRow, RunRow, TaskRow } from "./store"
import { createGoalRun } from "./persist"
import { Database } from "@/storage/db"
import { compileBrief } from "@/workbench/brief"

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type GroupExecutorState = {
  groupID: string
  goalRunIDs: string[]
  sessionID: string
  worktreeDir: string
  worktreeBranch: string
  executorSessionID?: string
  queueTaskID?: string
}

// ═══════════════════════════════════════════════════════════════════
// Claiming
// ═══════════════════════════════════════════════════════════════════

/**
 * Atomically claim all goals in a group by creating GoalRun rows in a single transaction.
 *
 * Each GoalRun carries the group_id in metadata so the orchestrator can correlate
 * goal runs to their dispatch group.
 *
 * Idempotent: if GoalRun rows already exist for this group + coordinator run,
 * they are returned without creating duplicates (handled by createGoalRun's dedup).
 *
 * @returns Array of created/existing GoalRunRow objects
 */
export function claimGoalGroup(input: {
  taskID: string
  coordinatorRunID: string
  group: GoalGroup
  executor: RunRow["executor"]
  sessionID: string
  worktreeDir: string
}): GoalRunRow[] {
  const goalRuns: GoalRunRow[] = []

  // Atomic: create all goal runs in a single synchronous transaction.
  // If any insert fails, the entire claim is rolled back.
  Database.transaction((db) => {
    for (let i = 0; i < input.group.goalIDs.length; i++) {
      const goalID = input.group.goalIDs[i]
      const nodeID = input.group.goalNodeIDs[i] || undefined
      const goalRun = createGoalRun({
        taskID: input.taskID,
        goalID,
        planNodeID: nodeID,
        coordinatorRunID: input.coordinatorRunID,
        sessionID: input.sessionID,
        executor: input.executor,
        workspaceDir: input.worktreeDir,
        metadata: {
          group_id: input.group.id,
          group_index: i,
        },
      })
      goalRuns.push(goalRun)
    }
  })

  return goalRuns
}

// ═══════════════════════════════════════════════════════════════════
// Per-Group Brief Compilation
// ═══════════════════════════════════════════════════════════════════

function goalCheckSelectors(goal: GoalRow): string[] {
  const meta = goal.metadata as Record<string, unknown> | null | undefined
  if (!meta) return []
  const sel = meta.check_selector
  if (!Array.isArray(sel)) return []
  return sel.filter((s): s is string => typeof s === "string")
}

function goalOwnedPaths(goal: GoalRow): string[] {
  const meta = goal.metadata as Record<string, unknown> | null | undefined
  if (!meta) return []
  const paths = meta.owned_paths
  if (!Array.isArray(paths)) return []
  return paths.filter((p): p is string => typeof p === "string")
}

/**
 * Compile a brief scoped to a single goal group.
 *
 * The brief includes:
 *   - Full task context (title, request, plan summary)
 *   - Only the group's goals as primary directives
 *   - Other groups' goals as read-only context (so executor understands the bigger picture)
 *   - Workspace isolation rules
 *
 * This is intentionally NOT cached (unlike compileBrief) because each group dispatch
 * is a one-time operation.
 */
export function compileGroupBrief(input: {
  taskID: string
  runID: string
  planVersionID: string
  sessionID: string
  group: GoalGroup
  allGoals: GoalRow[]
  plan: PlanRow
  allGroups: GoalGroup[]
  worktreeDir: string
}): { content: string } {
  // Use the standard brief as a base for task context, preferences, memory, etc.
  const baseBrief = compileBrief({
    taskID: input.taskID,
    runID: input.runID,
    planVersionID: input.planVersionID,
    sessionID: input.sessionID,
  })

  // Split base brief: extract everything outside the goals section
  // We'll rebuild the goals section with only this group's goals.
  const groupGoalIDs = new Set(input.group.goalIDs)
  const groupGoals = input.allGoals.filter((g) => groupGoalIDs.has(g.id))
  const otherGroups = input.allGroups.filter((g) => g.id !== input.group.id)

  // Build the group-specific goals section
  const yourGoals = groupGoals.map((goal, i) => {
    const checks = goalCheckSelectors(goal)
    const paths = goalOwnedPaths(goal)
    return [
      `${i + 1}. ${goal.description}`,
      `   Criteria: ${goal.criteria}`,
      paths.length > 0 ? `   Owned paths: ${paths.join(", ")}` : "",
      checks.length > 0 ? `   Checks: ${checks.join(", ")}` : "",
    ].filter(Boolean).join("\n")
  }).join("\n\n")

  // Build other groups' context (read-only)
  const otherGroupsContext = otherGroups.map((g) => {
    const gGoals = input.allGoals.filter((goal) => g.goalIDs.includes(goal.id))
    const lines = gGoals.map((goal) => {
      const paths = goalOwnedPaths(goal)
      return `  - ${goal.description}${paths.length > 0 ? ` → ${paths.join(", ")}` : ""}`
    })
    return `Group ${g.id.slice(-8)}:\n${lines.join("\n")}`
  }).join("\n\n")

  // Rebuild the brief content with group-scoped goals
  const groupSection = [
    "== Your Goals (execute these) ==",
    yourGoals,
    "",
    otherGroupsContext.length > 0
      ? "== Other Groups' Goals (read-only context, do NOT implement) ==\n" + otherGroupsContext
      : "",
    "",
    "== Workspace Rules ==",
    `- You are working in an isolated worktree: ${input.worktreeDir}`,
    "- Only modify files listed in your goals' owned paths.",
    "- Do NOT create git commits. The orchestrator handles merging.",
    "- Focus exclusively on your assigned goals.",
  ].filter(Boolean).join("\n")

  const replaced = baseBrief.content.replace(
    /Goals:\n[\s\S]*?(?=\n\n(?:Global preferences|Session preferences|Recent task notes|Relevant memory|<\/assistant-brief>))/,
    groupSection,
  )

  // If the regex didn't match, append the group section at the end instead of silently using the full brief
  const content = replaced === baseBrief.content
    ? baseBrief.content + "\n\n" + groupSection
    : replaced

  return { content }
}
