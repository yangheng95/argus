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

function stageTimeout(stage: "spec" | "goal" | "plan"): number {
  const env = { spec: "OPENCORVUS_SPEC_TIMEOUT_MS", goal: "OPENCORVUS_GOAL_TIMEOUT_MS", plan: "OPENCORVUS_PLAN_TIMEOUT_MS" }
  const defaults = { spec: 300_000, goal: 180_000, plan: 300_000 }
  return parseInt(process.env[env[stage]] || String(defaults[stage]), 10)
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createTaskAgentTools(input: { taskID: string; agentSessionID: string; signal?: AbortSignal }) {
  const { taskID } = input

  return {
    decompose: tool({
      description: "Explore the codebase, analyze the task, and decompose it into executable goal contracts with cross-goal interface declarations. This single tool replaces the old analyze_requirements + decompose_goals two-step process.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to decompose the task"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        const existingGoals = listGoals(taskID)
        if (existingGoals.length > 0) return `${existingGoals.length} goals already defined. Skipping.`
        if (task.active_spec_version_id) return `Decompose already completed (spec=${task.active_spec_version_id}). Use read_context to see goals.`

        task = await updateTask(task, { status: "active" }, "Decomposition started")
        const guard = createInactivityGuard(stageTimeout("goal"), () => {
          log.warn("decompose stage inactivity timeout", { taskID })
        })
        try {
          const decomposeLive = agentStream({ taskID, stage: "goal" })
          const decomposeSession = await Session.createNext({
            parentID: input.agentSessionID,
            title: `Decompose: ${task.title}`,
            directory: Instance.directory,
          })
          registerGoalRunSession(decomposeSession.id, taskID)
          const hooks = sessionStreamHooks({ sessionID: decomposeSession.id, taskID, stage: "goal" })
          await decomposeLive.start("Decomposition started")

          const { DecomposeService } = await import("@/decompose/service")
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)

          const result = await withStageRetry("goal", () =>
            DecomposeService.decompose({
              title: task.title,
              request: task.request,
              taskID,
              sessionID: decomposeSession.id,
              signal: input.signal,
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
          return `${result.goals.length} goals created. Summary: ${result.summary}. Decisions: ${result.decisions.map(d => `${d.key}=${d.value}`).join(", ")}`
        } finally {
          guard.clear()
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Per-goal tools — Task Agent decides when to call each
    // -----------------------------------------------------------------------

    plan_goal: tool({
      description: "Create an implementation plan for a specific goal. Optional — skip for simple goals. The plan gives the executor detailed steps.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to plan"),
        reason: z.string().optional().describe("Why you decided to plan this goal"),
      }),
      execute: async ({ goalID }) => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`

        const { planGoal } = await import("@/planner/per-goal")
        const { createDecisionLog } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)

        // Create child session for planner agent messages
        const planSession = await Session.createNext({
          parentID: input.agentSessionID,
          title: `Plan: ${goal.title}`,
          directory: Instance.directory,
        })
        registerGoalRunSession(planSession.id, taskID)
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
          return `Plan created for "${goal.title}": ${steps.brief.slice(0, 500)}`
        } finally {
          await hooks.flush()
        }
      },
    }),

    eval_goal: tool({
      description: "Run autonomous evaluation on a goal's delivery. The eval agent reads done_definition, examines the code, infers tests, and runs them. Returns verdict + evidence.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to evaluate"),
        reason: z.string().optional().describe("Why you decided to evaluate this goal"),
      }),
      execute: async ({ goalID }) => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`

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
        registerGoalRunSession(evalSession.id, taskID)
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

        // Persist evaluation to DB (direct INSERT — simpler than legacy persistEvaluation)
        const { OrchestratorEvaluationTable } = await import("@/orchestrator/orchestrator.sql")
        const evalID = Identifier.ascending("evaluation")
        const now = Date.now()
        Database.use((db) =>
          db.insert(OrchestratorEvaluationTable).values({
            id: evalID,
            task_id: taskID,
            run_id: latestRun.coordinator_run_id,
            goal_run_id: latestRun.id,
            delivery_id: delivery.id,
            status: verdict.pass ? "passed" : "failed",
            verdict: verdict.pass ? "accepted" : "rejected",
            summary: verdict.reasoning.slice(0, 500),
            checks: verdict.evidence.map((e, i) => ({
              name: `evidence_${i + 1}`,
              status: verdict.pass ? "passed" : "failed",
              evidence: e,
            })),
            time_created: now,
            time_updated: now,
          }).run(),
        )

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
      description: "Execute a single goal in an isolated git worktree. Creates worktree, submits to executor, returns asynchronously. You will be re-triggered when execution completes. STOP after calling this.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to execute"),
        reason: z.string().optional().describe("Why you decided to execute this goal now"),
      }),
      execute: async ({ goalID }) => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`
        if (goal.status === "running") return `Goal ${goalID} is already running.`
        if (goal.status === "passed") return `Goal ${goalID} already passed.`

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

        // Dispatch via runtime (creates worktree, submits to executor, starts event bridge)
        const { OrchestratorRuntime } = await import("@/orchestrator/runtime")
        const { hooks } = await import("@/orchestrator/state")
        await OrchestratorRuntime.dispatchSingleGoal(taskID, runID, goalID, hooks())
        return `Goal "${goal.title}" (${goalID}) submitted to executor. Execution running asynchronously. STOP HERE — you will be re-triggered when it completes.`
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

        const { OrchestratorRuntime } = await import("@/orchestrator/runtime")
        const { hooks } = await import("@/orchestrator/state")
        const dispatched = await OrchestratorRuntime.dispatchReadyGoals(taskID, run.id, plan.id, hooks())
        if (dispatched === 0) {
          const goals = listGoals(taskID)
          const pending = goals.filter(g => g.status === "pending").length
          const running = goals.filter(g => g.status === "running").length
          return `No goals ready to dispatch. Pending: ${pending}, Running: ${running}. Check dependencies with read_context.`
        }
        return `${dispatched} goal(s) dispatched in parallel. STOP HERE — you will be re-triggered when the batch completes.`
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
          const { findEvaluations } = await import("@/orchestrator/store")
          const evals = findEvaluations(taskID)
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
        if (dbGoals.length === 0) return "No goals found. Run decompose first."

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
        const { updateGoalRun: _, ...persist } = await import("@/orchestrator/persist")
        Database.use((db) => {
          const { OrchestratorRunTable } = require("@/orchestrator/orchestrator.sql")
          db.update(OrchestratorRunTable).set({ status: "running", time_started: Date.now(), time_updated: Date.now() }).where(eq(OrchestratorRunTable.id, runID)).run()
          const { OrchestratorTaskTable: TT } = require("@/orchestrator/orchestrator.sql")
          db.update(TT).set({ status: "active", time_updated: Date.now() }).where(eq(TT.id, taskID)).run()
        })

        // Dispatch ready goals via infrastructure
        const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
        if (!plan) return `Run ${runID} activated but no plan found. Use dispatch_ready_goals or execute_goal manually.`

        const { OrchestratorRuntime } = await import("@/orchestrator/runtime")
        const { hooks } = await import("@/orchestrator/state")
        const dispatched = await OrchestratorRuntime.dispatchReadyGoals(taskID, runID, plan.id, hooks())
        return `Run ${runID} activated. ${dispatched} goal(s) dispatched in parallel. STOP HERE — you will be re-triggered when the batch completes.`
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
      description: "Restart the task from a specific stage. Use when the current approach is fundamentally wrong, the user requests a restart, or you need to redo decompose/plan from scratch.",
      inputSchema: z.object({
        stage: z.enum(["decompose", "plan", "executor"]).describe("Which stage to restart from"),
        reason: z.string().describe("Why restarting from this stage"),
      }),
      execute: async ({ stage, reason }) => {
        const task = requireTask(taskID)
        // All restarts go to "active" — the agent decides what to do next
        await updateTask(task, { status: "active", error: null, blocking_reason: null }, `Restart from ${stage}: ${reason}`)
        return `Task restarted from ${stage} stage. Reason: ${reason}. Continue with the appropriate tool (decompose for decompose, create_plan for plan, submit_execution for executor).`
      },
    }),

    deliver: tool({
      description: "Aggregate all goal deliveries, then run the DeliveryAgent to verify build/test/startup before publication. Call this when you believe all goals are complete.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to deliver now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Execute goals first."
        const run = requireRun(task.active_run_id)

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
        const goals = listGoals(taskID)
        const goalInfos = goals.map(g => ({
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
        registerGoalRunSession(deliverySession.id, taskID)
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
              id: Identifier.ascending("art"),
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
            return `Delivery verified and ACCEPTED. ${allDiffs.length} files, ${passedCount}/${goals.length} goals passed. Call publish_delivery to complete.`
          }
          const issues = verdict.issues_found.join("; ")
          return `Delivery REJECTED: ${verdict.summary}. Issues: ${issues}. Goals: ${passedCount} passed, ${failedCount} failed. Fix issues and retry.`
        } catch (err) {
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
          return `Delivery published and task completed successfully.`
        }

        await updateTask(task, { status: "failed", blocking_reason: null, error: result.summary, time_completed: completed }, result.summary)
        return `Publish returned non-delivered status: ${result.summary}`
      },
    }),
  }
}
