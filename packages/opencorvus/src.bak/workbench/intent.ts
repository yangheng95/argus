import z from "zod"
import { generateObject } from "ai"
import { Provider } from "@/provider/provider"
import { GoalService } from "@/orchestrator/goal-service"
import { Database, eq } from "@/storage/db"
import { OrchestratorTaskTable, OrchestratorPlanVersionTable } from "@/orchestrator/orchestrator.sql"
import { recordNote } from "./note-store"

const MessageInput = z.object({
  taskID: z.string(),
  text: z.string(),
  source: z.string().default("user_message"),
  userID: z.string().optional(),
})

const WorkbenchIntent = z.object({
  kind: z.enum(["goal", "plan", "note"]),
  goals: z.array(z.string()).default([]),
  plan_hints: z.array(z.string()).default([]),
  note: z.string().nullable().default(null),
  should_resume: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.5),
})

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
      message: "Intent analysis failed; recorded as operator note without changing goals or plans.",
      should_resume: false,
    }
  }
  const resolved = interpreted.intent

  if (resolved.kind === "goal" && Array.isArray(resolved.goals) && resolved.goals.length > 0) {
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

  if (resolved.kind === "plan" && Array.isArray(resolved.plan_hints) && resolved.plan_hints.length > 0) {
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
- Use "goal" when the user adds or changes acceptance goals.
- Use "plan" when the user suggests how the task should be executed.
- Use "note" for everything else.
- Do not invent goals or plan hints that are not supported by the text.
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
