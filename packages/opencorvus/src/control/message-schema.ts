import z from "zod"
import { ChannelSurface } from "@/channel/catalog"
import { isModelReference } from "@/provider/model-ref"

const STORED_ATTACHMENT_URL = /^\/attachment\/[^/\\?#]+\/[^/\\?#]+$/

export const ControlLocalAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_executor"),
    executor: z.enum(["opencorvus", "codex", "claude-code"]),
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

export const ControlAttachment = z.object({
  mime: z.string(),
  url: z.string(),
  filename: z.string().optional(),
})

export const ControlStoredAttachment = ControlAttachment.extend({
  url: z
    .string()
    .regex(
      STORED_ATTACHMENT_URL,
      "Control result attachments must reference stored /attachment/<projectID>/<name> resources",
    ),
})

export const ControlMessageResult = z.object({
  kind: z.enum(["panel_response", "created", "message", "interaction", "progress", "task_list", "cancelled"]),
  message: z.string(),
  task_id: z.string().optional(),
  interaction_id: z.string().optional(),
  session_id: z.string().optional(),
  local_action: ControlLocalAction.optional(),
  attachments: ControlStoredAttachment.array().optional(),
})

export const ControlMessageInput = z.object({
  surface: ChannelSurface,
  text: z.string(),
  taskID: z.string().optional(),
  sessionID: z.string().optional(),
  executor: z.enum(["opencorvus", "codex", "claude-code"]).optional(),
  model: z
    .string()
    .refine(isModelReference, {
      message: 'Model must be in the format "provider/model".',
    })
    .optional(),
  channel: z.string().optional(),
  thread: z.string().optional(),
  user_id: z.string().optional(),
  request_id: z.string().optional(),
  source: z.string().optional(),
  allow_create: z.boolean().default(true),
  metadata: z.record(z.string(), z.any()).optional(),
  attachments: ControlAttachment.array().optional(),
})
