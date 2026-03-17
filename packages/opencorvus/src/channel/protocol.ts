import z from "zod"
import { ProjectBoard } from "@/orchestrator/model"
import { OrchestratorService } from "@/orchestrator/service"
import { MessageAttachmentInput, ChannelIngressInput, ChannelIngressResult, ChannelIngress } from "./ingress"
import { ChannelId } from "./catalog"

const Version = z.literal("channel.v1")
const Bool = z
  .union([z.boolean(), z.string()])
  .transform((input) => typeof input === "boolean" ? input : ["1", "true", "yes", "on"].includes(input.toLowerCase()))

const Thread = z.object({
  platform: ChannelId,
  channel: z.string().min(1),
  thread: z.string().min(1),
})

const User = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
})

const Context = z.object({
  task_id: z.string().optional(),
  allow_create: z.boolean().default(true),
  allow_session_mutation: z.boolean().default(false),
  bind: z.boolean().default(true),
})

const Binding = Thread.extend({
  task_id: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export const ChannelIngressEnvelope = Thread.extend({
  type: z.literal("channel_ingress"),
  version: Version,
  request_id: z.string().min(1),
  user: User.optional(),
  message: z.object({
    id: z.string().optional(),
    text: z.string(),
    attachments: MessageAttachmentInput.array().default([]),
  }),
  context: Context.default(() => ({ allow_create: true, allow_session_mutation: false, bind: true })),
  metadata: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
  executor: ChannelIngressInput.shape.executor.optional(),
})

export const ChannelEgressEnvelope = Thread.extend({
  type: z.literal("channel_egress"),
  version: Version,
  request_id: z.string(),
  result: ChannelIngressResult,
  context: z.object({
    task_id: z.string().optional(),
    interaction_id: z.string().optional(),
    session_id: z.string().optional(),
    bound: z.boolean(),
  }),
})

export const ChannelThreadStateQuery = Thread.extend({
  sync: Bool.default(true),
})

export const ChannelThreadState = Thread.extend({
  type: z.literal("channel_thread_state"),
  version: Version,
  binding: Binding.nullable(),
  board: z.record(z.string(), z.unknown()).nullable(),
})

export const ChannelTaskListQuery = z.object({
  platform: ChannelId.optional(),
  channel: z.string().optional(),
  thread: z.string().optional(),
  q: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const ChannelTaskList = z.object({
  type: z.literal("channel_task_list"),
  version: Version,
  binding: Binding.nullable().optional(),
  board: ProjectBoard,
})

export const ChannelThreadSelectInput = Thread.extend({
  task_id: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export const ChannelThreadEvent = Thread.extend({
  type: z.literal("channel_event"),
  version: Version,
  event: z.object({
    event_id: z.string(),
    task_id: z.string().optional(),
    run_id: z.string().optional(),
    type: z.string(),
    timestamp: z.number(),
    summary: z.string(),
    payload: z.record(z.string(), z.unknown()),
  }),
})

export namespace ChannelProtocol {
  export async function ingress(raw: z.input<typeof ChannelIngressEnvelope>) {
    const input = ChannelIngressEnvelope.parse(raw)
    const result = await ChannelIngress.message({
      platform: input.platform,
      channel: input.channel,
      thread: input.thread,
      text: input.message.text,
      task_id: input.context.task_id,
      user_id: input.user?.id,
      request_id: input.request_id,
      source: input.source,
      executor: input.executor,
      allow_create: input.context.allow_create,
      allow_session_mutation: input.context.allow_session_mutation,
      bind: input.context.bind,
      attachments: input.message.attachments,
      metadata: {
        ...(input.metadata ?? {}),
        protocol: {
          type: input.type,
          version: input.version,
          ...(input.message.id ? { message_id: input.message.id } : {}),
        },
        ...(input.user?.name ? { channel_user_name: input.user.name } : {}),
      },
    })
    const binding = ChannelIngress.findBinding(input.platform, input.channel, input.thread)
    return ChannelEgressEnvelope.parse({
      type: "channel_egress",
      version: "channel.v1",
      request_id: input.request_id,
      platform: input.platform,
      channel: input.channel,
      thread: input.thread,
      result,
      context: {
        task_id: result.task_id ?? input.context.task_id ?? binding?.task_id,
        interaction_id: result.interaction_id,
        session_id: result.session_id,
        bound: !!binding,
      },
    })
  }

  export async function state(raw: z.input<typeof ChannelThreadStateQuery>) {
    const input = ChannelThreadStateQuery.parse(raw)
    const binding = ChannelIngress.findBinding(input.platform, input.channel, input.thread)
    if (!binding) {
      return ChannelThreadState.parse({
        type: "channel_thread_state",
        version: "channel.v1",
        platform: input.platform,
        channel: input.channel,
        thread: input.thread,
        binding: null,
        board: null,
      })
    }
    return ChannelThreadState.parse({
      type: "channel_thread_state",
      version: "channel.v1",
      platform: input.platform,
      channel: input.channel,
      thread: input.thread,
      binding: viewBinding(binding),
      board: await OrchestratorService.getBoard(binding.task_id, { sync: input.sync }),
    })
  }

  export async function tasks(raw: z.input<typeof ChannelTaskListQuery>) {
    const input = ChannelTaskListQuery.parse(raw)
    const binding =
      input.platform && input.channel && input.thread
        ? ChannelIngress.findBinding(input.platform, input.channel, input.thread)
        : undefined
    return ChannelTaskList.parse({
      type: "channel_task_list",
      version: "channel.v1",
      ...(binding ? { binding: viewBinding(binding) } : {}),
      board: await OrchestratorService.getProjectBoard({
        limit: input.limit,
        query: input.q,
        status: input.status,
      }),
    })
  }

  export async function select(raw: z.input<typeof ChannelThreadSelectInput>) {
    const input = ChannelThreadSelectInput.parse(raw)
    await OrchestratorService.getTask(input.task_id)
    ChannelIngress.bindThread({
      platform: input.platform,
      channel: input.channel,
      thread: input.thread,
      taskID: input.task_id,
      payload: input.payload,
    })
    return state({
      platform: input.platform,
      channel: input.channel,
      thread: input.thread,
      sync: false,
    })
  }

  export function event(
    raw: z.input<typeof Thread>,
    event: z.input<typeof ChannelThreadEvent.shape.event>,
  ) {
    const input = Thread.parse(raw)
    return ChannelThreadEvent.parse({
      type: "channel_event",
      version: "channel.v1",
      platform: input.platform,
      channel: input.channel,
      thread: input.thread,
      event,
    })
  }
}

function viewBinding(input: NonNullable<ReturnType<typeof ChannelIngress.findBinding>>) {
  return Binding.parse({
    platform: input.platform,
    channel: input.channel,
    thread: input.thread,
    task_id: input.task_id,
    payload: input.payload ?? undefined,
  })
}
