import z from "zod"
import { ChannelSurface } from "@/channel/catalog"

export const ControlMessageAttachment = z.object({
  mime: z.string(),
  url: z.string(),
  filename: z.string().optional(),
})

const SetExecutorAction = z.object({
  type: z.literal("set_executor"),
  executor: z.enum(["opencode", "codex", "claude-code"]),
})

const SelectTaskAction = z.object({
  type: z.literal("select_task"),
  taskID: z.string(),
})

const SelectSessionAction = z.object({
  type: z.literal("select_session"),
  sessionID: z.string(),
})

const InvalidateSessionAction = z.object({
  type: z.literal("invalidate_session"),
  sessionID: z.string(),
})

export const ControlLocalAction = z.discriminatedUnion("type", [
  SetExecutorAction,
  SelectTaskAction,
  SelectSessionAction,
  InvalidateSessionAction,
])

export const PanelLocalAction = z.discriminatedUnion("type", [
  SetExecutorAction,
  SelectTaskAction,
])

export const ControlAttachment = z.object({
  mime: z.string(),
  url: z.string(),
  filename: z.string().optional(),
})

export const ControlMessageResult = z.object({
  kind: z.enum(["panel_response", "created", "message", "interaction", "progress", "task_list", "cancelled"]),
  message: z.string(),
  task_id: z.string().optional(),
  interaction_id: z.string().optional(),
  session_id: z.string().optional(),
  local_action: ControlLocalAction.optional(),
  attachments: ControlAttachment.array().optional(),
})

export const ControlMessageInput = z.object({
  surface: ChannelSurface,
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
  allow_session_mutation: z.boolean().default(false),
  attachments: ControlMessageAttachment.array().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const PanelMessageInput = ControlMessageInput.extend({
  surface: z.literal("panel"),
  sessionID: z.undefined().optional(),
  allow_session_mutation: z.literal(false).default(false),
})

export const PanelMessageResult = ControlMessageResult.omit({
  session_id: true,
  local_action: true,
}).extend({
  local_action: PanelLocalAction.optional(),
})
