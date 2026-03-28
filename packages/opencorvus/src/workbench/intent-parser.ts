import z from "zod"
import { generateObject } from "ai"
import { Preference } from "@/preference"
import { Provider } from "@/provider/provider"

export const MessageInput = z.object({
  taskID: z.string(),
  text: z.string(),
  source: z.string().default("user_message"),
  userID: z.string().optional(),
})

export const WorkbenchIntent = z.object({
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

export async function interpretWithLLM(input: z.infer<typeof MessageInput>) {
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

export function inferPreferenceScope(text: string): Exclude<Preference.Scope, "cwd"> {
  const lower = text.toLowerCase()
  if (/(this session|for this session|only for now|temporarily|temporary|暂时|这次会话|本次会话|仅本次)/.test(lower)) {
    return "session"
  }
  return "global"
}

export function parseCommand(text: string, prefix: string) {
  if (!text.toLowerCase().startsWith(prefix)) return undefined
  const value = text.slice(prefix.length).trim()
  if (!value) return undefined
  return value
}

export function parsePreference(text: string) {
  const pref = parseCommand(text, "/pref")
  if (!pref) return undefined
  const scoped = pref.match(/^(global|session)\s+([a-zA-Z0-9._-]+)\s*[:=]\s*(.+)$/i)
  if (scoped) {
    return {
      scope: scoped[1].toLowerCase() as Exclude<Preference.Scope, "cwd">,
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
