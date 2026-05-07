import { EngineChannelBindingTable } from "@/engine/engine.sql"
import { EngineService } from "@/task-api"
import { ControlMessage } from "@/control/message"
import { ControlMessageInput, ControlMessageResult } from "@/control/message-schema"
import { Database, and, eq } from "@/storage/db"
import z from "zod"
import { ChannelId } from "./catalog"

export const MessageAttachmentInput = z.object({
  filename: z.string().trim().min(1),
  mime: z.string().trim().min(1),
  url: z.string().optional(),
  data: z.string().optional(),
})

export const ChannelIngressInput = z.object({
  platform: ChannelId,
  channel: z.string().min(1),
  thread: z.string().min(1),
  text: z.string(),
  task_id: z.string().optional(),
  user_id: z.string().optional(),
  request_id: z.string().optional(),
  source: z.string().optional(),
  executor: z.enum(["mirrorcode", "codex", "claude-code"]).optional(),
  allow_create: z.boolean().default(true),
  allow_session_mutation: z.boolean().default(false),
  bind: z.boolean().default(true),
  attachments: MessageAttachmentInput.array().default([]),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const ChannelIngressResult = ControlMessageResult

export namespace ChannelIngress {
  export async function message(raw: z.input<typeof ChannelIngressInput>) {
    const input = ChannelIngressInput.parse(raw)
    const binding = find(input.platform, input.channel, input.thread)
    if (!binding && !input.allow_create) {
      return ChannelIngressResult.parse({
        kind: "panel_response",
        message: "No task is bound to this channel thread. Start a new thread to create a task.",
      })
    }

    // Deterministic interaction reply: if the bound task has a pending
    // interaction, route the message directly instead of going through LLM.
    if (binding) {
      const result = await tryReplyInteraction(binding.task_id, input.text)
      if (result) return ChannelIngressResult.parse(result)
    }

    return ChannelIngressResult.parse(
      await ControlMessage.handle(ControlMessageInput.parse({
        surface: input.platform,
        text: input.text,
        taskID: input.task_id ?? binding?.task_id ?? undefined,
        executor: input.executor,
        channel: input.channel,
        thread: input.thread,
        user_id: input.user_id,
        request_id: input.request_id,
        source: input.source,
        allow_create: input.allow_create,
        metadata: meta(input),
      })),
    )
  }

  export function findBinding(platform: string, channel: string, thread: string) {
    return find(platform, channel, thread)
  }

  export function bindThread(input: {
    platform: string
    channel: string
    thread: string
    taskID: string
    payload?: Record<string, unknown>
  }) {
    const { EngineChannelBindingTable: T } = require("@/engine/engine.sql")
    const { Identifier } = require("@/id/id")
    Database.use((db) => {
      const existing = db
        .select({ task_id: T.task_id })
        .from(T)
        .where(
          and(
            eq(T.platform, input.platform),
            eq(T.channel, input.channel),
            eq(T.thread, input.thread),
          ),
        )
        .get()
      const now = Date.now()
      if (existing) {
        db.update(T)
          .set({ task_id: input.taskID, payload: input.payload ?? {}, time_updated: now })
          .where(
            and(
              eq(T.platform, input.platform),
              eq(T.channel, input.channel),
              eq(T.thread, input.thread),
            ),
          )
          .run()
      } else {
        db.insert(T)
          .values({
            id: Identifier.ascending("binding"),
            task_id: input.taskID,
            platform: input.platform,
            channel: input.channel,
            thread: input.thread,
            payload: input.payload ?? {},
            time_created: now,
            time_updated: now,
          })
          .run()
      }
    })
  }
}

async function tryReplyInteraction(
  taskID: string,
  text: string,
): Promise<z.infer<typeof ControlMessageResult> | undefined> {
  const interactions = await EngineService.listTaskInteractions(taskID)
  const pending = interactions.find((item) => item.status === "pending")
  if (!pending) return undefined

  const value = text.trim().toLowerCase()
  if (pending.type === "permission") {
    if (["allow", "approve", "yes", "y", "once"].includes(value)) {
      const result = await EngineService.replyInteraction(pending.id, { reply: "once", autoReply: false })
      return { kind: "interaction", message: "Permission granted.", task_id: taskID, interaction_id: result.id }
    }
    if (["always", "allow always", "approve always"].includes(value)) {
      const result = await EngineService.replyInteraction(pending.id, { reply: "always", autoReply: false })
      return { kind: "interaction", message: "Permission granted (always).", task_id: taskID, interaction_id: result.id }
    }
    if (["reject", "deny", "no", "n"].includes(value)) {
      const result = await EngineService.rejectInteraction(pending.id, { autoReply: false })
      return { kind: "interaction", message: "Permission rejected.", task_id: taskID, interaction_id: result.id }
    }
    // Unrecognized permission reply — fall through to LLM
    return undefined
  }

  // Question interaction — pass message text; service will derive answers
  const result = await EngineService.replyInteraction(pending.id, {
    autoReply: false,
    message: text,
  })
  return { kind: "interaction", message: "Answer recorded.", task_id: taskID, interaction_id: result.id }
}

function find(platform: string, channel: string, thread: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineChannelBindingTable)
      .where(
        and(
          eq(EngineChannelBindingTable.platform, platform),
          eq(EngineChannelBindingTable.channel, channel),
          eq(EngineChannelBindingTable.thread, thread),
        ),
      )
      .get(),
  )
}

function meta(input: z.infer<typeof ChannelIngressInput>) {
  const value = {
    platform: input.platform,
    channel: input.channel,
    thread: input.thread,
    ...(input.user_id ? { user_id: input.user_id } : {}),
    ...(input.metadata ?? {}),
  }
  if (input.platform === "slack") {
    return {
      channel: value,
      slack: {
        ...(input.user_id ? { user: input.user_id } : {}),
        ...(input.metadata ?? {}),
      },
    }
  }
  return {
    channel: value,
    [input.platform]: value,
  }
}
