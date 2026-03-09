import z from "zod"

export const GoalStatus = z.enum(["active", "completed", "blocked", "failed"])
export const PhaseKind = z.enum(["plan", "execute", "verify"])
export const PhaseStatus = z.enum(["pending", "in_progress", "completed", "failed"])
export const RunStatus = z.enum(["running", "completed", "failed"])
export const PreferenceScope = z.enum(["project", "user"])

export const Goal = z.object({
  id: z.string(),
  title: z.string(),
  request: z.string(),
  acceptance: z.string(),
  status: GoalStatus,
  sessionId: z.string().optional(),
  round: z.number().int().nonnegative(),
  maxRounds: z.number().int().positive(),
  lastGap: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})

export const Phase = z.object({
  id: z.string(),
  goalId: z.string(),
  kind: PhaseKind,
  title: z.string(),
  agent: z.string(),
  status: PhaseStatus,
  position: z.number().int().nonnegative(),
  note: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})

export const Run = z.object({
  id: z.string(),
  goalId: z.string(),
  phaseId: z.string(),
  sessionId: z.string(),
  messageId: z.string().optional(),
  agent: z.string(),
  status: RunStatus,
  output: z.string().optional(),
  summary: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})

export const Preference = z.object({
  id: z.string(),
  scope: PreferenceScope,
  label: z.string(),
  value: z.string(),
  createdAt: z.number().int(),
})

export const State = z.object({
  goals: Goal.array().default([]),
  phases: Phase.array().default([]),
  runs: Run.array().default([]),
  preferences: Preference.array().default([]),
})

export type Goal = z.infer<typeof Goal>
export type Phase = z.infer<typeof Phase>
export type Run = z.infer<typeof Run>
export type Preference = z.infer<typeof Preference>
export type State = z.infer<typeof State>

export function now() {
  return Date.now()
}
