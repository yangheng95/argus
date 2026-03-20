import { OrchestratorChannelBindingTable } from "@/orchestrator/orchestrator.sql"
import { OrchestratorService } from "@/orchestrator/service"
import { ControlMessage } from "@/control/message"
import { ControlMessageInput, ControlMessageResult } from "@/control/message-schema"
import { Database, and, eq } from "@/storage/db"
import z from "zod"
import { ChannelId } from "./catalog"

export const MessageInput = z.object({
  platform: ChannelId,
  channel: z.string().min(1),
  thread: z.string().min(1),
  text: z.string(),
  user_id: z.string().optional(),
  request_id: z.string().optional(),
  source: z.string().optional(),
  executor: z.enum(["opencode", "codex", "claude-code"]).optional(),
  allow_create: z.boolean().default(true),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const MessageResult = ControlMessageResult

export namespace ChannelIngress {
  export async function message(raw: z.input<typeof MessageInput>) {
    const input = MessageInput.parse(raw)
    const binding = find(input.platform, input.channel, input.thread)
    if (!binding && !input.allow_create) {
      return MessageResult.parse({
        kind: "panel_response",
        message: "No task is bound to this channel thread. Start a new thread to create a task.",
      })
    }

    // Deterministic interaction reply: if the bound task has a pending
    // interaction, route the message directly instead of going through LLM.
    if (binding) {
      const result = await tryReplyInteraction(binding.task_id, input.text)
      if (result) return MessageResult.parse(result)
    }

    return MessageResult.parse(
      await ControlMessage.handle(ControlMessageInput.parse({
        surface: input.platform,
        text: input.text,
        taskID: binding?.task_id ?? undefined,
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
}

async function tryReplyInteraction(
  taskID: string,
  text: string,
): Promise<z.infer<typeof ControlMessageResult> | undefined> {
  const interactions = await OrchestratorService.listTaskInteractions(taskID)
  const pending = interactions.find((item) => item.status === "pending")
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

function find(platform: string, channel: string, thread: string) {
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

function meta(input: z.infer<typeof MessageInput>) {
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
