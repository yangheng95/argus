/**
 * Task Agent tools — AI SDK tool() definitions wrapping existing services.
 *
 * Created per-task via createTaskAgentTools({ taskID }).
 * The taskID is captured in the closure — no global registry needed.
 */
import { tool } from "ai"
import z from "zod"
import { Session } from "@/session"
import { Database, eq, and } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { createInactivityGuard } from "@/util/inactivity-guard"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { Publisher } from "@/orchestrator/publisher"
import { OrchestratorGit } from "@/orchestrator/git"
import { OrchestratorMemoryBridge } from "@/orchestrator/memory-bridge"
import { sessionStreamHooks } from "@/orchestrator/session-stream"
import { withStageRetry } from "@/orchestrator/strategy"
import { Event as OrchestratorEvent } from "@/orchestrator/model"
import { OrchestratorConfig } from "@/orchestrator/config"
import { OrchestratorProtocol } from "@/orchestrator/protocol"
import {
  OrchestratorTaskTable,
} from "@/orchestrator/orchestrator.sql"
import {
  markDeliveryPublishing,
  finalizeDeliveryResult,
} from "@/orchestrator/persist"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
  findRuns,
  listGoals,
  requireRun,
  requireTask,
} from "@/orchestrator/store"
import { DEFAULT_MAX_RUNS, DEFAULT_MAX_FIX_RUNS } from "@/orchestrator/helpers"
import type { OrchestratorBudget } from "@/orchestrator/orchestrator.sql"
import { updateTask } from "@/orchestrator/state"

import { findStepByTool, type WorkflowState, type MiniWorkflow } from "@/orchestrator/workflow"

const log = Log.create({ service: "task-tools" })

// ---------------------------------------------------------------------------
// Helpers (from pipeline.ts)
// ---------------------------------------------------------------------------

/** Build a GoalContract from DB rows for use by per-goal tools. */
function buildGoalContract(task: any, goal: any, allGoals: any[]): import("@/pipeline/types").GoalContract {
  return {
    goal: {
      id: goal.id,
      title: goal.title,
      objective: goal.objective,
      done_definition: goal.done_definition,
      owned_paths: goal.owned_paths ?? [],
      depends_on: goal.depends_on ?? [],
      exports: goal.exports ?? [],
      imports: goal.imports ?? [],
      priority: goal.priority ?? "blocking",
      kind: goal.kind ?? "feature",
      requirement_ids: goal.requirement_ids ?? [],
    },
    planNode: null,
    run: { id: task.active_run_id ?? "", task_id: task.id } as any,
    task,
    plan: { id: task.active_plan_version_id ?? "" } as any,
    allGoals: allGoals.map(g => ({
      id: g.id, title: g.title, objective: g.objective, done_definition: g.done_definition,
      owned_paths: g.owned_paths ?? [], depends_on: g.depends_on ?? [],
      exports: g.exports ?? [], imports: g.imports ?? [],
      priority: g.priority ?? "blocking", kind: g.kind ?? "feature",
      requirement_ids: g.requirement_ids ?? [],
    })),
  }
}

function stageTimeout(stage: "requirements" | "goal" | "plan"): number {
  const env = { requirements: "OPENCORVUS_REQUIREMENTS_TIMEOUT_MS", goal: "OPENCORVUS_GOAL_TIMEOUT_MS", plan: "OPENCORVUS_PLAN_TIMEOUT_MS" }
  const defaults = { requirements: 300_000, goal: 180_000, plan: 300_000 }
  return parseInt(process.env[env[stage]] || String(defaults[stage]), 10)
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createTaskAgentTools(input: {
  taskID: string
  agentSessionID: string
  signal?: AbortSignal
  workflow?: import("@/orchestrator/workflow").MiniWorkflow
  workflowState?: import("@/orchestrator/workflow").WorkflowState
}) {
  const { taskID } = input

  // Blocking tools (submit_execution, execute_goal, dispatch_ready_goals) signal
  // this controller on success. The agent loop is then forcefully terminated so
  // the model can't spin-wait with read_context calls. The agent gets re-triggered
  // when execution completes.
  const stopAfterDispatch = new AbortController()

  // ── Workflow step tracking (passive observation) ──

  async function trackStepStart(toolName: string, goalID?: string): Promise<void> {
    if (!input.workflow || !input.workflowState) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    const now = Date.now()
    const ws = input.workflowState

    if (step.scope === "task") {
      ws.taskSteps[step.id] = { status: "running", startedAt: now }
    } else if (goalID && ws.goalSteps[goalID]) {
      ws.goalSteps[goalID].steps[step.id] = { status: "running", startedAt: now }
    }
    ws.currentStepID = step.id

    // Persist + emit
    try {
      const task = requireTask(taskID)
      const meta = { ...(task.metadata ?? {}), _workflow: ws }
      await updateTask(task, { metadata: meta }, `Workflow step started: ${step.label}`)
      OrchestratorProtocol.emit(OrchestratorEvent.WorkflowStepUpdated, {
        taskID, stepID: step.id, goalID, status: "running",
        summary: `Step "${step.label}" started`,
      })
    } catch { /* best effort */ }
  }

  async function trackStepComplete(toolName: string, goalID?: string, failed = false): Promise<void> {
    if (!input.workflow || !input.workflowState) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    const now = Date.now()
    const ws = input.workflowState
    const status = failed ? "failed" as const : "completed" as const

    if (step.scope === "task") {
      const existing = ws.taskSteps[step.id]
      ws.taskSteps[step.id] = { ...existing, status, completedAt: now }
    } else if (goalID && ws.goalSteps[goalID]) {
      const existing = ws.goalSteps[goalID].steps[step.id]
      ws.goalSteps[goalID].steps[step.id] = { ...existing, status, completedAt: now }
    }

    // Advance currentStepID to next pending step
    const nextStep = input.workflow.steps.find(s => {
      if (s.scope === "task") return ws.taskSteps[s.id]?.status === "pending"
      return false // goal-scope steps don't drive currentStepID
    })
    ws.currentStepID = nextStep?.id ?? null

    try {
      const task = requireTask(taskID)
      const meta = { ...(task.metadata ?? {}), _workflow: ws }
      await updateTask(task, { metadata: meta }, `Workflow step ${status}: ${step.label}`)
      OrchestratorProtocol.emit(OrchestratorEvent.WorkflowStepUpdated, {
        taskID, stepID: step.id, goalID, status,
        summary: `Step "${step.label}" ${status}`,
      })

      // Emit per-goal progress when a goal-scope step completes
      if (goalID && step.scope === "goal" && ws.goalSteps[goalID]) {
        const goalSteps = ws.goalSteps[goalID].steps
        const totalSteps = Object.keys(goalSteps).length
        const completedSteps = Object.values(goalSteps).filter(s => s.status === "completed" || s.status === "skipped").length
        const currentStep = Object.entries(goalSteps).find(([, s]) => s.status === "running")?.[0]
        OrchestratorProtocol.emit(OrchestratorEvent.GoalWorkflowProgress, {
          taskID,
          goalID,
          completedSteps,
          totalSteps,
          currentStep,
          summary: `Goal ${goalID}: ${completedSteps}/${totalSteps} steps done`,
        })
      }
    } catch { /* best effort */ }
  }

  /** Ensure a goal has initialized step states in workflow tracking */
  function ensureGoalInWorkflow(goalID: string, goalTitle: string): void {
    if (!input.workflow || !input.workflowState) return
    const ws = input.workflowState
    if (ws.goalSteps[goalID]) return
    const steps: Record<string, { status: "pending" }> = {}
    for (const s of input.workflow.steps) {
      if (s.scope === "goal") steps[s.id] = { status: "pending" }
    }
    ws.goalSteps[goalID] = { goalID, goalTitle, goalStatus: "pending", steps }
  }

  const tools = {
    requirements: tool({
      description: "Explore the codebase, analyze the task, extract requirements, and decompose into executable goal contracts with cross-goal interface declarations.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to analyze requirements"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        const existingGoals = listGoals(taskID)
        log.info("requirements guard check", { taskID, existingGoals: existingGoals.length, hasSpec: !!task.active_spec_version_id })
        if (existingGoals.length > 0) return `${existingGoals.length} goals already defined. Skipping. Proceed to architect (for multi-goal) or create_run + submit_execution.`
        if (task.active_spec_version_id) return `Requirements analysis already completed (spec=${task.active_spec_version_id}). Proceed to architect or create_run + submit_execution.`

        await trackStepStart("requirements")
        task = await updateTask(task, { status: "active" }, "Requirements analysis started")
        const stallController = new AbortController()
        const guard = createInactivityGuard(stageTimeout("goal"), () => {
          log.warn("decompose stage inactivity timeout", { taskID })
          stallController.abort(new Error("decompose stall timeout"))
        })
        try {
          const decomposeSession = await Session.createNext({
            parentID: input.agentSessionID,
            title: `Decompose: ${task.title}`,
            directory: Instance.directory,
          })
          registerGoalRunSession(decomposeSession.id, taskID, "goal")
          const hooks = sessionStreamHooks({ sessionID: decomposeSession.id, taskID, stage: "goal" })


          const { RequirementsService } = await import("@/requirements")
          const DecomposeService = RequirementsService
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)

          const result = await withStageRetry("goal", () =>
            DecomposeService.decompose({
              title: task.title,
              request: task.request,
              attachments: Array.isArray(task.attachments) ? task.attachments as any : undefined,
              taskID,
              sessionID: decomposeSession.id,
              signal: input.signal
                ? AbortSignal.any([input.signal, stallController.signal])
                : stallController.signal,
              decisionLog,
              stream: {
                onChunk: async (arg: any) => {
                  guard.bump()
                  const chunk = (arg as any)?.chunk
                  // Re-emit text-delta as reasoning-delta so it renders in a collapsible
                  // thinking block, visually separated from tool calls.
                  if (chunk?.type === "text-delta") {
                    if (hooks.onChunk) await hooks.onChunk({ chunk: { ...chunk, type: "reasoning-delta" } })
                  } else {
                    if (hooks.onChunk) await hooks.onChunk(arg)
                  }
                },
                onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg) },
              },
              onStatus: () => {},
            }),
            { signal: input.signal },
          )
          guard.clear()
          await hooks.flush()


          // Persist spec snapshot, requirements, and goals
          const { insertGoalRows, insertRequirements } = await import("@/orchestrator/persist")
          const { OrchestratorSpecSnapshotTable } = await import("@/orchestrator/orchestrator.sql")
          const now = Date.now()
          const specSnapshotID = Identifier.ascending("spec")

          // Build spec content from decompose output
          const specContent = [
            `# ${task.title}`,
            "",
            result.summary,
            "",
            "## Requirements",
            ...result.requirements.map(r => `- **${r.id}** [${r.type}]: ${r.description}`),
            "",
            "## Decisions",
            ...result.decisions.map(d => `- **${d.key}** = ${d.value} — ${d.reason}`),
            "",
            "## Traceability",
            ...result.traceability.map(t => `- ${t.requirementID} → ${t.goalIDs.join(", ")}`),
          ].join("\n")

          // Pre-generate DB IDs and build LLM-ID → DB-ID mapping so
          // depends_on references resolve to actual DB goal IDs.
          // The Requirements agent assigns internal IDs (e.g. "setup-db")
          // in register_goal tool calls; depends_on references those IDs.
          const llmToDBID = new Map<string, string>()
          const dbGoalIDs = result.goals.map((goal) => {
            const dbID = Identifier.ascending("goal")
            if (goal.id) llmToDBID.set(goal.id, dbID)
            return dbID
          })

          try { Database.transaction((db) => {
            // Spec snapshot — makes SPEC section visible in panel
            db.insert(OrchestratorSpecSnapshotTable).values({
              id: specSnapshotID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: result.summary,
              content: specContent,
              scope: result.requirements.map(r => r.description).join("; "),
              time_created: now,
              time_updated: now,
            }).run()

            // Persist requirements for traceability
            if (result.requirements.length > 0) {
              insertRequirements(db, {
                taskID,
                specSnapshotID,
                requirements: result.requirements.map(r => ({
                  id: r.id,
                  title: r.description,
                  description: r.description,
                  acceptance: [] as string[],
                  evidence_refs: [] as string[],
                  priority: r.type === "explicit" ? "blocking" as const : "advisory" as const,
                })),
                now,
              })
            }

            insertGoalRows(db, {
              taskID,
              specSnapshotID,
              goals: result.goals.map((goal, index) => ({
                goalID: dbGoalIDs[index],
                title: goal.title,
                objective: goal.objective,
                done_definition: goal.done_definition,
                owned_paths: goal.owned_paths,
                depends_on: goal.depends_on.flatMap(dep => {
                  const dbID = llmToDBID.get(dep)
                  if (!dbID) log.warn("requirements: depends_on references unknown LLM goal ID — dropping", { goalTitle: goal.title, unknownDep: dep })
                  return dbID ? [dbID] : []
                }),
                exports: goal.exports,
                imports: goal.imports,
                kind: goal.kind,
                requirement_ids: goal.requirement_ids,
                priority: goal.priority,
                source: goal.requirement_ids.length > 0 ? "spec" as const : "system" as const,
              })),
              now,
            })
            db.update(OrchestratorTaskTable)
              .set({ active_spec_version_id: specSnapshotID, time_updated: now })
              .where(eq(OrchestratorTaskTable.id, taskID))
              .run()
            Database.effect(() =>
              OrchestratorProtocol.emit(OrchestratorEvent.TaskUpdated, { taskID, status: task.status, summary: "Goals defined" }, { source: "task-agent.decompose" }),
            )
          }) } catch (dbErr) {
            log.error("requirements: failed to persist goals to DB", { taskID, error: dbErr instanceof Error ? dbErr.message : String(dbErr), stack: dbErr instanceof Error ? dbErr.stack : undefined })
            throw dbErr
          }
          // Initialize workflow tracking for newly created goals (use DB IDs)
          for (const [i, g] of result.goals.entries()) {
            ensureGoalInWorkflow(dbGoalIDs[i], g.title)
          }
          await trackStepComplete("requirements")
          const nextStep = result.goals.length > 1
            ? "NEXT: call architect to coordinate cross-goal contracts, then create_run + submit_execution."
            : "NEXT: call create_run then submit_execution to start goal execution."
          return `SUCCESS: ${result.goals.length} goals created. ${nextStep}\n\nSummary: ${result.summary}.\nDecisions: ${result.decisions.map(d => `${d.key}=${d.value}`).join(", ")}`
        } finally {
          guard.clear()
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Cross-goal coordination — Architect Agent
    // -----------------------------------------------------------------------

    architect: tool({
      description: "Coordinate cross-goal contracts. Call after decompose when multiple goals have exports/imports dependencies. Writes precise interface contracts, directory blueprints, and shared type definitions to the Decision Log so parallel goals don't conflict. Skip for single-goal or trivial tasks. Always coordinates ALL goals — goal selection is automatic.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run architect"),
      }),
      execute: async () => {
        const allGoals = listGoals(taskID)
        if (allGoals.length === 0) return "No goals to coordinate. Run requirements first."
        if (allGoals.length === 1) return "Single goal — architect coordination not needed."

        await trackStepStart("architect")

        const targetGoals = allGoals

        const task = requireTask(taskID)

        // Register architect session so its messages appear in the overlay architect card
        const architectSession = await Session.createNext({
          parentID: input.agentSessionID,
          title: `Architect: ${task.title}`,
          directory: Instance.directory,
        })
        registerGoalRunSession(architectSession.id, taskID, "architect")
        const hooks = sessionStreamHooks({ sessionID: architectSession.id, taskID, stage: "architect" })


        const { createDecisionLog } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)

        const { ArchitectAgent } = await import("@/architect/agent")

        const result = await ArchitectAgent.coordinate({
          goals: targetGoals.map(g => ({
            id: g.id,
            title: g.title,
            objective: g.objective,
            done_definition: g.done_definition,
            owned_paths: typeof g.owned_paths === "string" ? JSON.parse(g.owned_paths) : (g.owned_paths ?? []),
            depends_on: typeof g.depends_on === "string" ? JSON.parse(g.depends_on) : (g.depends_on ?? []),
            exports: typeof g.exports === "string" ? JSON.parse(g.exports) : (g.exports ?? []),
            imports: typeof g.imports === "string" ? JSON.parse(g.imports) : (g.imports ?? []),
            priority: g.priority as "blocking" | "advisory",
            kind: g.kind,
            requirement_ids: typeof g.requirement_ids === "string" ? JSON.parse(g.requirement_ids) : (g.requirement_ids ?? []),
          })),
          taskRequest: task.request,
          taskTitle: task.title,
          taskID,
          decisionLog,
          signal: input.signal,
          stream: {
            onChunk: async (arg: any) => {
              const chunk = (arg as any)?.chunk
              if (chunk?.type === "text-delta") {
                if (hooks.onChunk) await hooks.onChunk({ chunk: { ...chunk, type: "reasoning-delta" } })
              } else {
                if (hooks.onChunk) await hooks.onChunk(arg)
              }
            },
            onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg) },
          },
          onStatus: () => {},
        })

        await hooks.flush()


        const summary = [
          `Architect coordination complete: ${result.entriesWritten} contracts written to Decision Log.`,
          result.blueprint.summary,
          result.blueprint.contracts.length > 0
            ? `Categories: ${[...new Set(result.blueprint.contracts.map(c => c.category))].join(", ")}`
            : "",
          result.recommendedNext.length > 0
            ? `Recommended next: ${result.recommendedNext.map(r => `${r.agent}(${r.priority})`).join(", ")}`
            : "",
        ].filter(Boolean).join("\n")

        await trackStepComplete("architect")
        return summary
      },
    }),

    // -----------------------------------------------------------------------
    // Per-goal tools — Task Agent decides when to call each
    // -----------------------------------------------------------------------


    add_goal: tool({
      description: "Dynamically add a new goal to the task. Use when you discover missing requirements, infrastructure needs, or integration gaps during execution.",
      inputSchema: z.object({
        title: z.string().describe("Short goal title"),
        objective: z.string().describe("What this goal accomplishes"),
        done_definition: z.string().describe("Verifiable pass/fail criteria"),
        owned_paths: z.array(z.string()).default([]).describe("Files this goal owns exclusively"),
        depends_on: z.array(z.string()).default([]).describe("Goal IDs this depends on"),
        priority: z.enum(["blocking", "advisory"]).default("blocking"),
        kind: z.string().default("feature").describe("bootstrap, feature, verification, integration, system"),
        reason: z.string().describe("Why you decided to add this goal"),
      }),
      execute: async ({ title, objective, done_definition, owned_paths, depends_on, priority, kind }) => {
        const task = requireTask(taskID)
        const { insertGoalRows } = await import("@/orchestrator/persist")
        const now = Date.now()
        const specSnapshotID = task.active_spec_version_id ?? Identifier.ascending("spec")
        const goals = Database.use((db) => insertGoalRows(db, {
          taskID,
          specSnapshotID,
          goals: [{
            goalID: Identifier.ascending("goal"),
            title,
            objective,
            done_definition,
            owned_paths,
            depends_on,
            exports: [],
            imports: [],
            kind,
            requirement_ids: [],
            priority,
            source: "system" as const,
          }],
          now,
        }))
        return `Goal added: ${goals[0].id} — "${title}"`
      },
    }),

    modify_goal: tool({
      description: "Modify an existing goal's contract. Use when eval feedback suggests done_definition needs refinement, or owned_paths need adjustment.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to modify"),
        updates: z.object({
          title: z.string().optional(),
          objective: z.string().optional(),
          done_definition: z.string().optional(),
          owned_paths: z.array(z.string()).optional(),
        }).describe("Fields to update"),
        reason: z.string().describe("Why you decided to modify this goal"),
      }),
      execute: async ({ goalID, updates }) => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`

        const setValues: Record<string, unknown> = { time_updated: Date.now() }
        if (updates.title) setValues.title = updates.title
        if (updates.objective) setValues.objective = updates.objective
        if (updates.done_definition) setValues.done_definition = updates.done_definition
        if (updates.owned_paths) setValues.owned_paths = updates.owned_paths

        const { OrchestratorGoalTable } = await import("@/orchestrator/orchestrator.sql")
        Database.use((db) =>
          db.update(OrchestratorGoalTable)
            .set(setValues as any)
            .where(eq(OrchestratorGoalTable.id, goalID))
            .run(),
        )
        return `Goal ${goalID} modified: ${Object.keys(updates).filter(k => (updates as any)[k]).join(", ")}`
      },
    }),

    execute_goal: tool({
      description: "Execute a pending or failed goal in an isolated git worktree. Creates worktree, submits to executor, returns asynchronously. Only valid for goals in pending or failed status — passed goals are terminal (use modify_goal to change the contract and reset to pending). You will be re-triggered when execution completes. STOP after calling this.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to execute (must be pending or failed status)"),
        reason: z.string().optional().describe("Why you decided to execute this goal now"),
      }),
      execute: async ({ goalID }) => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`
        if (goal.status === "running") return `Goal ${goalID} is already running.`
        if (goal.status === "passed") {
          return `Goal ${goalID} is already passed (terminal success state). ` +
                 `To change its contract (done_definition, owned_paths), use modify_goal(${goalID}, ...) which will reset to pending automatically. ` +
                 `execute_goal does not re-run passed goals.`
        }

        // goal.status === "pending" | "failed" — reset failed to pending so infrastructure picks it up
        if (goal.status === "failed") {
          Database.use((db) => {
            const { OrchestratorGoalTable: GT } = require("@/orchestrator/orchestrator.sql")
            db.update(GT)
              .set({ status: "pending", time_updated: Date.now() })
              .where(eq(GT.id, goalID))
              .run()
          })
        }

        ensureGoalInWorkflow(goalID, goal.title)
        await trackStepStart("execute_goal", goalID)

        // Ensure run exists
        let runID = task.active_run_id
        if (!runID) {
          const { OrchestratorRunTable } = await import("@/orchestrator/orchestrator.sql")
          runID = Identifier.ascending("run")
          const now = Date.now()
          Database.use((db) => {
            db.insert(OrchestratorRunTable).values({
              id: runID!,
              task_id: taskID,
              plan_version_id: task.active_plan_version_id ?? null,
              session_id: task.session_id ?? null,
              executor: "opencode",
              status: "running",
              phase: "execute",
              retry_count: 0,
              metadata: {},
              time_created: now,
              time_updated: now,
            }).run()
            db.update(OrchestratorTaskTable)
              .set({ active_run_id: runID, time_updated: now })
              .where(eq(OrchestratorTaskTable.id, taskID))
              .run()
          })
        }

        // Signal task loop to dispatch via GoalPool (goal is now "pending", pool will pick it up)
        stopAfterDispatch.abort("execute_goal")
        return `Goal "${goal.title}" (${goalID}) queued for execution. STOP HERE — task loop will dispatch via GoalPool and re-trigger you when it completes.`
      },
    }),

    query_failed_goals: tool({
      description: "Query all currently failed goals with their delivery info. Returns structured data for each failed goal: title, owned_paths, done_definition, latest delivery summary. Use this BEFORE calling retry_failed_goals to understand per-goal failure reasons.",
      inputSchema: z.object({}),
      execute: async () => {
        const dbGoals = listGoals(taskID)
        const failed = dbGoals.filter(g => g.status === "failed")
        if (failed.length === 0) return "No failed goals."
        const { listGoalRunsByTask, findDeliveryByGoalRun } = await import("@/orchestrator/store")
        const goalRuns = listGoalRunsByTask(taskID)
        const sections: string[] = [`## Failed Goals (${failed.length})`]
        for (const goal of failed) {
          sections.push(`\n### ${goal.id}: ${goal.title}`)
          sections.push(`- done_definition: ${goal.done_definition.slice(0, 300)}`)
          if (goal.owned_paths?.length) sections.push(`- owned_paths: ${goal.owned_paths.join(", ")}`)
          // Show latest delivery info for this goal
          const grs = goalRuns.filter(gr => gr.goal_id === goal.id)
          const latestGr = grs[0]
          if (latestGr) {
            const delivery = findDeliveryByGoalRun(latestGr.id)
            if (delivery) {
              sections.push(`- delivery summary: ${delivery.summary}`)
              const diffs = (delivery.result as any)?.diffs as Array<{ file: string }> | undefined
              if (diffs?.length) sections.push(`- delivery files: ${diffs.map(f => f.file).join(", ")}`)
            } else {
              sections.push(`- delivery: none (executor produced no output)`)
            }
            sections.push(`- goal_run status: ${latestGr.status}`)
          } else {
            sections.push(`- no goal_run found`)
          }
        }
        return sections.join("\n")
      },
    }),

    retry_failed_goals: tool({
      description: "Retry ALL currently failed goals in parallel. Each goal is reset to pending. You MUST first call query_failed_goals to understand each failure, then articulate per-goal root cause analysis in this tool's input. Schema enforces you demonstrate understanding before retry — reflexive retry without analysis is impossible. STOP after calling this.",
      inputSchema: z.object({
        reason: z.string().min(20).describe("Overall reason for batch retry (min 20 chars, e.g. 'eval caught integration bugs, retrying with fresh context + failure evidence appended')"),
        per_goal_analysis: z.record(
          z.string(),
          z.object({
            root_cause: z.string().min(30).describe("What went wrong in this specific goal (min 30 chars). Cite specific eval evidence."),
            failure_class: z.enum([
              "code_bug",
              "test_failure",
              "missing_dependency",
              "wrong_approach",
              "cross_goal_integration",
              "flaky_environment",
            ]).describe("Category of failure"),
            expected_fix: z.string().min(20).describe("What should retry do differently (min 20 chars)"),
          }),
        ).describe("Per-goal analysis keyed by goalID. MUST include an entry for each currently-failed goal."),
      }),
      execute: async ({ reason, per_goal_analysis }) => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Nothing to retry."

        const run = requireRun(task.active_run_id)

        const dbGoals = listGoals(taskID)
        const failed = dbGoals.filter(g => g.status === "failed")
        if (failed.length === 0) return "No failed goals to retry."

        // Enforce: per_goal_analysis MUST cover every failed goal
        const analyzedIDs = new Set(Object.keys(per_goal_analysis))
        const missing = failed.filter(g => !analyzedIDs.has(g.id)).map(g => g.id)
        if (missing.length > 0) {
          return `Missing per_goal_analysis for failed goal(s): ${missing.join(", ")}. Call query_failed_goals first, then provide analysis for EVERY failed goal before retry. Retry rejected.`
        }

        // ── Per-goal retry budget ──
        // Each goal has its own retry_count. Goals that exceeded max_goal_retries
        // are permanently failed and excluded from retry.
        const orchCfg = await OrchestratorConfig.get()
        const maxGoalRetries = orchCfg.max_goal_retries

        // ── Repeated root cause detection ──
        // If the same failure_class for a goal has been recorded 2+ times in
        // Decision Log, a 3rd retry with the same class will not help. Force
        // the Task Agent to change strategy instead of looping.
        {
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)
          const retryEntries = decisionLog.readByPhase("retry")
          const repeatedGoals: string[] = []

          for (const [goalID, analysis] of Object.entries(per_goal_analysis)) {
            const priorSameClass = retryEntries.filter(e =>
              e.goalID === goalID &&
              typeof e.value === "string" &&
              e.value.startsWith(`[${analysis.failure_class}]`)
            )
            if (priorSameClass.length >= 2) {
              repeatedGoals.push(`"${goalID}" — failure_class="${analysis.failure_class}" repeated ${priorSameClass.length + 1} times`)
            }
          }

          if (repeatedGoals.length > 0) {
            return [
              `ESCALATION REQUIRED: ${repeatedGoals.length} goal(s) have the same failure class repeating 3+ times:`,
              ...repeatedGoals.map(s => `  - ${s}`),
              "",
              "Retry with the same approach will not fix these. Choose a different strategy:",
              "  - modify_goal to change done_definition or owned_paths",
              "  - add_goal to create a prerequisite",
              "  - fail_task if the issue is fundamental",
              "  - retry_failed_goals with a DIFFERENT failure_class + expected_fix (prove you changed approach)",
            ].join("\n")
          }
        }

        const retryable: typeof failed = []
        const exhausted: typeof failed = []

        for (const goal of failed) {
          const goalRetries = (goal as any).retry_count ?? 0
          if (goalRetries >= maxGoalRetries) {
            exhausted.push(goal)
          } else {
            retryable.push(goal)
          }
        }

        // ── Cascade: mark pending goals whose deps are all permanently failed ──
        const permanentlyFailedIDs = new Set(exhausted.map(g => g.id))
        const cascaded: typeof failed = []
        let changed = true
        while (changed) {
          changed = false
          for (const goal of dbGoals) {
            if (goal.status !== "pending") continue
            if (permanentlyFailedIDs.has(goal.id)) continue
            const deps = goal.depends_on ?? []
            if (deps.length === 0) continue
            const allDepsFailed = deps.every(depID => {
              const dep = dbGoals.find(g => g.id === depID)
              if (!dep) return true // missing dep treated as failed
              return permanentlyFailedIDs.has(depID) || (dep.status === "failed" && ((dep as any).retry_count ?? 0) >= maxGoalRetries)
            })
            if (allDepsFailed) {
              permanentlyFailedIDs.add(goal.id)
              cascaded.push(goal)
              changed = true
            }
          }
        }

        // Apply DB changes
        Database.use((db) => {
          const { OrchestratorGoalTable: GT, OrchestratorRunTable: RT } = require("@/orchestrator/orchestrator.sql")
          const now = Date.now()

          // Reset retryable goals to pending + increment their per-goal retry_count
          for (const goal of retryable) {
            const goalRetries = (goal as any).retry_count ?? 0
            db.update(GT)
              .set({ status: "pending", retry_count: goalRetries + 1, time_updated: now })
              .where(eq(GT.id, goal.id))
              .run()
          }

          // Mark cascaded pending goals as failed (blocked by permanently failed deps)
          for (const goal of cascaded) {
            db.update(GT)
              .set({ status: "failed", time_updated: now })
              .where(eq(GT.id, goal.id))
              .run()
          }

          // Increment run-level retry_count for global budget tracking
          db.update(RT)
            .set({ retry_count: (run.retry_count ?? 0) + 1, time_updated: now })
            .where(eq(RT.id, run.id))
            .run()
        })

        // Record analysis in decision log for future retry context
        try {
          const { createDecisionLog } = await import("@/decision-log")
          const log = createDecisionLog(taskID)
          for (const [goalID, analysis] of Object.entries(per_goal_analysis)) {
            log.append({
              goalID,
              phase: "retry",
              key: `retry_analysis_${goalID}`,
              value: `[${analysis.failure_class}] ${analysis.expected_fix}`,
              reason: analysis.root_cause,
            })
          }
        } catch { /* best effort */ }

        for (const goal of retryable) {
          ensureGoalInWorkflow(goal.id, goal.title)
          await trackStepStart("retry_failed_goals", goal.id)
        }

        // Build response
        const lines: string[] = []

        if (retryable.length > 0) {
          stopAfterDispatch.abort("retry_failed_goals")
          lines.push(`Retrying ${retryable.length} goal(s):`)
          for (const g of retryable) {
            const a = per_goal_analysis[g.id]
            const retries = ((g as any).retry_count ?? 0) + 1
            lines.push(`  - ${g.title} [${a?.failure_class}] (retry ${retries}/${maxGoalRetries}): ${a?.expected_fix.slice(0, 80)}`)
          }
        }

        if (exhausted.length > 0) {
          lines.push(`\nPermanently failed (${exhausted.length} goal(s) exhausted ${maxGoalRetries} retries):`)
          for (const g of exhausted) {
            lines.push(`  - ${g.title} (${(g as any).retry_count ?? 0}/${maxGoalRetries} retries used)`)
          }
        }

        if (cascaded.length > 0) {
          lines.push(`\nCascade-failed (${cascaded.length} pending goal(s) blocked by permanently failed deps):`)
          for (const g of cascaded) {
            lines.push(`  - ${g.title}`)
          }
        }

        if (retryable.length === 0) {
          lines.push(`\nNo goals left to retry. Consider delivering current state or calling fail_task.`)
          return lines.join("\n")
        }

        lines.push(`\nReason: ${reason}`)
        lines.push("STOP HERE — task loop dispatches via GoalPool and re-triggers you when batch completes.")
        return lines.join("\n")
      },
    }),

    dispatch_ready_goals: tool({
      description: "Compute dependency DAG and dispatch ALL ready goals (no unmet dependencies) in parallel. Each goal gets its own worktree. You will be re-triggered when the batch completes. STOP after calling this.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to dispatch goals now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Use create_plan or execute_goal first."
        const run = requireRun(task.active_run_id)
        const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
        if (!plan) return "No plan found. Use create_plan first."

        // Check how many goals are ready (without dispatching — task loop handles dispatch via GoalPool)
        const { readyGoalNodes } = await import("@/goal/scheduler")
        const { listPlanNodesByPlan, listGoalsByPlan } = await import("@/orchestrator/store")
        const nodes = listPlanNodesByPlan(plan.id)
        const goals = listGoalsByPlan(plan.id)
        const ready = readyGoalNodes(nodes, goals)

        if (ready.length === 0) {
          const allGoals = listGoals(taskID)
          const pending = allGoals.filter(g => g.status === "pending").length
          const running = allGoals.filter(g => g.status === "running").length
          return `No goals ready to dispatch. Pending: ${pending}, Running: ${running}. Check dependencies with read_context.`
        }

        // Signal task loop to dispatch via GoalPool (don't dispatch here — let the pool handle it)
        stopAfterDispatch.abort("dispatch_ready_goals")
        return `${ready.length} goal(s) ready for dispatch. STOP HERE — task loop will dispatch via GoalPool and re-trigger you when the batch completes.`
      },
    }),

    read_context: tool({
      description: "Read current task context: goal states, delivery verdicts, Decision Log, delivery summaries. Use this to gather information before making decisions.",
      inputSchema: z.object({
        scope: z.enum(["goals", "evaluations", "decisions", "deliveries", "all"]).default("all").describe("What to read"),
      }),
      execute: async ({ scope }) => {
        const task = requireTask(taskID)
        const sections: string[] = []

        if (scope === "goals" || scope === "all") {
          const goals = listGoals(taskID)
          sections.push(`## Goals (${goals.length})`)
          for (const g of goals) {
            sections.push(`- [${g.status}] ${g.id}: ${g.title} [${g.priority}]`)
            sections.push(`  objective: ${g.objective.slice(0, 200)}`)
            sections.push(`  done_definition: ${g.done_definition.slice(0, 200)}`)
            if (g.owned_paths?.length) sections.push(`  owned_paths: ${g.owned_paths.join(", ")}`)
            if (g.depends_on?.length) sections.push(`  depends_on: ${g.depends_on.join(", ")}`)
          }
        }

        if (scope === "evaluations" || scope === "all") {
          const { findEvaluationsByTask } = await import("@/orchestrator/store")
          const evals = findEvaluationsByTask(taskID)
          if (evals.length > 0) {
            sections.push(`\n## Evaluations (${evals.length})`)
            for (const e of evals) {
              sections.push(`- [${e.verdict}] ${e.summary}`)
              const checks = e.checks as Array<{ name: string; status: string; evidence?: string }> | undefined
              if (checks) {
                for (const c of checks.slice(0, 5)) {
                  sections.push(`  - ${c.name}: ${c.status}${c.evidence ? ` — ${c.evidence}` : ""}`)
                }
              }
            }
          }
        }

        if (scope === "decisions" || scope === "all") {
          const { createDecisionLog } = await import("@/decision-log")
          const log = createDecisionLog(taskID)
          const section = log.toPromptSection()
          if (section) sections.push(`\n${section}`)
        }

        if (scope === "deliveries" || scope === "all") {
          const { listGoalRunsByTask, findDeliveryByGoalRun } = await import("@/orchestrator/store")
          const goalRuns = listGoalRunsByTask(taskID)
          const deliveries = goalRuns
            .map(gr => ({ goalRunID: gr.id, goalID: gr.goal_id, status: gr.status, delivery: findDeliveryByGoalRun(gr.id) }))
            .filter(d => d.delivery)
          if (deliveries.length > 0) {
            sections.push(`\n## Deliveries (${deliveries.length})`)
            for (const d of deliveries) {
              const diffs = (d.delivery!.result as any)?.diffs as Array<{ file: string }> | undefined
              sections.push(`- goal_run ${d.goalRunID} [${d.status}]: ${d.delivery!.summary}`)
              if (diffs?.length) sections.push(`  files: ${diffs.map(f => f.file).join(", ")}`)
            }
          }
        }

        return sections.length > 0 ? sections.join("\n") : "No context available yet."
      },
    }),

    create_run: tool({
      description: "Create a run record for goal execution. Returns the runID needed for submit_execution or dispatch_ready_goals. Use after requirements + architect.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to create a run"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        if (dbGoals.length === 0) return "No goals found. Run requirements first."

        // Budget enforcement: max_runs
        const totalRuns = findRuns(taskID).length
        const maxRuns = (task.budget as OrchestratorBudget | null)?.max_runs ?? DEFAULT_MAX_RUNS
        if (totalRuns >= maxRuns) {
          return `Budget exhausted: ${totalRuns}/${maxRuns} runs used. Cannot create more runs. Consider delivering current state or failing the task.`
        }

        const runID = Identifier.ascending("run")
        const now = Date.now()
        const executor = (task.metadata?._pipeline as any)?.executor ?? "opencode"
        const sessionID = task.session_id!

        // Create a lightweight plan version (goals as plan nodes, no global planner)
        const planID = Identifier.ascending("plan")
        const { OrchestratorPlanVersionTable, OrchestratorRunTable, OrchestratorPlanNodeTable } = await import("@/orchestrator/orchestrator.sql")

        Database.transaction((db) => {
          // Plan version (minimal — goals ARE the plan)
          db.insert(OrchestratorPlanVersionTable).values({
            id: planID, task_id: taskID, spec_snapshot_id: task.active_spec_version_id ?? null,
            version: 1, status: "active",
            summary: `${dbGoals.length} goals`,
            prompt: task.request,
            metadata: {},
            time_created: now, time_updated: now,
          }).run()

          // Pre-generate plan_node IDs and build goal_id → plan_node_id mapping
          // so depends_on_ids references plan_node IDs (not goal IDs).
          const goalToPlanNode = new Map<string, string>()
          const planNodeIDs: string[] = []
          for (const goal of dbGoals) {
            const pnID = Identifier.ascending("plan_node")
            planNodeIDs.push(pnID)
            goalToPlanNode.set(goal.id, pnID)
          }

          // Each goal becomes a plan node (so scheduler can compute DAG)
          for (const [index, goal] of dbGoals.entries()) {
            const resolvedDeps = (goal.depends_on ?? []).flatMap((depGoalID: string) => {
              const pnID = goalToPlanNode.get(depGoalID)
              if (!pnID) log.warn("create_run: goal.depends_on references unknown goal ID — dropping", { goalID: goal.id, goalTitle: goal.title, unknownDep: depGoalID })
              return pnID ? [pnID] : []
            })

            db.insert(OrchestratorPlanNodeTable).values({
              id: planNodeIDs[index],
              task_id: taskID,
              plan_version_id: planID,
              kind: "goal",
              goal_id: goal.id,
              title: goal.title,
              brief: goal.done_definition,
              depends_on_ids: resolvedDeps.length > 0 ? resolvedDeps : undefined,
              order_index: index,
              metadata: {},
              time_created: now, time_updated: now,
            }).run()
          }

          // Run record
          db.insert(OrchestratorRunTable).values({
            id: runID, task_id: taskID, plan_version_id: planID,
            session_id: sessionID, executor,
            status: "queued", phase: "dispatch", retry_count: 0,
            metadata: {}, time_created: now, time_updated: now,
          }).run()

          // Link goals to this plan so listGoalsByPlan() finds them during dispatch
          const { OrchestratorGoalTable: GT } = require("@/orchestrator/orchestrator.sql")
          for (const goal of dbGoals) {
            db.update(GT)
              .set({ plan_version_id: planID, time_updated: now })
              .where(eq(GT.id, goal.id))
              .run()
          }

          // Update task
          db.update(OrchestratorTaskTable)
            .set({ active_plan_version_id: planID, active_run_id: runID, status: "active", time_updated: now })
            .where(eq(OrchestratorTaskTable.id, taskID))
            .run()
        })

        return `Run created. runID=${runID}, planID=${planID}, ${dbGoals.length} goals as plan nodes. Call dispatch_ready_goals or submit_execution to start execution.`
      },
    }),

    submit_execution: tool({
      description: "Activate a run and dispatch all dependency-ready goals in parallel. Equivalent to activating the run then calling dispatch_ready_goals. STOP after this call.",
      inputSchema: z.object({
        runID: z.string().describe("The run ID from create_plan output"),
      }),
      execute: async ({ runID }) => {
        const task = requireTask(taskID)
        const run = requireRun(runID)

        // Activate the run
        Database.use((db) => {
          const { OrchestratorRunTable } = require("@/orchestrator/orchestrator.sql")
          db.update(OrchestratorRunTable).set({ status: "running", time_started: Date.now(), time_updated: Date.now() }).where(eq(OrchestratorRunTable.id, runID)).run()
          const { OrchestratorTaskTable: TT } = require("@/orchestrator/orchestrator.sql")
          db.update(TT).set({ status: "active", time_updated: Date.now() }).where(eq(TT.id, taskID)).run()
        })

        // Signal task loop to dispatch via GoalPool (don't dispatch here)
        stopAfterDispatch.abort("submit_execution")
        return `Run ${runID} activated. STOP HERE — task loop will dispatch goals via GoalPool and re-trigger you when the batch completes.`
      },
    }),

    fail_task: tool({
      description: "Mark the task as failed. Use when the task cannot be completed.",
      inputSchema: z.object({
        error: z.string().describe("Why the task failed"),
      }),
      execute: async ({ error }) => {
        const task = requireTask(taskID)
        await updateTask(task, { status: "failed", error, time_completed: Date.now() }, `Failed: ${error}`)
        return `Task ${taskID} failed: ${error}`
      },
    }),

    restart_from_stage: tool({
      description: "Restart the task from a specific stage. Use when the current approach is fundamentally wrong, the user requests a restart, or you need to redo requirements/plan from scratch.",
      inputSchema: z.object({
        stage: z.enum(["requirements", "plan", "executor"]).describe("Which stage to restart from"),
        reason: z.string().describe("Why restarting from this stage"),
      }),
      execute: async ({ stage, reason }) => {
        const task = requireTask(taskID)
        // All restarts go to "active" — the agent decides what to do next
        await updateTask(task, { status: "active", error: null, blocking_reason: null }, `Restart from ${stage}: ${reason}`)
        return `Task restarted from ${stage} stage. Reason: ${reason}. Continue with the appropriate tool (requirements for requirements, create_plan for plan, submit_execution for executor).`
      },
    }),

    deliver: tool({
      description: "Aggregate all goal deliveries, then run the DeliveryAgent to verify build/test/startup, fix issues, and make final acceptance decision before publication. Delivery agent is the single verification gate. Check goal statuses via read_context before calling.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to deliver now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Execute goals first."

        await trackStepStart("deliver")
        const run = requireRun(task.active_run_id)

        const goals = listGoals(taskID)

        // Hard lock: refuse delivery while any goals are still running/pending
        const notDone = goals.filter(g => g.status === "running" || g.status === "pending")
        if (notDone.length > 0) {
          return `Cannot deliver: ${notDone.length} goal(s) still in progress (${notDone.map(g => `${g.title}:${g.status}`).join(", ")}). Wait for ALL goals to complete before delivering.`
        }

        const blockingFailed = goals.filter(g => g.priority === "blocking" && g.status === "failed")
        if (blockingFailed.length > 0) {
          const summary = blockingFailed.map(g => `[${g.status}] ${g.title}`).join("; ")
          return `Cannot deliver: ${blockingFailed.length} blocking goal(s) failed. Fix them first: ${summary}`
        }

        // Aggregate per-goal deliveries
        const { listGoalRunsByCoordinator, findDeliveryByGoalRun } = await import("@/orchestrator/store")
        const goalRuns = listGoalRunsByCoordinator(run.id)
        const allDiffs: Array<{ file: string; diff?: string; [key: string]: unknown }> = []
        const seenFiles = new Set<string>()
        const summaries: string[] = []
        for (const gr of goalRuns) {
          const d = findDeliveryByGoalRun(gr.id)
          if (!d) continue
          if (d.summary) summaries.push(d.summary)
          const result = d.result as { diffs?: Array<{ file: string; diff?: string; [key: string]: unknown }> } | null
          if (!result?.diffs) continue
          for (const diff of result.diffs) {
            if (!seenFiles.has(diff.file)) {
              seenFiles.add(diff.file)
              allDiffs.push(diff)
            }
          }
        }

        // Persist aggregated delivery
        const { persistDelivery } = await import("@/orchestrator/persist")
        const deliveryID = Identifier.ascending("delivery")
        persistDelivery({
          task: task as any,
          run: run as any,
          deliveryID,
          delivery: {
            summary: summaries.length > 0 ? summaries.join("\n") : "Aggregated delivery",
            diffs: allDiffs,
          },
          now: Date.now(),
        })

        // Run DeliveryAgent to verify build/test/startup
        const allGoals = listGoals(taskID)
        const goalInfos = allGoals.map(g => ({
          description: g.objective,
          criteria: g.done_definition,
          priority: g.priority as "blocking" | "advisory",
        }))
        const deliveryInfo = {
          summary: summaries.join("\n"),
          changedFiles: allDiffs.map(d => d.file),
          diffs: allDiffs.map(d => ({ file: d.file, diff: d.diff })),
        }

        const deliverySession = await Session.createNext({
          parentID: input.agentSessionID,
          title: `Delivery verification: ${task.title}`,
          directory: Instance.directory,
        })
        registerGoalRunSession(deliverySession.id, taskID, "delivery")
        const hooks = sessionStreamHooks({ sessionID: deliverySession.id, taskID, stage: "delivery" })


        try {
          const { DeliveryService } = await import("@/delivery/service")
          const verdict = await DeliveryService.verify({
            task: { title: task.title, request: task.request, sessionID: task.session_id ?? undefined, metadata: task.metadata ?? undefined },
            goals: goalInfos,
            delivery: deliveryInfo,
            signal: input.signal,
            stream: {
              onChunk: async (arg: any) => {
                const chunk = (arg as any)?.chunk
                if (chunk?.type === "text-delta") {
                  if (hooks.onChunk) await hooks.onChunk({ chunk: { ...chunk, type: "reasoning-delta" } })
                } else {
                  if (hooks.onChunk) await hooks.onChunk(arg)
                }
              },
              onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg) },
            },
          })
          await hooks.flush()


          // Persist verdict as artifact
          const { OrchestratorArtifactTable } = await import("@/orchestrator/orchestrator.sql")
          const verdictArtifactId = Identifier.ascending("artifact")
          Database.use((db) =>
            db.insert(OrchestratorArtifactTable).values({
              id: verdictArtifactId,
              task_id: taskID,
              run_id: run.id,
              delivery_id: deliveryID,
              kind: "verdict",
              label: "delivery-agent-verdict",
              payload: verdict,
              time_created: Date.now(),
              time_updated: Date.now(),
            }).run()
          )

          const passedCount = goals.filter(g => g.status === "passed").length
          const failedCount = goals.filter(g => g.status === "failed").length
          if (verdict.verdict === "accepted") {
            await trackStepComplete("deliver")
            log.info("deliver: verdict accepted, auto-publishing", { taskID, runID: run.id, deliveryID })
            // Auto-publish: verification passed → immediately complete task.
            // No second LLM turn needed — avoids infinite loop where LLM ends turn
            // without calling publish_delivery.
            try {
              const delivery = findDeliveryByRun(run.id)
              if (!delivery) return `Delivery verified and ACCEPTED but no delivery record found.`
              const verdictArtifact = Database.use((db) =>
                db.select().from(OrchestratorArtifactTable)
                  .where(eq(OrchestratorArtifactTable.id, verdictArtifactId))
                  .get()
              )
              markDeliveryPublishing(delivery.id, Date.now())
              const PUBLISH_TIMEOUT_MS = 60_000
              const currentTask = requireTask(taskID)
              const publishResult = await Promise.race([
                Publisher.deliver({ task: currentTask, run, delivery }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Publisher.deliver() timeout")), PUBLISH_TIMEOUT_MS)),
              ])
              const completed = Date.now()
              finalizeDeliveryResult({ deliveryId: delivery.id, taskId: taskID, runId: run.id, delivery, result: publishResult, now: completed })
              if (publishResult.status === "delivered") {
                const current = requireTask(taskID)
                const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
                const published = findDeliveryByRun(run.id) ?? delivery
                const verdictPayload = verdictArtifact?.payload as { verdict?: string; summary?: string; issues_found?: string[] } | null
                if (verdictPayload?.verdict && !findEvaluationByRun(run.id)) {
                  const { OrchestratorEvaluationTable } = await import("@/orchestrator/orchestrator.sql")
                  Database.use((db) =>
                    db.insert(OrchestratorEvaluationTable).values({
                      id: Identifier.ascending("evaluation"),
                      task_id: taskID,
                      run_id: run.id,
                      delivery_id: delivery.id,
                      status: verdictPayload.verdict === "accepted" ? "passed" : "failed",
                      verdict: verdictPayload.verdict as any,
                      summary: verdictPayload.summary ?? "Delivery agent verification",
                      checks: (verdictPayload.issues_found ?? []).map((issue: string) => ({
                        name: "delivery-agent",
                        status: "failed" as const,
                        evidence: issue,
                      })),
                      time_completed: completed,
                      time_created: completed,
                      time_updated: completed,
                    }).run(),
                  )
                }
                const finalized = await OrchestratorGit.complete(current, currentPlan, published)
                if (finalized.error) {
                  await updateTask(current, { status: "failed", blocking_reason: null, error: finalized.error, time_completed: completed }, finalized.error)
                  return `Git finalization failed: ${finalized.error}`
                }
                // Ensure task is in "active" before completing (recovery may have reset to "queued")
                const preComplete = requireTask(taskID)
                if (preComplete.status === "queued") {
                  await updateTask(preComplete, { status: "active" }, "Activating for completion")
                }
                const readyTask = requireTask(taskID)
                await updateTask(readyTask, { status: "completed", blocking_reason: null, error: null, time_completed: completed }, "Task completed")
                const { Plugin } = await import("@/plugin")
                await Plugin.trigger("delivery.ready", { taskID, runID: run.id, deliveryID: delivery.id }, { actions: [] }).catch(() => undefined)
                OrchestratorMemoryBridge.flushTaskLearnings({ task: currentTask, run, delivery, evaluation: findEvaluationByRun(run.id), plan: currentPlan })
                  .catch(err => log.warn("failed to flush task learnings", { error: String(err) }))
                return `Delivery published and task completed successfully.`
              }
              await updateTask(currentTask, { status: "failed", blocking_reason: null, error: publishResult.summary, time_completed: completed }, publishResult.summary)
              return `Publish returned non-delivered status: ${publishResult.summary}`
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              log.error("deliver: auto-publish failed", { taskID, error: msg, stack: err instanceof Error ? err.stack : undefined })
              return `Delivery verified and ACCEPTED but publish failed: ${msg}. Call publish_delivery to retry.`
            }
          }
          const issues = verdict.issues_found.join("; ")
          await trackStepComplete("deliver", undefined, true)
          // "rejected" means the delivery agent exhausted its own retries and determined
          // the code does not work end-to-end. This is a task failure — the executor needs
          // to re-run. We set the task to "failed" here rather than returning a message
          // for the LLM to interpret, because:
          //   1. The LLM has no mechanism to fix the code from here (goals are "passed").
          //   2. Returning a message causes the outer task-loop to re-trigger, which calls
          //      deliver again on the exact same diffs → infinite loop.
          const failMsg = `Delivery rejected: ${verdict.summary}. Issues: ${issues}`
          const currentTaskR = requireTask(taskID)
          if (currentTaskR.status === "active") {
            await updateTask(currentTaskR, { status: "failed", error: failMsg, time_completed: Date.now() }, failMsg)
          }
          stopAfterDispatch.abort("deliver_rejected")
          return failMsg
        } catch (err) {
          await trackStepComplete("deliver", undefined, true)

          const msg = err instanceof Error ? err.message : String(err)
          log.error("deliver: verification failed", { taskID, error: msg })
          // Delivery verification threw — treat as task failure for the same reasons as
          // "rejected": the delivery agent could not verify the deliverable, and returning
          // a message would cause the outer loop to re-trigger deliver on the same diffs.
          const failMsg = `Delivery verification failed: ${msg}`
          const currentTaskE = requireTask(taskID)
          if (currentTaskE.status === "active") {
            await updateTask(currentTaskE, { status: "failed", error: failMsg, time_completed: Date.now() }, failMsg)
          }
          stopAfterDispatch.abort("deliver_rejected")
          return failMsg
        }
      },
    }),

    publish_delivery: tool({
      description: "Publish the accepted delivery to git and mark the task as completed. Only call after delivery verification has passed.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Confirmation that both verifications passed"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const run = task.active_run_id ? requireRun(task.active_run_id) : undefined
        if (!run) return "No active run."

        // Gate: no blocking goals in "failed" state
        const goals = listGoals(taskID)
        const blockingFailed = goals.filter(g => g.priority === "blocking" && g.status === "failed")
        if (blockingFailed.length > 0) {
          return `Cannot publish: ${blockingFailed.length} blocking goal(s) failed. Fix them first.`
        }

        const delivery = findDeliveryByRun(run.id)
        if (!delivery) return "No delivery found."

        // Require delivery to exist before publishing
        const { OrchestratorArtifactTable } = await import("@/orchestrator/orchestrator.sql")
        const verdictArtifact = Database.use((db) =>
          db.select().from(OrchestratorArtifactTable)
            .where(and(eq(OrchestratorArtifactTable.run_id, run.id), eq(OrchestratorArtifactTable.label, "delivery-agent-verdict")))
            .limit(1).get()
        )
        if (!verdictArtifact) return "Delivery not verified. Run deliver first to aggregate and verify goal deliveries."

        markDeliveryPublishing(delivery.id, Date.now())

        const PUBLISH_TIMEOUT_MS = 60_000
        let result: Awaited<ReturnType<typeof Publisher.deliver>>
        try {
          result = await Promise.race([
            Publisher.deliver({ task, run, delivery }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Publisher.deliver() timeout")), PUBLISH_TIMEOUT_MS)),
          ])
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("publish_delivery failed", { taskID: task.id, runID: run.id, error: msg })
          return `Publish failed: ${msg}. Decide whether to retry or fail the task.`
        }

        const completed = Date.now()
        finalizeDeliveryResult({ deliveryId: delivery.id, taskId: task.id, runId: run.id, delivery, result, now: completed })

        if (result.status === "delivered") {
          const current = requireTask(task.id)
          const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
          const published = findDeliveryByRun(run.id) ?? delivery

          // Create evaluation record from delivery-agent-verdict so board/quality-gate can read it
          const verdictPayload = verdictArtifact.payload as { verdict?: string; summary?: string; issues_found?: string[] } | null
          if (verdictPayload?.verdict && !findEvaluationByRun(run.id)) {
            const { OrchestratorEvaluationTable } = await import("@/orchestrator/orchestrator.sql")
            Database.use((db) =>
              db.insert(OrchestratorEvaluationTable).values({
                id: Identifier.ascending("evaluation"),
                task_id: task.id,
                run_id: run.id,
                delivery_id: delivery.id,
                status: verdictPayload.verdict === "accepted" ? "passed" : "failed",
                verdict: verdictPayload.verdict as any,
                summary: verdictPayload.summary ?? "Delivery agent verification",
                checks: (verdictPayload.issues_found ?? []).map((issue: string) => ({
                  name: "delivery-agent",
                  status: "failed" as const,
                  evidence: issue,
                })),
                time_completed: completed,
                time_created: completed,
                time_updated: completed,
              }).run(),
            )
          }

          const finalized = await OrchestratorGit.complete(current, currentPlan, published)
          if (finalized.error) {
            await updateTask(current, { status: "failed", blocking_reason: null, error: finalized.error, time_completed: completed }, finalized.error)
            return `Git finalization failed: ${finalized.error}`
          }
          await updateTask(finalized.task, { status: "completed", blocking_reason: null, error: null, time_completed: completed }, "Task completed")
          const { Plugin } = await import("@/plugin")
          await Plugin.trigger("delivery.ready", { taskID: task.id, runID: run.id, deliveryID: delivery.id }, { actions: [] }).catch(() => undefined)
          // Flush task learnings to memory (fire-and-forget)
          const evaluation = findEvaluationByRun(run.id)
          OrchestratorMemoryBridge.flushTaskLearnings({ task, run, delivery, evaluation, plan: currentPlan })
            .catch(err => log.warn("failed to flush task learnings", { error: String(err) }))

          // Auto-launch the deliverable if the delivery agent recorded a launch command
          const launchCmd = (verdictPayload as any)?.launch_command as string | undefined
          if (launchCmd) {
            try {
              const { Shell } = await import("@/shell/shell")
              const { Filesystem } = await import("@/util/filesystem")
              const projectDir = Filesystem.resolve(Instance.directory)
              const launched = await Shell.launch(launchCmd, { cwd: projectDir })
              const addrNote = launched.address ? ` — running at ${launched.address}` : ` (PID ${launched.pid})`
              log.info("deliverable launched", { pid: launched.pid, address: launched.address, command: launchCmd })
              return `Delivery published and task completed successfully. Deliverable launched${addrNote}.`
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              log.warn("auto-launch failed after publish", { error: msg, command: launchCmd })
              return `Delivery published and task completed successfully. Auto-launch failed: ${msg}. Launch manually with: ${launchCmd}`
            }
          }

          return `Delivery published and task completed successfully.`
        }

        await updateTask(task, { status: "failed", blocking_reason: null, error: result.summary, time_completed: completed }, result.summary)
        return `Publish returned non-delivered status: ${result.summary}`
      },
    }),
  }

  return { tools, stopSignal: stopAfterDispatch.signal }
}
