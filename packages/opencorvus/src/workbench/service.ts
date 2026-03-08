import z from "zod"
import { generateObject } from "ai"
import { Identifier } from "@/id/id"
import { Memory } from "@/memory"
import { Preference } from "@/preference"
import { Provider } from "@/provider/provider"
import { Snapshot } from "@/snapshot"
import { GoalService } from "@/orchestrator/goal-service"
import {
  OrchestratorArtifactTable,
  OrchestratorChannelBindingTable,
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
import { WorkbenchBriefSnapshotTable, WorkbenchTaskNoteTable } from "./workbench.sql"

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

const BOARD_SNAPSHOT_LIMIT = 80
const BOARD_CHANGED_FILE_LIMIT = 80
const BOARD_SUMMARY_LIMIT = 4000

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

  export function preferences(input: { projectID: string; sessionID?: string }) {
    return Preference.list({
      projectID: input.projectID,
      sessionID: input.sessionID,
      scope: "all",
    })
  }

  export function updatePreference(input: {
    preferenceID: string
    key: string
    value: string
  }) {
    return Preference.update(input)
  }

  export function deletePreference(preferenceID: string) {
    return Preference.remove(preferenceID)
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

    const explicitPreference = parsePreference(text)
    if (explicitPreference) {
      setPreference({
        taskID: input.taskID,
        userID: input.userID,
        key: explicitPreference.key,
        value: explicitPreference.value,
        scope: explicitPreference.scope,
      })
      return {
        kind: "preference" as const,
        message: `Preference saved (${explicitPreference.scope}): \`${explicitPreference.key}=${explicitPreference.value}\``,
        should_resume: false,
      }
    }

    const goal = parseCommand(text, "/goal")
    if (goal) {
      GoalService.addOperatorGoal({
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
      return {
        kind: "goal" as const,
        message: `Added goal: ${goal}`,
        should_resume: true,
      }
    }

    const plan = parseCommand(text, "/plan")
    if (plan) {
      appendPlanHint({
        taskID: input.taskID,
        hint: plan,
      })
      recordNote({
        taskID: input.taskID,
        kind: "plan_hint",
        content: plan,
        source: input.source,
        userID: input.userID,
      })
      return {
        kind: "plan" as const,
        message: "Plan hint recorded.",
        should_resume: true,
      }
    }

    const interpreted = await interpretWithLLM(input)
    if (!interpreted.success) {
      recordNote({
        taskID: input.taskID,
        kind: "operator_note",
        content: text,
        source: input.source,
        userID: input.userID,
      })
      return {
        kind: "note" as const,
        message: "Intent analysis failed; recorded as operator note without changing goals, plans, or preferences.",
        should_resume: false,
      }
    }
    const resolved = interpreted.intent

    if (resolved.kind === "preference" && resolved.preferences.length > 0) {
      const scope = inferPreferenceScope(text)
      for (const pref of resolved.preferences) {
        setPreference({
          taskID: input.taskID,
          userID: input.userID,
          key: pref.key,
          value: pref.value,
          scope,
        })
      }
      return {
        kind: "preference" as const,
        message: `Preference saved (${scope}): ${resolved.preferences.map((item) => `\`${item.key}=${item.value}\``).join(", ")}`,
        should_resume: false,
      }
    }

    if (resolved.kind === "goal" && resolved.goals.length > 0) {
      for (const goal of resolved.goals) {
        GoalService.addOperatorGoal({
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

  /** Simple cache key for brief snapshots — avoids regenerating when inputs haven't changed. */
  function briefSignature(input: {
    task: { id: string; request: string }
    plan: { id: string; summary?: string | null } | undefined
    runID?: string
    goals: Array<{ id: string; status: string }>
    prefs: Array<{ key: string; value: string }>
    notes: Array<{ id: string }>
  }): string {
    const parts = [
      input.task.id,
      input.task.request.slice(0, 64),
      input.plan?.id ?? "no-plan",
      input.runID ?? "no-run",
      input.goals.map((g) => `${g.id}:${g.status}`).join(","),
      input.prefs.length.toString(),
      input.notes.length.toString(),
    ]
    return parts.join("|")
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
    const prefs = preferences({
      projectID: task.project_id,
      sessionID: task.session_id ?? input.sessionID,
    })
    const notes = taskNotes(task.id)
    const globalPrefs = prefs.filter((item) => item.scope === "global")
    const sessionPrefs = prefs.filter((item) => item.scope === "session")
    const signature = briefSignature({
      task,
      plan,
      runID: input.runID,
      goals,
      prefs,
      notes,
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
    if (snapshot?.inputs?.signature === signature) {
      return {
        content: snapshot.content,
        updatedAt: snapshot.time_created,
        preferences: Preference.merged({
          projectID: task.project_id,
          sessionID: task.session_id ?? input.sessionID,
        }).map((item) => ({
          key: item.key,
          value: item.value,
        })),
        notes,
        goals,
      }
    }

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
      globalPrefs.length > 0
        ? "Global preferences:\n" + globalPrefs.map((pref) => `- ${pref.key}: ${pref.value}`).join("\n")
        : "",
      sessionPrefs.length > 0
        ? "Session preferences:\n" + sessionPrefs.map((pref) => `- ${pref.key}: ${pref.value}`).join("\n")
        : "",
      notes.length > 0
        ? "Recent task notes:\n" + notes.slice(-6).map((note) => `- [${note.kind}] ${note.content}`).join("\n")
        : "",
      memory.length > 0
        ? "Relevant memory:\n" +
          memory
            .map((item) => `- [${item.scope}] ${item.fileTitle}: ${item.content.slice(0, 200)}`)
            .join("\n")
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
            signature,
            notes: notes.length,
            globalPreferences: globalPrefs.length,
            sessionPreferences: sessionPrefs.length,
            memory: memory.length,
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )

    return {
      content,
      updatedAt: now,
      preferences: Preference.merged({
        projectID: task.project_id,
        sessionID: task.session_id ?? input.sessionID,
      }).map((item) => ({
        key: item.key,
        value: item.value,
      })),
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
    const prefs = preferences({
      projectID: task.project_id,
      sessionID: task.session_id ?? undefined,
    })
    const notes = taskNotes(task.id, 12)
    const brief = compileBrief({
      taskID: task.id,
      runID: run?.id ?? undefined,
      planVersionID: plan?.id ?? undefined,
      sessionID: task.session_id ?? undefined,
    })
    const staging = notes.filter((note) =>
      ["plan_hint", "goal_update", "operator_note", "constraint", "decision"].includes(note.kind),
    )
    const history = notes.filter((note) => ["user_request", "summary"].includes(note.kind))
    const allDeliveries = Database.use((db) =>
      db
        .select()
        .from(OrchestratorDeliveryTable)
        .where(eq(OrchestratorDeliveryTable.task_id, task.id))
        .orderBy(OrchestratorDeliveryTable.time_created)
        .all(),
    )
    const delivery = run ? allDeliveries.filter((item) => item.run_id === run.id).at(-1) : undefined
    const latestDelivery = delivery ?? allDeliveries.at(-1)
    const allEvaluations = Database.use((db) =>
      db
        .select()
        .from(OrchestratorEvaluationTable)
        .where(eq(OrchestratorEvaluationTable.task_id, task.id))
        .orderBy(OrchestratorEvaluationTable.time_created)
        .all(),
    )
    const evaluation = run ? allEvaluations.filter((item) => item.run_id === run.id).at(-1) : undefined
    const latestEvaluation = evaluation ?? allEvaluations.at(-1)
    const acceptedEvaluation = [...allEvaluations]
      .reverse()
      .find((item) => item.verdict === "accepted" || item.status === "passed")
    const acceptedDelivery = acceptedEvaluation?.delivery_id
      ? allDeliveries.find((item) => item.id === acceptedEvaluation.delivery_id)
      : undefined
    const bindings = Database.use((db) =>
      db
        .select()
        .from(OrchestratorChannelBindingTable)
        .where(eq(OrchestratorChannelBindingTable.task_id, task.id))
        .orderBy(OrchestratorChannelBindingTable.time_created)
        .all(),
    )
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
    const latestArtifacts =
      artifacts.length > 0
        ? artifacts
        : latestDelivery
          ? Database.use((db) =>
              db
                .select()
                .from(OrchestratorArtifactTable)
                .where(eq(OrchestratorArtifactTable.delivery_id, latestDelivery.id))
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
    const compactSnapshots = compactBoardSnapshots(snapshots).slice(-BOARD_SNAPSHOT_LIMIT)
    const pendingInteractions = interactions.filter((item) => item.status === "pending")
    const currentFailure = boardFailure({
      task,
      run,
      interactions: pendingInteractions,
      evaluation: latestEvaluation,
    })
    const overview = boardOverview({
      task,
      run,
      pendingInteractions,
      candidateDelivery: latestDelivery,
      acceptedDelivery,
      evaluation: latestEvaluation,
      currentFailure,
    })

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
            executor: run.executor,
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
      delivery: viewBoardDelivery(latestDelivery),
      candidateDelivery: viewBoardDelivery(latestDelivery),
      acceptedDelivery: viewBoardDelivery(acceptedDelivery),
      evaluation: viewBoardEvaluation(latestEvaluation),
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
      channels: bindings.map((item) => ({
        id: item.id,
        platform: item.platform,
        channel: item.channel,
        thread: item.thread,
        payload: item.payload ?? undefined,
        time: {
          created: item.time_created,
          updated: item.time_updated,
        },
      })),
      artifacts: latestArtifacts
        .filter((item) => item.kind !== "diff" && item.kind !== "changed_file")
        .map((item) => ({
        id: item.id,
        taskID: item.task_id,
        runID: item.run_id,
        deliveryID: item.delivery_id ?? undefined,
        kind: item.kind,
        label: item.label,
        payload: compactArtifactPayload(item.kind, item.payload),
        time: {
          created: item.time_created,
          updated: item.time_updated,
        },
      })),
      snapshots: compactSnapshots.map((item) => ({
        id: item.id,
        taskID: item.task_id,
        status: item.status,
        summary: item.summary,
        payload: compactSnapshotPayload(item.payload),
        time: {
          created: item.time_created,
          updated: item.time_updated,
        },
      })),
      overview,
      brief: {
        content: brief.content,
        updated_at: brief.updatedAt ?? Date.now(),
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
                  time: run.time_updated,
                  metadata: run.executor_ref ?? undefined,
                },
              ]
            : [],
        },
        {
          id: "delivery",
          title: "Delivery",
          cards: latestDelivery
            ? [
                {
                  id: latestDelivery.id,
                  kind: "note" as const,
                  title: latestDelivery.status,
                  detail: latestDelivery.summary,
                  status: latestDelivery.status,
                  time: latestDelivery.time_updated,
                  metadata: latestDelivery.result ?? undefined,
                },
              ]
            : [],
        },
        {
          id: "goals",
          title: "Dynamic Goals",
          cards: goals
            .toSorted((a, b) => {
              const score = (value: string) => (value === "pending" ? 0 : value === "failed" ? 1 : 2)
              return score(a.status) - score(b.status)
            })
            .map((goal) => ({
              id: goal.id,
              kind: "goal" as const,
              title: goal.description,
              detail: goal.criteria,
              status: goal.status,
              time: goal.time_updated,
              metadata: goal.metadata ?? undefined,
            })),
        },
        {
          id: "staging",
          title: "Staging",
          cards: staging.slice(-8).map((note) => ({
            id: note.id,
            kind: note.kind === "plan_hint" ? ("plan_hint" as const) : ("note" as const),
            title: note.kind,
            detail: note.content,
            status: note.source,
            time: note.time_created,
            metadata: note.metadata ?? undefined,
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
              time: item.time_updated,
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
            time: pref.timeUpdated,
          })),
        },
        {
          id: "notes",
          title: "History",
          cards: history.slice(-8).map((note) => ({
            id: note.id,
            kind: note.kind === "plan_hint" ? ("plan_hint" as const) : ("note" as const),
            title: note.kind,
            detail: note.content,
            status: note.source,
            time: note.time_created,
          })),
        },
      ],
    }
  }
}

function briefSignature(input: {
  task: typeof OrchestratorTaskTable.$inferSelect
  plan?: typeof OrchestratorPlanVersionTable.$inferSelect
  runID?: string
  goals: Array<typeof OrchestratorGoalTable.$inferSelect>
  prefs: Array<{ timeUpdated: number }>
  notes: Array<{ time_updated: number }>
}) {
  const noteUpdated = input.notes.at(-1)?.time_updated ?? 0
  const prefUpdated = input.prefs.reduce((max, item) => Math.max(max, item.timeUpdated), 0)
  const goalUpdated = input.goals.reduce((max, item) => Math.max(max, item.time_updated), 0)
  return [
    input.task.id,
    input.task.time_updated,
    input.plan?.id ?? "",
    input.plan?.time_updated ?? 0,
    input.runID ?? "",
    input.goals.length,
    goalUpdated,
    input.prefs.length,
    prefUpdated,
    input.notes.length,
    noteUpdated,
  ].join("|")
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
- Default preferences to global unless the user clearly says they only apply to this session.
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

async function workbenchModel() {
  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) return undefined
  return Provider.getModel(def.providerID, def.modelID).catch(() => undefined)
}

function inferPreferenceScope(text: string): Preference.Scope {
  const lower = text.toLowerCase()
  if (/(this session|for this session|only for now|temporarily|temporary|暂时|这次会话|本次会话|仅本次)/.test(lower)) {
    return "session"
  }
  return "global"
}


function clipBoard(input: string) {
  if (input.length <= BOARD_SUMMARY_LIMIT) return input
  return `${input.slice(0, BOARD_SUMMARY_LIMIT)}\n...[truncated]`
}

function compactBoardSnapshots(
  input: Array<{
    id: string
    task_id: string
    status: string
    summary: string
    payload: unknown
    time_created: number
    time_updated: number
  }>,
) {
  return input.reduce<typeof input>((acc, item) => {
    const prev = acc.at(-1)
    if (prev && prev.status === item.status && prev.summary === item.summary) {
      acc[acc.length - 1] = item
      return acc
    }
    acc.push(item)
    return acc
  }, [])
}

function compactSnapshotPayload(input: unknown) {
  if (!input || typeof input !== "object") return undefined
  const item = input as Record<string, unknown>
  return {
    note: typeof item.note === "string" ? clipBoard(item.note) : undefined,
    description: typeof item.description === "string" ? clipBoard(item.description) : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
    blockingReason: typeof item.blockingReason === "string" ? clipBoard(item.blockingReason) : undefined,
    error: typeof item.error === "string" ? clipBoard(item.error) : undefined,
    activeRunID: typeof item.activeRunID === "string" ? item.activeRunID : undefined,
  }
}

function compactArtifactPayload(kind: string, input: unknown) {
  if (!input || typeof input !== "object") return undefined
  const item = input as Record<string, unknown>
  if (kind === "log") {
    return {
      command: typeof item.command === "string" ? item.command : undefined,
      code: typeof item.code === "number" ? item.code : undefined,
      output: typeof item.output === "string" ? clipBoard(item.output) : undefined,
    }
  }
  if (kind === "report") {
    return Object.fromEntries(
      Object.entries(item).map(([key, value]) => [
        key,
        typeof value === "string" ? clipBoard(value) : value,
      ]),
    )
  }
  return item
}

function boardChecks(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const parsed = EvaluationCheck.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

function viewBoardDelivery(
  row:
    | (typeof OrchestratorDeliveryTable.$inferSelect)
    | undefined,
) {
  if (!row) return undefined
  const result = (row.result ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    status: row.status,
    summary: clipBoard(row.summary),
    result: {
      summary: clipBoard(String(result.summary ?? row.summary)),
      changedFiles: Array.isArray(result.changed_files)
        ? result.changed_files.filter((item): item is string => typeof item === "string").slice(0, BOARD_CHANGED_FILE_LIMIT)
        : [],
      diffs: [],
      artifacts: Array.isArray(result.artifacts) ? result.artifacts.slice(0, 12) : [],
      publish: result.publish && typeof result.publish === "object" ? result.publish : undefined,
    },
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function viewBoardEvaluation(
  row:
    | (typeof OrchestratorEvaluationTable.$inferSelect)
    | undefined,
) {
  if (!row) return undefined
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    deliveryID: row.delivery_id ?? undefined,
    status: row.status,
    verdict: row.verdict,
    summary: clipBoard(row.summary),
    checks: boardChecks(row.checks),
    time: {
      created: row.time_created,
      updated: row.time_updated,
      completed: row.time_completed ?? undefined,
    },
  }
}

function boardFailure(input: {
  task: typeof OrchestratorTaskTable.$inferSelect
  run: (typeof OrchestratorRunTable.$inferSelect) | undefined
  interactions: Array<typeof OrchestratorInteractionRequestTable.$inferSelect>
  evaluation: (typeof OrchestratorEvaluationTable.$inferSelect) | undefined
}) {
  const interaction = input.interactions[0]
  if (interaction) {
    return {
      source: "interaction" as const,
      title: interaction.title,
      summary:
        input.interactions.length > 1
          ? `${clipBoard(interaction.body)}\n\n${input.interactions.length} pending interactions need attention.`
          : clipBoard(interaction.body),
      checks: undefined,
    }
  }
  if (input.evaluation && input.evaluation.status !== "passed") {
    return {
      source: "evaluation" as const,
      title: "Latest acceptance failed",
      summary: clipBoard(input.evaluation.summary),
      checks: boardChecks(input.evaluation.checks),
    }
  }
  if (input.run?.error) {
    return {
      source: "run" as const,
      title: "Current run failed",
      summary: clipBoard(input.run.error),
      checks: undefined,
    }
  }
  if (input.task.error) {
    return {
      source: "task" as const,
      title: "Task failed",
      summary: clipBoard(input.task.error),
      checks: undefined,
    }
  }
  const blocking = input.task.blocking_reason ?? input.run?.blocking_reason
  if (!blocking) return undefined
  return {
    source: input.run?.blocking_reason ? ("run" as const) : ("task" as const),
    title: "Task is blocked",
    summary: clipBoard(blocking),
    checks: undefined,
  }
}

function boardOverview(input: {
  task: typeof OrchestratorTaskTable.$inferSelect
  run: (typeof OrchestratorRunTable.$inferSelect) | undefined
  pendingInteractions: Array<typeof OrchestratorInteractionRequestTable.$inferSelect>
  candidateDelivery: (typeof OrchestratorDeliveryTable.$inferSelect) | undefined
  acceptedDelivery: (typeof OrchestratorDeliveryTable.$inferSelect) | undefined
  evaluation: (typeof OrchestratorEvaluationTable.$inferSelect) | undefined
  currentFailure:
    | {
        source: "task" | "run" | "interaction" | "evaluation"
        title: string
        summary: string
        checks?: Array<z.infer<typeof EvaluationCheck>>
      }
    | undefined
}) {
  const active = ["queued", "planning", "running", "evaluating", "delivering"].includes(input.task.status)
  const canResume = Boolean(input.run) && !active && input.pendingInteractions.length === 0
  const headline =
    input.pendingInteractions.length > 0
      ? "Waiting on human input"
      : input.task.status === "completed"
        ? "Accepted delivery is ready"
        : input.task.status === "delivering"
          ? "Publishing the accepted delivery"
        : input.task.status === "failed"
          ? "Current attempt failed acceptance"
          : input.task.status === "cancelled"
            ? "Task was cancelled"
            : input.task.status === "blocked"
              ? "Task is blocked"
              : input.task.status === "evaluating"
                ? "Evaluating the latest candidate delivery"
                : input.task.status === "running"
                  ? "Task is actively progressing"
                  : "Task is queued"
  const summary =
    input.pendingInteractions.length > 0
      ? `${input.pendingInteractions.length} interaction${input.pendingInteractions.length > 1 ? "s" : ""} need attention before the task can continue.`
      : input.task.status === "completed" && input.acceptedDelivery
        ? clipBoard(input.acceptedDelivery.summary)
        : input.task.status === "delivering" && input.candidateDelivery
          ? clipBoard(input.candidateDelivery.summary)
        : input.currentFailure?.summary ??
          (input.task.status === "evaluating"
            ? "Execution finished. Acceptance checks are running against the latest delivery."
            : input.candidateDelivery
              ? clipBoard(input.candidateDelivery.summary)
              : input.run
                ? `Current run is in ${input.run.phase}.`
                : "Task is ready for the first run.")
  const nextStep =
    input.pendingInteractions.length > 0
      ? {
          kind: "resolve_blocker" as const,
          title: "Resolve the pending interaction",
          detail: "Reply to the permission or question request to unblock the task.",
        }
      : input.task.status === "failed"
        ? {
            kind: "replan" as const,
            title: "Replan from the latest failure",
            detail: "Review the failed acceptance result, tighten the scope if needed, then replan or retry.",
          }
        : input.task.status === "cancelled"
          ? {
              kind: "retry" as const,
              title: "Retry if the task should continue",
              detail: "The task is cancelled. Retry will queue a new run from the latest context.",
            }
            : input.task.status === "completed"
              ? {
                  kind: "review_delivery" as const,
                  title: "Review the accepted delivery",
                  detail: "Inspect the accepted result, changed files, and evaluation evidence before closing the loop.",
                }
              : input.task.status === "delivering"
                ? {
                    kind: "observe" as const,
                    title: "Wait for delivery exports",
                    detail: "Delivery artifacts are being published and summarized.",
                  }
              : active
              ? {
                  kind: "observe" as const,
                  title: "Monitor the active run",
                  detail: "Watch progress, handle blockers quickly, and keep follow-up instructions concise.",
                }
              : {
                  kind: "message" as const,
                  title: "Add the next instruction",
                  detail: "Use natural language to refine goals, preferences, or plan hints before resuming the task.",
                }

  return {
    headline,
    summary,
    currentFailure: input.currentFailure,
    nextStep,
    controls: {
      canRetry: canResume,
      canReplan: canResume && Boolean(input.task.active_plan_version_id ?? input.run?.plan_version_id),
      canCancel: Boolean(input.run) && ["queued", "planning", "running", "evaluating", "blocked"].includes(input.task.status),
    },
  }
}

function setPreference(input: {
  taskID: string
  userID?: string
  key: string
  value: string
  scope?: Preference.Scope
}) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  Preference.set({
    projectID: task.project_id,
    taskID: task.id,
    sessionID: task.session_id ?? undefined,
    userID: input.userID,
    key: input.key,
    value: input.value,
    scope: input.scope ?? "global",
    source: "user_message",
    confidence: 100,
  })
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
    const primary = Memory.search({
      query,
      projectId: task.project_id,
      sessionID: task.session_id ?? undefined,
      scope: "all",
      limit: 5,
    })
    // Secondary search using first line of request for broader recall
    const requestLine = task.request.split("\n").find(Boolean)?.trim()
    if (!requestLine || requestLine === query) return primary
    const secondary = Memory.search({
      query: requestLine.slice(0, 120),
      projectId: task.project_id,
      sessionID: task.session_id ?? undefined,
      scope: "all",
      limit: 3,
    })
    // Merge and deduplicate by chunkId
    const seen = new Set(primary.map((item) => item.chunkId))
    for (const item of secondary) {
      if (!seen.has(item.chunkId)) {
        primary.push(item)
        seen.add(item.chunkId)
      }
    }
    return primary.slice(0, 8)
  } catch {
    return []
  }
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
  const scoped = pref.match(/^(global|session)\s+([a-zA-Z0-9._-]+)\s*[:=]\s*(.+)$/i)
  if (scoped) {
    return {
      scope: scoped[1].toLowerCase() as Preference.Scope,
      key: scoped[2],
      value: scoped[3].trim(),
    }
  }
  const match = pref.match(/^([a-zA-Z0-9._-]+)\s*[:=]\s*(.+)$/)
  if (!match) return undefined
  return {
    scope: "global" as const,
    key: match[1],
    value: match[2].trim(),
  }
}
