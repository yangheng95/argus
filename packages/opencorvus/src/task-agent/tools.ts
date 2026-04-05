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
import { agentStream } from "@/orchestrator/agent-stream"
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
  listGoals,
  requireRun,
  requireTask,
} from "@/orchestrator/store"
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
        if (existingGoals.length > 0) return `${existingGoals.length} goals already defined. Skipping.`
        if (task.active_spec_version_id) return `Requirements analysis already completed (spec=${task.active_spec_version_id}). Use read_context to see goals.`

        await trackStepStart("requirements")
        task = await updateTask(task, { status: "active" }, "Requirements analysis started")
        const stallController = new AbortController()
        const guard = createInactivityGuard(stageTimeout("goal"), () => {
          log.warn("decompose stage inactivity timeout", { taskID })
          stallController.abort(new Error("decompose stall timeout"))
        })
        try {
          const decomposeLive = agentStream({ taskID, stage: "goal" })
          const decomposeSession = await Session.createNext({
            parentID: input.agentSessionID,
            title: `Decompose: ${task.title}`,
            directory: Instance.directory,
          })
          registerGoalRunSession(decomposeSession.id, taskID, "goal")
          const hooks = sessionStreamHooks({ sessionID: decomposeSession.id, taskID, stage: "goal" })
          await decomposeLive.start("Decomposition started")

          const { RequirementsService } = await import("@/requirements")
          const DecomposeService = RequirementsService
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)

          const result = await withStageRetry("goal", () =>
            DecomposeService.decompose({
              title: task.title,
              request: task.request,
              taskID,
              sessionID: decomposeSession.id,
              signal: input.signal
                ? AbortSignal.any([input.signal, stallController.signal])
                : stallController.signal,
              decisionLog,
              stream: {
                onChunk: async (arg: any) => {
                  guard.bump()
                  // sessionStreamHooks: persists full tool content to session (input/output/status)
                  if (hooks.onChunk) await hooks.onChunk(arg)
                  // agentStream: only forward non-tool events for section status indicator.
                  // Tool-call events are already persisted by sessionStreamHooks with full content;
                  // forwarding them to agentStream would create duplicate empty status bubbles in the panel.
                  const chunk = (arg as any)?.chunk
                  if (chunk?.type !== "tool-input-start" && chunk?.type !== "tool-call" && chunk?.type !== "tool-result" && chunk?.type !== "tool-input-delta") {
                    if (decomposeLive.hooks.onChunk) await decomposeLive.hooks.onChunk(arg)
                  }
                },
                onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg); if (decomposeLive.hooks.onError) await decomposeLive.hooks.onError(arg) },
              },
              onStatus: decomposeLive.statusHook.bind(decomposeLive),
            }),
            { signal: input.signal },
          )
          guard.clear()
          await hooks.flush()
          await decomposeLive.finish("Decomposition finished")

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

          Database.transaction((db) => {
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
                goalID: Identifier.ascending("goal"),
                title: goal.title,
                objective: goal.objective,
                done_definition: goal.done_definition,
                owned_paths: goal.owned_paths,
                depends_on: goal.depends_on,
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
          })
          // Initialize workflow tracking for newly created goals
          for (const g of result.goals) {
            ensureGoalInWorkflow(g.id, g.title)
          }
          await trackStepComplete("requirements")
          return `${result.goals.length} goals created. Summary: ${result.summary}. Decisions: ${result.decisions.map(d => `${d.key}=${d.value}`).join(", ")}`
        } finally {
          guard.clear()
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Cross-goal coordination — Architect Agent
    // -----------------------------------------------------------------------

    architect: tool({
      description: "Coordinate cross-goal contracts. Call after decompose when multiple goals have exports/imports dependencies. Writes precise interface contracts, directory blueprints, and shared type definitions to the Decision Log so parallel goals don't conflict. Skip for single-goal or trivial tasks.",
      inputSchema: z.object({
        goalIDs: z.array(z.string()).optional().describe("Goal IDs to coordinate (default: all goals)"),
        reason: z.string().optional().describe("Why you decided to run architect"),
      }),
      execute: async ({ goalIDs }) => {
        const allGoals = listGoals(taskID)
        if (allGoals.length === 0) return "No goals to coordinate. Run requirements first."
        if (allGoals.length === 1) return "Single goal — architect coordination not needed."

        await trackStepStart("architect")

        const targetGoals = goalIDs?.length
          ? allGoals.filter(g => goalIDs.includes(g.id))
          : allGoals

        const task = requireTask(taskID)

        // Register architect session so its messages appear in the overlay architect card
        const architectSession = await Session.createNext({
          parentID: input.agentSessionID,
          title: `Architect: ${task.title}`,
          directory: Instance.directory,
        })
        registerGoalRunSession(architectSession.id, taskID, "architect")
        const hooks = sessionStreamHooks({ sessionID: architectSession.id, taskID, stage: "architect" })
        const architectLive = agentStream({ taskID, stage: "architect" })
        await architectLive.start("Architect coordination started")

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
              if (hooks.onChunk) await hooks.onChunk(arg)
              const chunk = (arg as any)?.chunk
              if (chunk?.type !== "tool-input-start" && chunk?.type !== "tool-call" && chunk?.type !== "tool-result" && chunk?.type !== "tool-input-delta") {
                if (architectLive.hooks.onChunk) await architectLive.hooks.onChunk(arg)
              }
            },
            onError: async (arg: any) => {
              if (hooks.onError) await hooks.onError(arg)
              if (architectLive.hooks.onError) await architectLive.hooks.onError(arg)
            },
          },
          onStatus: architectLive.statusHook.bind(architectLive),
        })

        await hooks.flush()
        await architectLive.finish("Architect coordination finished")

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

    plan_goal: tool({
      description: "Create an implementation plan for a specific goal. The plan gives the executor detailed steps. Can be skipped for simple goals if the goal contract is already clear enough.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to plan"),
        reason: z.string().optional().describe("Why you decided to plan this goal"),
      }),
      execute: async ({ goalID }) => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`

        ensureGoalInWorkflow(goalID, goal.title)
        await trackStepStart("plan_goal", goalID)

        const { planGoal } = await import("@/planner/per-goal")
        const { createDecisionLog } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)

        // Create child session for planner agent messages
        const planSession = await Session.createNext({
          parentID: input.agentSessionID,
          title: `Plan: ${goal.title}`,
          directory: Instance.directory,
        })
        registerGoalRunSession(planSession.id, taskID, "planner", goalID)
        const hooks = sessionStreamHooks({ sessionID: planSession.id, taskID, stage: "plan" })

        const contract = buildGoalContract(task, goal, dbGoals)
        try {
          const steps = await planGoal({
            contract,
            decisionLog,
            sessionID: planSession.id,
            signal: input.signal,
            stream: {
              onChunk: hooks.onChunk as any,
              onError: hooks.onError,
            },
          })
          await trackStepComplete("plan_goal", goalID)
          return `Plan created for "${goal.title}": ${steps.brief.slice(0, 500)}`
        } finally {
          await hooks.flush()
        }
      },
    }),

    eval_goal: tool({
      description: "Manually re-evaluate a goal's delivery. Evaluation runs automatically after execution — use this only to re-evaluate after a fix (execute_goal retry). Max 3 evals per goal.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to evaluate"),
        reason: z.string().optional().describe("Why you decided to evaluate this goal"),
      }),
      execute: async ({ goalID }) => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`

        // Check eval attempt count to prevent infinite eval loops
        const MAX_EVAL_PER_GOAL = 3
        const { OrchestratorEvaluationTable } = await import("@/orchestrator/orchestrator.sql")
        const existingEvals = Database.use((db) =>
          db.select().from(OrchestratorEvaluationTable)
            .where(and(eq(OrchestratorEvaluationTable.task_id, taskID), eq(OrchestratorEvaluationTable.goal_run_id, goalID)))
            .all(),
        )
        // Count evals for this goal across all goal_runs
        const { listGoalRunsByTask: listGR } = await import("@/orchestrator/store")
        const goalRunIDs = new Set(listGR(taskID).filter(gr => gr.goal_id === goalID).map(gr => gr.id))
        const evalCount = Database.use((db) =>
          db.select().from(OrchestratorEvaluationTable)
            .where(eq(OrchestratorEvaluationTable.task_id, taskID))
            .all(),
        ).filter(e => e.goal_run_id && goalRunIDs.has(e.goal_run_id)).length
        if (evalCount >= MAX_EVAL_PER_GOAL) {
          return `EVAL LIMIT REACHED: Goal "${goal.title}" has been evaluated ${evalCount} times (max ${MAX_EVAL_PER_GOAL}). You MUST either fix the underlying code and re-execute, or fail_task if unrecoverable.`
        }

        ensureGoalInWorkflow(goalID, goal.title)
        await trackStepStart("eval_goal", goalID)

        const { evaluateGoal } = await import("@/evaluator/per-goal")
        const { createDecisionLog } = await import("@/decision-log")
        const { findDeliveryByGoalRun, listGoalRunsByTask } = await import("@/orchestrator/store")
        const decisionLog = createDecisionLog(taskID)

        // Find latest goal_run for this goal
        const allGoalRuns = listGoalRunsByTask(taskID)
        const goalRuns = allGoalRuns.filter(gr => gr.goal_id === goalID)
        const latestRun = goalRuns.find(gr => gr.status === "completed") ?? goalRuns[0]
        if (!latestRun) return `No goal_run found for goal ${goalID}.`
        const delivery = findDeliveryByGoalRun(latestRun.id)
        if (!delivery) return `No delivery found for goal ${goalID}.`
        const diffs = Array.isArray((delivery.result as any)?.diffs) ? (delivery.result as any).diffs : []

        // Create child session for evaluator agent messages
        const evalSession = await Session.createNext({
          parentID: input.agentSessionID,
          title: `Eval: ${goal.title}`,
          directory: Instance.directory,
        })
        registerGoalRunSession(evalSession.id, taskID, "evaluator", goalID)
        const hooks = sessionStreamHooks({ sessionID: evalSession.id, taskID, stage: "eval" })

        const contract = buildGoalContract(task, goal, dbGoals)
        let verdict: Awaited<ReturnType<typeof evaluateGoal>>
        try {
          verdict = await evaluateGoal({
            contract,
            delivery: { summary: delivery.summary, diffs },
            decisionLog,
            sessionID: evalSession.id,
            signal: input.signal,
            stream: {
              onChunk: hooks.onChunk as any,
              onError: hooks.onError,
            },
          })
        } finally {
          await hooks.flush()
        }

        // Persist evaluation to DB
        const evalID = Identifier.ascending("evaluation")
        const now = Date.now()
        Database.use((db) => {
          db.insert(OrchestratorEvaluationTable).values({
            id: evalID,
            task_id: taskID,
            run_id: latestRun.coordinator_run_id,
            goal_run_id: latestRun.id,
            delivery_id: delivery.id,
            status: verdict.pass ? "passed" : "failed",
            verdict: verdict.pass ? "accepted" : "rejected",
            summary: verdict.reasoning.slice(0, 500),
            checks: [
              // Inspection panel expected checks: judge, artifact, spec_check
              {
                name: "judge",
                status: verdict.pass ? "passed" : "failed",
                evidence: verdict.reasoning.slice(0, 500),
              },
              {
                name: "artifact",
                status: verdict.pass ? "passed" : "failed",
                evidence: `Delivery: ${diffs.length} file(s) changed`,
              },
              {
                name: "spec_check",
                status: verdict.pass ? "passed" : "failed",
                evidence: verdict.evidence[0] || "done_definition check",
              },
              // Per-evidence detail items
              ...verdict.evidence.map((e, i) => ({
                name: `evidence_${i + 1}`,
                status: verdict.evidenceStatus?.[i] ?? (verdict.pass ? "passed" : "failed"),
                evidence: e,
              })),
            ],
            time_created: now,
            time_updated: now,
          }).run()

          // Task Agent decision: update goal.status based on eval verdict.
          // Per architecture spec, goal.status writer is Task Agent — this IS the agent's decision.
          const goalStatus = verdict.pass ? "passed" : "failed"
          const { OrchestratorGoalTable: GT } = require("@/orchestrator/orchestrator.sql")
          db.update(GT)
            .set({ status: goalStatus, time_updated: now })
            .where(eq(GT.id, goalID))
            .run()
        })

        // Emit event for overlay reactivity
        const { Event: OrcEvent } = await import("@/orchestrator/model")
        const { OrchestratorProtocol: Proto } = await import("@/orchestrator/protocol")
        if (verdict.pass) {
          Proto.emit(OrcEvent.GoalPassed, { taskID, goalID: goal.id, summary: goal.title }, { source: "eval_goal" }).catch(() => {})
        } else {
          Proto.emit(OrcEvent.GoalFailed, { taskID, goalID: goal.id, summary: `${goal.title}: ${verdict.reasoning.slice(0, 200)}` }, { source: "eval_goal" }).catch(() => {})
        }

        await trackStepComplete("eval_goal", goalID, !verdict.pass)
        const evidenceStr = verdict.evidence.slice(0, 5).join("; ")
        return verdict.pass
          ? `PASS: ${goal.title}. Evidence: ${evidenceStr}`
          : `FAIL (${verdict.failureClass ?? "unknown"}): ${goal.title}. Reasoning: ${verdict.reasoning.slice(0, 300)}. Evidence: ${evidenceStr}`
      },
    }),

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
      description: "Execute a pending or failed goal in an isolated git worktree. Creates worktree, submits to executor, returns asynchronously. Only valid for goals in pending or failed status — passed goals are terminal and cannot be re-executed (use eval_goal to re-validate or modify_goal to change the contract). You will be re-triggered when execution completes. STOP after calling this.",
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
                 `To re-validate it without changes, use eval_goal(${goalID}). ` +
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

    retry_failed_goals: tool({
      description: "Retry ALL currently failed goals in parallel. Each goal is reset to pending with its failure evidence auto-appended to the executor prompt. Use this when you want to re-execute all failed goals with no special treatment (infrastructure handles evidence enrichment). For a single specific goal or modified contract, use execute_goal or modify_goal. STOP after calling this.",
      inputSchema: z.object({
        reason: z.string().describe("Why you decided to retry all failed goals now (e.g. 'fixing after delivery feedback', 'after architect contract update')"),
      }),
      execute: async ({ reason }) => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Nothing to retry."
        const dbGoals = listGoals(taskID)
        const failed = dbGoals.filter(g => g.status === "failed")
        if (failed.length === 0) return "No failed goals to retry."

        // Reset all failed goals to pending. GoalPool picks them up and auto-appends eval evidence.
        Database.use((db) => {
          const { OrchestratorGoalTable: GT } = require("@/orchestrator/orchestrator.sql")
          const now = Date.now()
          for (const goal of failed) {
            db.update(GT)
              .set({ status: "pending", time_updated: now })
              .where(eq(GT.id, goal.id))
              .run()
          }
        })

        for (const goal of failed) {
          ensureGoalInWorkflow(goal.id, goal.title)
          await trackStepStart("retry_failed_goals", goal.id)
        }

        stopAfterDispatch.abort("retry_failed_goals")
        return `Retrying ${failed.length} failed goal(s): ${failed.map(g => g.title).join(", ")}. Reason: ${reason}. STOP HERE — task loop dispatches via GoalPool and re-triggers you when batch completes.`
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
      description: "Read current task context: goal states, eval verdicts, Decision Log, delivery summaries. Use this to gather information before making decisions.",
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
      description: "Create a run record for goal execution. Returns the runID needed for submit_execution or dispatch_ready_goals. Use after decompose (and optionally plan_goal for complex goals).",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to create a run"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        if (dbGoals.length === 0) return "No goals found. Run requirements first."

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

          // Each goal becomes a plan node (so scheduler can compute DAG)
          for (const [index, goal] of dbGoals.entries()) {
            db.insert(OrchestratorPlanNodeTable).values({
              id: Identifier.ascending("plan_node"),
              task_id: taskID,
              plan_version_id: planID,
              kind: "goal",
              goal_id: goal.id,
              title: goal.title,
              brief: goal.done_definition,
              depends_on_ids: goal.depends_on?.length ? goal.depends_on : undefined,
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
      description: "Aggregate all goal deliveries, then run the DeliveryAgent to verify build/test/startup before publication. All goals have already been auto-evaluated by infrastructure — check goal statuses via read_context before calling.",
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

        const deliveryLive = agentStream({ taskID, stage: "delivery" })
        const deliverySession = await Session.createNext({
          parentID: input.agentSessionID,
          title: `Delivery verification: ${task.title}`,
          directory: Instance.directory,
        })
        registerGoalRunSession(deliverySession.id, taskID, "delivery")
        const hooks = sessionStreamHooks({ sessionID: deliverySession.id, taskID, stage: "delivery" })
        await deliveryLive.start("Delivery verification started")

        try {
          const { DeliveryService } = await import("@/delivery/service")
          const verdict = await DeliveryService.verify({
            task: { title: task.title, request: task.request, sessionID: task.session_id ?? undefined, metadata: task.metadata ?? undefined },
            goals: goalInfos,
            delivery: deliveryInfo,
            signal: input.signal,
            stream: {
              onChunk: async (arg: any) => {
                if (hooks.onChunk) await hooks.onChunk(arg)
                const chunk = (arg as any)?.chunk
                if (chunk?.type !== "tool-input-start" && chunk?.type !== "tool-call" && chunk?.type !== "tool-result" && chunk?.type !== "tool-input-delta") {
                  if (deliveryLive.hooks.onChunk) await deliveryLive.hooks.onChunk(arg)
                }
              },
              onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg); if (deliveryLive.hooks.onError) await deliveryLive.hooks.onError(arg) },
            },
          })
          await hooks.flush()
          await deliveryLive.finish("Delivery verification finished")

          // Persist verdict as artifact so publish_delivery can proceed
          const { OrchestratorArtifactTable } = await import("@/orchestrator/orchestrator.sql")
          Database.use((db) =>
            db.insert(OrchestratorArtifactTable).values({
              id: Identifier.ascending("artifact"),
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
            return `Delivery verified and ACCEPTED. ${allDiffs.length} files, ${passedCount}/${goals.length} goals passed. Call publish_delivery to complete.`
          }
          const issues = verdict.issues_found.join("; ")
          await trackStepComplete("deliver", undefined, true)
          return `Delivery REJECTED: ${verdict.summary}. Issues: ${issues}. Goals: ${passedCount} passed, ${failedCount} failed. Fix issues and retry.`
        } catch (err) {
          await trackStepComplete("deliver", undefined, true)
          await deliveryLive.finish("Delivery verification failed")
          const msg = err instanceof Error ? err.message : String(err)
          log.error("deliver: verification failed", { taskID, error: msg })
          return `Delivery aggregated (${allDiffs.length} files) but verification failed: ${msg}. Decide whether to retry or publish without verification.`
        }
      },
    }),

    publish_delivery: tool({
      description: "Publish the accepted delivery to git and mark the task as completed. Only call after both eval and delivery verification have passed.",
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

  return Object.assign(tools, { stopSignal: stopAfterDispatch.signal })
}
