import z from "zod"

export const ControlLocalAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_executor"),
    executor: z.enum(["opencode", "codex", "claude-code"]),
  }),
  z.object({
    type: z.literal("select_task"),
    taskID: z.string(),
  }),
  z.object({
    type: z.literal("select_session"),
    sessionID: z.string(),
  }),
  z.object({
    type: z.literal("invalidate_session"),
    sessionID: z.string(),
  }),
])

export const ControlMessageResult = z.object({
  kind: z.enum(["panel_response", "created", "message", "interaction", "progress", "task_list", "cancelled"]),
  message: z.string(),
  task_id: z.string().optional(),
  interaction_id: z.string().optional(),
  session_id: z.string().optional(),
  local_action: ControlLocalAction.optional(),
})

export const ControlMessageInput = z.object({
  surface: z.enum(["panel", "slack", "telegram", "discord"]),
  text: z.string(),
  taskID: z.string().optional(),
  sessionID: z.string().optional(),
  executor: z.enum(["opencode", "codex", "claude-code"]).optional(),
  channel: z.string().optional(),
  thread: z.string().optional(),
  user_id: z.string().optional(),
  request_id: z.string().optional(),
  source: z.string().optional(),
  allow_create: z.boolean().default(true),
  metadata: z.record(z.string(), z.any()).optional(),
})
