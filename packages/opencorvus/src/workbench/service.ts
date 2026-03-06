import z from "zod"
import { generateObject } from "ai"
import { Identifier } from "@/id/id"
import { Memory } from "@/memory"
import { Provider } from "@/provider/provider"
import { Snapshot } from "@/snapshot"
import {
  OrchestratorArtifactTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "@/orchestrator/orchestrator.sql"
import { EvaluationCheck } from "@/orchestrator/model"
import { Database, eq } from "@/storage/db"
import { WorkbenchBriefSnapshotTable, WorkbenchPreferenceTable, WorkbenchTaskNoteTable } from "./workbench.sql"

const MessageInput = z.object({
  taskID: z.string(),
  text: z.string(),
  source: z.string().default("user_message"),
  userID: z.string().optional(),
})

const WorkbenchIntent = z.object({
  kind: z.enum(["preference", "goal", "plan", "note"]),
  preferences: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
      }),
    )
    .default([]),
  goals: z.array(z.string()).default([]),
  plan_hints: z.array(z.string()).default([]),
  note: z.string().nullable().default(null),
  should_resume: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.5),
})

export namespace WorkbenchService {
  export function taskNotes(taskID: string, limit = 8) {
    return Database.use((db) =>
      db
        .select()
        .from(WorkbenchTaskNoteTable)
        .where(eq(WorkbenchTaskNoteTable.task_id, taskID))
        .orderBy(WorkbenchTaskNoteTable.time_created)
        .limit(limit)
        .all(),
    )
  }

  export function preferences(input: { projectID: string; taskID: string; userID?: string }) {
    return Database.use((db) =>
      db
        .select()
        .from(WorkbenchPreferenceTable)
        .where(input.userID ? eq(WorkbenchPreferenceTable.user_id, input.userID) : eq(WorkbenchPreferenceTable.project_id, input.projectID))
        .all(),
    )
  }

  export function recordTaskRequest(input: {
    taskID: string
    content: string
    source: string
    userID?: string
  }) {
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(WorkbenchTaskNoteTable)
        .values({
          id: Identifier.ascending("note"),
          task_id: input.taskID,
          kind: "user_request",
          source: input.source,
          user_id: input.userID,
          content: input.content,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
  }

  export async function ingestTaskMessage(raw: z.input<typeof MessageInput>) {
    const input = MessageInput.parse(raw)
    const text = input.text.trim()
    rememberUser({
      taskID: input.taskID,
      userID: input.userID,
    })
    if (!text) {
      return {
        kind: "note" as const,
        message: "Ignored empty message.",
        should_resume: false,
      }
    }

    const interpreted = await interpretWithLLM(input).then((result) =>
      result.success ? result.intent : fallbackIntent(text),
    )
    const resolved = interpreted.kind === "note" ? enrichIntent(text, interpreted) : interpreted

    if (resolved.kind === "preference" && resolved.preferences.length > 0) {
      for (const pref of resolved.preferences) {
        setPreference({
          taskID: input.taskID,
          userID: input.userID,
          key: pref.key,
          value: pref.value,
        })
      }
      return {
        kind: "preference" as const,
        message: `Preference saved: ${resolved.preferences.map((item) => `\`${item.key}=${item.value}\``).join(", ")}`,
        should_resume: false,
      }
    }

    if (resolved.kind === "goal" && resolved.goals.length > 0) {
      for (const goal of resolved.goals) {
        addGoal({
          taskID: input.taskID,
          description: goal,
        })
        recordNote({
          taskID: input.taskID,
          kind: "goal_update",
          content: goal,
          source: input.source,
          userID: input.userID,
        })
      }
      return {
        kind: "goal" as const,
        message: `Added goal${resolved.goals.length > 1 ? "s" : ""}: ${resolved.goals.join("; ")}`,
        should_resume: true,
      }
    }

    if (resolved.kind === "plan" && resolved.plan_hints.length > 0) {
      for (const hint of resolved.plan_hints) {
        appendPlanHint({
          taskID: input.taskID,
          hint,
        })
        recordNote({
          taskID: input.taskID,
          kind: "plan_hint",
          content: hint,
          source: input.source,
          userID: input.userID,
        })
      }
      return {
        kind: "plan" as const,
        message: "Plan hint recorded.",
        should_resume: true,
      }
    }

    const note = resolved.note?.trim() || text
    recordNote({
      taskID: input.taskID,
      kind: "operator_note",
      content: note,
      source: input.source,
      userID: input.userID,
    })
    return {
      kind: "note" as const,
      message: "Operator note recorded.",
      should_resume: true,
    }
  }

  export function compileBrief(input: {
    taskID: string
    runID?: string
    planVersionID?: string
    sessionID?: string
  }) {
    const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
    if (!task) throw new Error(`Task not found: ${input.taskID}`)
    const planID = input.planVersionID ?? task.active_plan_version_id ?? undefined
    const plan = planID
      ? Database.use((db) => db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.id, planID)).get())
      : undefined
    const goals = planID
      ? Database.use((db) =>
          db
            .select()
            .from(OrchestratorGoalTable)
            .where(eq(OrchestratorGoalTable.plan_version_id, planID))
            .orderBy(OrchestratorGoalTable.order_index)
            .all(),
        )
      : []
    const userID = taskUser({
      taskID: task.id,
      metadata: task.metadata,
    })
    const prefs = preferences({
      projectID: task.project_id,
      taskID: task.id,
      userID,
    })
    const notes = taskNotes(task.id)
    const memory = recallMemory(task)
    const content = [
      "<assistant-brief>",
      `Task: ${task.title}`,
      `Request: ${task.request}`,
      plan ? `Plan summary: ${plan.summary}` : "",
      planHints(plan?.metadata).length > 0
        ? "Plan hints:\n" + planHints(plan?.metadata).map((item) => `- ${item}`).join("\n")
        : "",
      goals.length > 0
        ? "Goals:\n" +
          goals
            .map((goal) =>
              `- ${goal.description} (criteria: ${goal.criteria}${
                Array.isArray((goal.metadata as Record<string, unknown> | null | undefined)?.check_selector)
                  ? `; checks: ${(((goal.metadata as Record<string, unknown>).check_selector as unknown[]) ?? [])
                      .filter((item): item is string => typeof item === "string")
                      .join(", ")}`
                  : ""
              })`,
            )
            .join("\n")
        : "",
      prefs.length > 0
        ? "User preferences:\n" + prefs.map((pref) => `- ${pref.key}: ${pref.value}`).join("\n")
        : "",
      notes.length > 0
        ? "Recent task notes:\n" + notes.slice(-6).map((note) => `- [${note.kind}] ${note.content}`).join("\n")
        : "",
      memory.length > 0
        ? "Relevant memory:\n" + memory.map((item) => `- ${item.fileTitle}: ${item.content.slice(0, 200)}`).join("\n")
        : "",
      "</assistant-brief>",
      "Use the brief above to align your work before executing the task.",
    ]
      .filter(Boolean)
      .join("\n\n")

    const now = Date.now()
    Database.use((db) =>
      db
        .insert(WorkbenchBriefSnapshotTable)
        .values({
          id: Identifier.ascending("brief"),
          task_id: task.id,
          plan_version_id: planID ?? null,
          run_id: input.runID ?? null,
          content,
          inputs: {
            userID,
            notes: notes.length,
            preferences: prefs.length,
            memory: memory.length,
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )

    return {
      content,
      preferences: prefs,
      notes,
      goals,
    }
  }

  export function compileBoard(input: { taskID: string }) {
    const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
    if (!task) throw new Error(`Task not found: ${input.taskID}`)
    const run = task.active_run_id
      ? Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, task.active_run_id!)).get())
      : undefined
    const plan = task.active_plan_version_id
      ? Database.use((db) => db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.id, task.active_plan_version_id!)).get())
      : undefined
    const goals = plan
      ? Database.use((db) =>
          db
            .select()
            .from(OrchestratorGoalTable)
            .where(eq(OrchestratorGoalTable.plan_version_id, plan.id))
            .orderBy(OrchestratorGoalTable.order_index)
            .all(),
        )
      : []
    const interactions = Database.use((db) =>
      db
        .select()
        .from(OrchestratorInteractionRequestTable)
        .where(eq(OrchestratorInteractionRequestTable.task_id, task.id))
        .orderBy(OrchestratorInteractionRequestTable.time_created)
        .all(),
    )
    const brief = compileBrief({
      taskID: task.id,
      runID: run?.id ?? undefined,
      planVersionID: plan?.id ?? undefined,
      sessionID: task.session_id ?? undefined,
    })
    const snapshot = Database.use((db) =>
      db
        .select()
        .from(WorkbenchBriefSnapshotTable)
        .where(eq(WorkbenchBriefSnapshotTable.task_id, task.id))
        .orderBy(WorkbenchBriefSnapshotTable.time_created)
        .all()
        .at(-1),
    )
    const prefs = preferences({
      projectID: task.project_id,
      taskID: task.id,
      userID: taskUser({
        taskID: task.id,
        metadata: task.metadata,
      }),
    })
    const notes = taskNotes(task.id, 12)
    const delivery = run
      ? Database.use((db) =>
          db
            .select()
            .from(OrchestratorDeliveryTable)
            .where(eq(OrchestratorDeliveryTable.run_id, run.id))
            .orderBy(OrchestratorDeliveryTable.time_created)
            .all()
            .at(-1),
        )
      : undefined
    const evaluation = run
      ? Database.use((db) =>
          db
            .select()
            .from(OrchestratorEvaluationTable)
            .where(eq(OrchestratorEvaluationTable.run_id, run.id))
            .orderBy(OrchestratorEvaluationTable.time_created)
            .all()
            .at(-1),
        )
      : undefined
    const artifacts = run
      ? Database.use((db) =>
          db
            .select()
            .from(OrchestratorArtifactTable)
            .where(eq(OrchestratorArtifactTable.run_id, run.id))
            .orderBy(OrchestratorArtifactTable.time_created)
            .all(),
        )
      : []
    const snapshots = Database.use((db) =>
      db
        .select()
        .from(OrchestratorProgressSnapshotTable)
        .where(eq(OrchestratorProgressSnapshotTable.task_id, task.id))
        .orderBy(OrchestratorProgressSnapshotTable.time_created)
        .all(),
    )

    return {
      task: {
        id: task.id,
        projectID: task.project_id,
        sessionID: task.session_id ?? undefined,
        activePlanVersionID: task.active_plan_version_id ?? undefined,
        activeRunID: task.active_run_id ?? undefined,
        requestID: task.request_id ?? undefined,
        source: task.source,
        title: task.title,
        request: task.request,
        status: task.status,
        priority: task.priority,
        blockingReason: task.blocking_reason ?? undefined,
        error: task.error ?? undefined,
        budget: task.budget
          ? {
              maxRuns: task.budget.max_runs,
              maxReplans: task.budget.max_replans,
              maxEvaluations: task.budget.max_evaluations,
              maxWallTimeMs: task.budget.max_wall_time_ms,
            }
          : undefined,
        metadata: task.metadata ?? undefined,
        time: {
          created: task.time_created,
          updated: task.time_updated,
          started: task.time_started ?? undefined,
          completed: task.time_completed ?? undefined,
        },
      },
      plan: plan
        ? {
            id: plan.id,
            taskID: plan.task_id,
            version: plan.version,
            status: plan.status,
            summary: plan.summary,
            prompt: plan.prompt,
            metadata: plan.metadata ?? undefined,
            time: {
              created: plan.time_created,
              updated: plan.time_updated,
            },
          }
        : undefined,
      run: run
        ? {
            id: run.id,
            taskID: run.task_id,
            planVersionID: run.plan_version_id ?? undefined,
            sessionID: run.session_id ?? undefined,
            executor: "opencode" as const,
            status: run.status,
            phase: run.phase,
            blockingReason: run.blocking_reason ?? undefined,
            error: run.error ?? undefined,
            retryCount: run.retry_count,
            executorRef: run.executor_ref
              ? {
                  sessionID: run.executor_ref.session_id,
                  queueTaskID: run.executor_ref.queue_task_id,
                }
              : undefined,
            metadata: run.metadata ?? undefined,
            time: {
              created: run.time_created,
              updated: run.time_updated,
              started: run.time_started ?? undefined,
              completed: run.time_completed ?? undefined,
            },
          }
        : undefined,
      delivery: delivery
        ? {
            id: delivery.id,
            taskID: delivery.task_id,
            runID: delivery.run_id,
            status: "ready" as const,
            summary: delivery.summary,
            result: {
              summary: String(delivery.result?.summary ?? delivery.summary),
              changedFiles: Array.isArray(delivery.result?.changed_files)
                ? delivery.result.changed_files.filter((item): item is string => typeof item === "string")
                : [],
              diffs: Array.isArray(delivery.result?.diffs)
                ? delivery.result.diffs.flatMap((item) => {
                    const parsed = Snapshot.FileDiff.safeParse(item)
                    return parsed.success ? [parsed.data] : []
                  })
                : [],
            },
            time: {
              created: delivery.time_created,
              updated: delivery.time_updated,
            },
          }
        : undefined,
      evaluation: evaluation
        ? {
            id: evaluation.id,
            taskID: evaluation.task_id,
            runID: evaluation.run_id,
            deliveryID: evaluation.delivery_id ?? undefined,
            status: evaluation.status,
            verdict: evaluation.verdict,
            summary: evaluation.summary,
            checks: Array.isArray(evaluation.checks)
              ? evaluation.checks.flatMap((item) => {
                  const parsed = EvaluationCheck.safeParse(item)
                  return parsed.success ? [parsed.data] : []
                })
              : [],
            time: {
              created: evaluation.time_created,
              updated: evaluation.time_updated,
              completed: evaluation.time_completed ?? undefined,
            },
          }
        : undefined,
      interactions: interactions.map((item) => ({
        id: item.id,
        taskID: item.task_id,
        runID: item.run_id,
        sessionID: item.session_id ?? undefined,
        externalID: item.external_id,
        type: item.request_type,
        status: item.status,
        title: item.title,
        body: item.body,
        payload: item.payload ?? undefined,
        response: item.response ?? undefined,
        time: {
          created: item.time_created,
          updated: item.time_updated,
          resolved: item.time_resolved ?? undefined,
        },
      })),
      artifacts: artifacts.map((item) => ({
        id: item.id,
        taskID: item.task_id,
        runID: item.run_id,
        deliveryID: item.delivery_id ?? undefined,
        kind: item.kind,
        label: item.label,
        payload: item.payload ?? undefined,
        time: {
          created: item.time_created,
          updated: item.time_updated,
        },
      })),
      snapshots: snapshots.map((item) => ({
        id: item.id,
        taskID: item.task_id,
        status: item.status,
        summary: item.summary,
        payload: item.payload ?? undefined,
        time: {
          created: item.time_created,
          updated: item.time_updated,
        },
      })),
      brief: {
        content: brief.content,
        updated_at: snapshot?.time_created ?? Date.now(),
      },
      lanes: [
        {
          id: "run",
          title: "Run",
          cards: run
            ? [
                {
                  id: run.id,
                  kind: "run" as const,
                  title: `${run.executor} / ${run.phase}`,
                  detail: run.error ?? task.blocking_reason ?? undefined,
                  status: run.status,
                  metadata: run.executor_ref ?? undefined,
                },
              ]
            : [],
        },
        {
          id: "goals",
          title: "Goals",
          cards: goals.map((goal) => ({
            id: goal.id,
            kind: "goal" as const,
            title: goal.description,
            detail: goal.criteria,
            status: goal.status,
            metadata: goal.metadata ?? undefined,
          })),
        },
        {
          id: "blockers",
          title: "Blockers",
          cards: interactions
            .filter((item) => item.status === "pending")
            .map((item) => ({
              id: item.id,
              kind: "interaction" as const,
              title: item.title,
              detail: item.body,
              status: item.status,
              metadata: {
                type: item.request_type,
              },
            })),
        },
        {
          id: "preferences",
          title: "Preferences",
          cards: prefs.map((pref) => ({
            id: pref.id,
            kind: "preference" as const,
            title: pref.key,
            detail: pref.value,
            status: pref.scope,
          })),
        },
        {
          id: "notes",
          title: "Notes",
          cards: notes.slice(-8).map((note) => ({
            id: note.id,
            kind: note.kind === "plan_hint" ? ("plan_hint" as const) : ("note" as const),
            title: note.kind,
            detail: note.content,
            status: note.source,
          })),
        },
      ],
    }
  }
}

async function interpretWithLLM(input: z.infer<typeof MessageInput>) {
  if (process.env.OPENCORVUS_WORKBENCH_LLM === "0") {
    return { success: false as const }
  }
  try {
    const model = await workbenchModel()
    if (!model) return { success: false as const }
    const language = await Provider.getLanguage(model)
    const result = await generateObject({
      model: language,
      temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
      messages: [
        {
          role: "system",
          content: `Classify the user's message into exactly one workbench action.

Rules:
- Use "preference" when the user expresses durable preferences or style constraints.
- Use "goal" when the user adds or changes acceptance goals.
- Use "plan" when the user suggests how the task should be executed.
- Use "note" for everything else.
- Do not invent preferences, goals, or plan hints that are not supported by the text.
- Keep extracted strings concise and directly usable.`,
        },
        {
          role: "user",
          content: input.text,
        },
      ],
      schema: WorkbenchIntent,
    })
    return {
      success: true as const,
      intent: result.object,
    }
  } catch {
    return {
      success: false as const,
    }
  }
}

function fallbackIntent(text: string) {
  const pref = parsePreference(text)
  if (pref) {
    return WorkbenchIntent.parse({
      kind: "preference",
      preferences: [pref],
      should_resume: false,
    })
  }
  const goal = parseCommand(text, "/goal")
  if (goal) {
    return WorkbenchIntent.parse({
      kind: "goal",
      goals: [goal],
      should_resume: true,
    })
  }
  const plan = parseCommand(text, "/plan")
  if (plan) {
    return WorkbenchIntent.parse({
      kind: "plan",
      plan_hints: [plan],
      should_resume: true,
    })
  }
  return WorkbenchIntent.parse({
    kind: "note",
    note: text,
    should_resume: true,
  })
}

async function workbenchModel() {
  if (process.env.MOONSHOT_API_KEY) {
    return (
      (await Provider.getModel("moonshotai-cn", "kimi-k2.5").catch(() => undefined)) ??
      (await Provider.getModel("moonshotai", "kimi-k2.5").catch(() => undefined))
    )
  }
  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) return undefined
  return Provider.getModel(def.providerID, def.modelID).catch(() => undefined)
}

function enrichIntent(text: string, intent: z.infer<typeof WorkbenchIntent>) {
  const goal = inferGoals(text)
  if (goal.length > 0) {
    return WorkbenchIntent.parse({
      ...intent,
      kind: "goal",
      goals: goal,
      should_resume: true,
    })
  }
  const hint = inferPlanHints(text)
  if (hint.length > 0) {
    return WorkbenchIntent.parse({
      ...intent,
      kind: "plan",
      plan_hints: hint,
      should_resume: true,
    })
  }
  const preference = inferPreferences(text)
  if (preference.length > 0) {
    return WorkbenchIntent.parse({
      ...intent,
      kind: "preference",
      preferences: preference,
      should_resume: false,
    })
  }
  return intent
}

function inferPreferences(text: string) {
  const lower = text.toLowerCase()
  const prefs: Array<{ key: string; value: string }> = []
  if (/\bconcise\b|\bbrief\b|简洁|精简/.test(lower)) {
    prefs.push({ key: "style", value: "concise" })
  }
  if (/lockfile/.test(lower) && /avoid|don't|do not|unless absolutely necessary|unless necessary|不要|别改/.test(lower)) {
    prefs.push({ key: "lockfile_policy", value: "avoid_changes" })
  }
  if (/small diff|minimal diff|minimal changes|keep the diff small|小改动/.test(lower)) {
    prefs.push({ key: "change_style", value: "minimal_diff" })
  }
  return prefs
}

function inferGoals(text: string) {
  const lower = text.toLowerCase()
  const goals: string[] = []
  if (/(make sure|ensure|before.*done|must include|请确保|务必)/.test(lower) && /(regression|coverage|test|tests)/.test(lower)) {
    goals.push(text.trim())
  }
  return goals
}

function inferPlanHints(text: string) {
  const lower = text.toLowerCase()
  if (/(start by|first,|first |keep the diff small|incremental|分步骤|先)/.test(lower)) {
    return [text.trim()]
  }
  return []
}

function inferGoalMetadata(text: string) {
  const lower = text.toLowerCase()
  const selectors = [
    lower.includes("build") ? "build" : undefined,
    lower.includes("test") ? "test" : undefined,
    lower.includes("lint") ? "lint" : undefined,
    lower.includes("verify") ? "verify_cmd" : undefined,
    lower.includes("regression") || lower.includes("coverage") ? "test" : undefined,
  ].filter((item): item is string => Boolean(item))
  if (selectors.length === 0) return undefined
  return {
    check_selector: [...new Set(selectors)],
  }
}

function setPreference(input: { taskID: string; userID?: string; key: string; value: string }) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  const now = Date.now()
  Database.use((db) => {
    const existing = db
      .select()
      .from(WorkbenchPreferenceTable)
      .where(eq(WorkbenchPreferenceTable.key, input.key))
      .all()
      .find((item) => item.task_id === task.id || (!!input.userID && item.user_id === input.userID))
    if (existing) {
      db.update(WorkbenchPreferenceTable)
        .set({
          value: input.value,
          time_updated: now,
        })
        .where(eq(WorkbenchPreferenceTable.id, existing.id))
        .run()
      return
    }
    db.insert(WorkbenchPreferenceTable)
      .values({
        id: Identifier.ascending("preference"),
        project_id: task.project_id,
        task_id: task.id,
        user_id: input.userID,
        scope: input.userID ? "user" : "task",
        key: input.key,
        value: input.value,
        source: "user_message",
        confidence: 100,
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

function addGoal(input: { taskID: string; description: string }) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  const planVersionID = task?.active_plan_version_id
  if (!task || !planVersionID) return
  const now = Date.now()
  const count = Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalTable)
      .where(eq(OrchestratorGoalTable.plan_version_id, planVersionID))
      .all().length,
  )
  Database.use((db) =>
    db
      .insert(OrchestratorGoalTable)
      .values({
        id: Identifier.ascending("goal"),
        task_id: task.id,
        plan_version_id: planVersionID,
        description: input.description,
        criteria: "This user-provided goal is satisfied and acceptance checks still pass.",
        metadata: inferGoalMetadata(input.description),
        priority: "blocking",
        status: "pending",
        order_index: count,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  Database.use((db) =>
    db
      .insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "running",
        summary: "Goal added from user message",
        payload: {
          description: input.description,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function appendPlanHint(input: { taskID: string; hint: string }) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task?.active_plan_version_id) return
  const plan = Database.use((db) =>
    db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.id, task.active_plan_version_id!)).get(),
  )
  if (!plan) return
  const hints = planHints(plan.metadata)
  const next = [...hints, input.hint]
  Database.use((db) =>
    db
      .update(OrchestratorPlanVersionTable)
      .set({
        metadata: {
          ...(plan.metadata ?? {}),
          operator_hints: next,
        },
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorPlanVersionTable.id, plan.id))
      .run(),
  )
}

function recordNote(input: {
  taskID: string
  kind: "user_request" | "operator_note" | "plan_hint" | "goal_update" | "constraint" | "decision" | "summary"
  content: string
  source: string
  userID?: string
}) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(WorkbenchTaskNoteTable)
      .values({
        id: Identifier.ascending("note"),
        task_id: input.taskID,
        kind: input.kind,
        source: input.source,
        user_id: input.userID,
        content: input.content,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function rememberUser(input: { taskID: string; userID?: string }) {
  if (!input.userID) return
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task) return
  const next = {
    ...(task.metadata ?? {}),
    workbench: {
      ...(((task.metadata as Record<string, unknown> | null | undefined)?.workbench as Record<string, unknown> | undefined) ?? {}),
      user: input.userID,
    },
  }
  Database.use((db) =>
    db
      .update(OrchestratorTaskTable)
      .set({
        metadata: next,
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run(),
  )
}

function recallMemory(task: typeof OrchestratorTaskTable.$inferSelect) {
  const query = [task.title, task.request]
    .join(" ")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .split(/\s+/)
    .filter((item) => item.length > 2)
    .slice(0, 6)
    .join(" ")
  if (!query) return []
  try {
    return Memory.search({
      query,
      projectId: task.project_id,
      limit: 3,
    })
  } catch {
    return []
  }
}

function taskUser(input: { taskID: string; metadata: unknown }) {
  if (input.metadata && typeof input.metadata === "object") {
    const workbench = (input.metadata as Record<string, unknown>).workbench
    if (workbench && typeof workbench === "object") {
      const user = (workbench as Record<string, unknown>).user
      if (typeof user === "string" && user) return user
    }
    const slack = (input.metadata as Record<string, unknown>).slack
    if (slack && typeof slack === "object") {
      const user = (slack as Record<string, unknown>).user
      if (typeof user === "string" && user) return user
    }
  }
  const note = Database.use((db) =>
    db
      .select()
      .from(WorkbenchTaskNoteTable)
      .where(eq(WorkbenchTaskNoteTable.task_id, input.taskID))
      .orderBy(WorkbenchTaskNoteTable.time_created)
      .all()
      .filter((item) => typeof item.user_id === "string" && item.user_id)
      .at(-1),
  )
  if (note?.user_id) return note.user_id
  const pref = Database.use((db) =>
    db
      .select()
      .from(WorkbenchPreferenceTable)
      .where(eq(WorkbenchPreferenceTable.task_id, input.taskID))
      .orderBy(WorkbenchPreferenceTable.time_created)
      .all()
      .filter((item) => typeof item.user_id === "string" && item.user_id)
      .at(-1),
  )
  if (pref?.user_id) return pref.user_id
  return undefined
}

function planHints(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return []
  const hints = (metadata as Record<string, unknown>).operator_hints
  if (!Array.isArray(hints)) return []
  return hints.filter((item): item is string => typeof item === "string" && item.length > 0)
}

function parseCommand(text: string, prefix: string) {
  if (!text.toLowerCase().startsWith(prefix)) return undefined
  const value = text.slice(prefix.length).trim()
  if (!value) return undefined
  return value
}

function parsePreference(text: string) {
  const pref = parseCommand(text, "/pref")
  if (!pref) return undefined
  const match = pref.match(/^([a-zA-Z0-9._-]+)\s*[:=]\s*(.+)$/)
  if (!match) return undefined
  return {
    key: match[1],
    value: match[2].trim(),
  }
}
