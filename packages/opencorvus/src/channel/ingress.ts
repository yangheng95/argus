import { OrchestratorChannelBindingTable, OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
import { OrchestratorService } from "@/orchestrator/service"
import { ControlMessage } from "@/control/message"
import { ControlMessageInput, ControlMessageResult } from "@/control/message-schema"
import { Database, and, eq } from "@/storage/db"
import { Identifier } from "@/id/id"
import z from "zod"
import { ChannelId } from "./catalog"

export const MessageAttachmentInput = z
  .object({
    mime: z.string(),
    url: z.string().optional(),
    data: z.string().optional(),
    filename: z.string().optional(),
  })
  .refine((item) => !!item.url || !!item.data, {
    message: "attachment url or data is required",
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
  executor: z.enum(["opencode", "codex", "claude-code"]).optional(),
  allow_create: z.boolean().default(true),
  allow_session_mutation: z.boolean().default(false),
  bind: z.boolean().default(true),
  attachments: MessageAttachmentInput.array().default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const ChannelIngressResult = ControlMessageResult

export namespace ChannelIngress {
  export async function message(raw: z.input<typeof ChannelIngressInput>) {
    const input = ChannelIngressInput.parse(raw)
    const binding = findBinding(input.platform, input.channel, input.thread)
    const taskID = input.task_id ?? binding?.task_id
    if (input.task_id && !taskExists(input.task_id)) {
      return ChannelIngressResult.parse({
        kind: "panel_response",
        message: `Task not found: ${input.task_id}`,
      })
    }
    if (input.task_id && input.bind !== false) {
      bindThread({
        platform: input.platform,
        channel: input.channel,
        thread: input.thread,
        taskID: input.task_id,
        payload: meta(input),
      })
    }
    if (!taskID && !input.allow_create) {
      return ChannelIngressResult.parse({
        kind: "panel_response",
        message: "No task is bound to this channel thread. Start a new thread to create a task.",
      })
    }

    // Deterministic interaction reply: if the bound task has a pending
    // interaction, route the message directly instead of going through LLM.
    if (taskID) {
      const result = await tryReplyInteraction(taskID, input.text, interactionID(input))
      if (result) return ChannelIngressResult.parse(result)
    }

    return ChannelIngressResult.parse(
      await ControlMessage.handle(ControlMessageInput.parse({
        surface: input.platform,
        text: input.text,
        taskID,
        executor: input.executor,
        channel: input.channel,
        thread: input.thread,
        user_id: input.user_id,
        request_id: input.request_id,
        source: input.source,
        allow_create: input.allow_create,
        allow_session_mutation: input.allow_session_mutation,
        attachments: input.attachments.map((item) => ({
          mime: item.mime,
          url: item.url ?? `data:${item.mime};base64,${item.data}`,
          ...(item.filename ? { filename: item.filename } : {}),
        })),
        metadata: meta(input),
      })),
    )
  }

  export function findBinding(platform: string, channel: string, thread: string) {
    return findBindingRow(platform, channel, thread)
  }

  export function bindThread(input: {
    platform: string
    channel: string
    thread: string
    taskID: string
    payload?: Record<string, unknown>
  }) {
    if (!taskExists(input.taskID)) {
      throw new Error(`Task not found: ${input.taskID}`)
    }
    const now = Date.now()
    return Database.use((db) =>
      db
        .insert(OrchestratorChannelBindingTable)
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
        .onConflictDoUpdate({
          target: [
            OrchestratorChannelBindingTable.platform,
            OrchestratorChannelBindingTable.channel,
            OrchestratorChannelBindingTable.thread,
          ],
          set: {
            task_id: input.taskID,
            payload: input.payload ?? {},
            time_updated: now,
          },
        })
        .run(),
    )
  }
}

async function tryReplyInteraction(
  taskID: string,
  text: string,
  interactionID?: string,
): Promise<z.infer<typeof ControlMessageResult> | undefined> {
  const interactions = await OrchestratorService.listTaskInteractions(taskID)
  const pending = interactionID
    ? interactions.find((item) => item.id === interactionID && item.status === "pending")
    : interactions.find((item) => item.status === "pending")
  if (!pending) return undefined

  const value = text.trim().toLowerCase()
  if (pending.type === "permission") {
    if (["allow", "approve", "yes", "y", "once"].includes(value)) {
      const result = await OrchestratorService.replyInteraction(pending.id, { reply: "once" })
      return { kind: "interaction", message: "Permission granted.", task_id: taskID, interaction_id: result.id }
    }
    if (["always", "allow always", "approve always"].includes(value)) {
      const result = await OrchestratorService.replyInteraction(pending.id, { reply: "always" })
      return { kind: "interaction", message: "Permission granted (always).", task_id: taskID, interaction_id: result.id }
    }
    if (["reject", "deny", "no", "n"].includes(value)) {
      const result = await OrchestratorService.rejectInteraction(pending.id, {})
      return { kind: "interaction", message: "Permission rejected.", task_id: taskID, interaction_id: result.id }
    }
    // Unrecognized permission reply — fall through to LLM
    return undefined
  }

  // Question interaction — pass message text; service will derive answers
  const result = await OrchestratorService.replyInteraction(pending.id, {
    message: text,
  })
  return { kind: "interaction", message: "Answer recorded.", task_id: taskID, interaction_id: result.id }
}

function findBindingRow(platform: string, channel: string, thread: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorChannelBindingTable)
      .where(
        and(
          eq(OrchestratorChannelBindingTable.platform, platform),
          eq(OrchestratorChannelBindingTable.channel, channel),
          eq(OrchestratorChannelBindingTable.thread, thread),
        ),
      )
      .get(),
  )
}

function taskExists(taskID: string) {
  return !!Database.use((db) =>
    db
      .select({ id: OrchestratorTaskTable.id })
      .from(OrchestratorTaskTable)
      .where(eq(OrchestratorTaskTable.id, taskID))
      .get(),
  )
}

function meta(input: z.infer<typeof ChannelIngressInput>) {
  const value = {
    platform: input.platform,
    channel: input.channel,
    thread: input.thread,
    ...(input.task_id ? { task_id: input.task_id } : {}),
    ...(input.user_id ? { user_id: input.user_id } : {}),
    ...(input.attachments.length ? { attachments: input.attachments.map((item) => ({ mime: item.mime, filename: item.filename })) } : {}),
    ...(input.metadata ?? {}),
  }
  if (input.platform === "slack") {
    return {
      ...(input.metadata ?? {}),
      channel: value,
      slack: {
        ...(input.user_id ? { user: input.user_id } : {}),
        ...(input.metadata ?? {}),
      },
    }
  }
  return {
    ...(input.metadata ?? {}),
    channel: value,
    [input.platform]: value,
  }
}

function interactionID(input: z.infer<typeof ChannelIngressInput>) {
  if (!input.metadata) return undefined
  if (typeof input.metadata.interactionID === "string" && input.metadata.interactionID) return input.metadata.interactionID
  const channel = input.metadata.channel
  if (channel && typeof channel === "object" && !Array.isArray(channel)) {
    const ch = channel as Record<string, unknown>
    if (typeof ch.interactionID === "string" && ch.interactionID) return ch.interactionID
  }
  const scoped = input.metadata[input.platform]
  if (scoped && typeof scoped === "object" && !Array.isArray(scoped)) {
    const sc = scoped as Record<string, unknown>
    if (typeof sc.interactionID === "string" && sc.interactionID) return sc.interactionID
  }
  return undefined
}
