import z from "zod"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { MessageV2 } from "@/session/message"
import { Database, and, asc, eq } from "@/storage/db"
import { ControlMessageTable } from "./control.sql"
import { ChannelSurface } from "@/channel/catalog"

const TimelineAttachment = z.object({
  mime: z.string(),
  url: z.string(),
  filename: z.string().optional(),
})

const TimelineStoredTextPart = MessageV2.TextPart.omit({
  id: true,
  sessionID: true,
  messageID: true,
})

const TimelineStoredReasoningPart = MessageV2.ReasoningPart.omit({
  id: true,
  sessionID: true,
  messageID: true,
})

const TimelineStoredFilePart = MessageV2.FilePart.omit({
  id: true,
  sessionID: true,
  messageID: true,
})

const TimelineStoredToolPart = MessageV2.ToolPart.omit({
  id: true,
  sessionID: true,
  messageID: true,
})

const TimelineStoredPatchPart = MessageV2.PatchPart.omit({
  id: true,
  sessionID: true,
  messageID: true,
})

const TimelineStoredSubtaskPart = MessageV2.SubtaskPart.omit({
  id: true,
  sessionID: true,
  messageID: true,
})

const TimelineStoredCompactionPart = MessageV2.CompactionPart.omit({
  id: true,
  sessionID: true,
  messageID: true,
})

export const TimelineStoredPart = z.discriminatedUnion("type", [
  TimelineStoredTextPart,
  TimelineStoredReasoningPart,
  TimelineStoredFilePart,
  TimelineStoredToolPart,
  TimelineStoredPatchPart,
  TimelineStoredSubtaskPart,
  TimelineStoredCompactionPart,
])

const TimelinePart = z.discriminatedUnion("type", [
  MessageV2.TextPart,
  MessageV2.ReasoningPart,
  MessageV2.FilePart,
  MessageV2.ToolPart,
  MessageV2.PatchPart,
  MessageV2.SubtaskPart,
  MessageV2.CompactionPart,
])

export const TimelineQuery = z.object({
  taskID: z.string().optional(),
  sessionID: z.string().optional(),
  surface: ChannelSurface.optional(),
})

export const TimelineMessage = z.object({
  info: z.object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    source: z.string().optional(),
    surface: z.string(),
    taskID: z.string().optional(),
    sessionID: z.string().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  }),
  parts: z.array(TimelinePart),
})

const AppendInput = z.object({
  taskID: z.string().optional(),
  sessionID: z.string().optional(),
  surface: z.string(),
  source: z.string(),
  channel: z.string().optional(),
  thread: z.string().optional(),
  userID: z.string().optional(),
  requestID: z.string().optional(),
  entries: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      text: z.string(),
      time_created: z.number().int().optional(),
      parts: TimelineStoredPart.array().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
})

export namespace ControlTimeline {
  export function list(raw: z.input<typeof TimelineQuery>) {
    const input = TimelineQuery.parse(raw)
    const rows = Database.use((db) =>
      input.taskID
        ? db
            .select()
            .from(ControlMessageTable)
            .where(and(eq(ControlMessageTable.scope, "task"), eq(ControlMessageTable.scope_id, input.taskID)))
            .orderBy(asc(ControlMessageTable.time_created))
            .all()
        : input.sessionID
          ? db
              .select()
              .from(ControlMessageTable)
              .where(and(eq(ControlMessageTable.scope, "session"), eq(ControlMessageTable.scope_id, input.sessionID)))
              .orderBy(asc(ControlMessageTable.time_created))
              .all()
          : db
              .select()
              .from(ControlMessageTable)
              .where(and(eq(ControlMessageTable.scope, "global"), eq(ControlMessageTable.scope_id, input.surface ?? "panel")))
              .orderBy(asc(ControlMessageTable.time_created))
              .all(),
    )
    return TimelineMessage.array().parse(rows.map(view))
  }

  export function append(raw: z.input<typeof AppendInput>) {
    const input = AppendInput.parse(raw)
    if (input.entries.length === 0) return
    const target = scope(input)
    const now = Date.now()
    Database.transaction((db) => {
      for (const item of input.entries) {
        const created = item.time_created ?? now
        const metadata = {
          ...(item.metadata ?? {}),
          ...(item.parts?.length ? { parts: item.parts } : {}),
        }
        db.insert(ControlMessageTable)
          .values({
            id: Identifier.ascending("message"),
            project_id: Instance.project.id,
            scope: target.scope,
            scope_id: target.id,
            task_id: input.taskID,
            session_id: input.sessionID,
            surface: input.surface,
            role: item.role,
            source: input.source,
            channel: input.channel,
            thread: input.thread,
            user_id: input.userID,
            request_id: input.requestID,
            text: item.text,
            metadata,
            time_created: created,
            time_updated: created,
          })
          .run()
      }
    })
  }
}

function view(row: typeof ControlMessageTable.$inferSelect) {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata
      : undefined
  const attachments = TimelineAttachment.array().safeParse(metadata?.attachments).data ?? []
  const storedParts = TimelineStoredPart.array().safeParse(metadata?.parts).data
  const parts = storedParts
    ? [
        ...storedParts.map((part, index) => inflatePart(row, part, index)),
        ...attachments
          .filter((item) => !storedParts.some((part) =>
            part.type === "file" &&
            part.mime === item.mime &&
            part.url === item.url &&
            (part.filename ?? "") === (item.filename ?? ""),
          ))
          .map((item, index) => ({
            id: `${row.id}_attachment_${index + 1}`,
            messageID: row.id,
            sessionID: row.session_id ?? "",
            type: "file" as const,
            mime: item.mime,
            url: item.url,
            ...(item.filename ? { filename: item.filename } : {}),
          })),
      ]
    : [
        {
          id: `${row.id}_text`,
          messageID: row.id,
          sessionID: row.session_id ?? "",
          type: "text" as const,
          text: row.text,
        },
        ...attachments.map((item, index) => ({
          id: `${row.id}_file_${index + 1}`,
          messageID: row.id,
          sessionID: row.session_id ?? "",
          type: "file" as const,
          mime: item.mime,
          url: item.url,
          ...(item.filename ? { filename: item.filename } : {}),
        })),
      ]
  return {
    info: {
      id: row.id,
      role: row.role,
      source: row.source,
      surface: row.surface,
      taskID: row.task_id ?? undefined,
      sessionID: row.session_id ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    },
    parts,
  }
}

function inflatePart(
  row: typeof ControlMessageTable.$inferSelect,
  part: z.infer<typeof TimelineStoredPart>,
  index: number,
): z.infer<typeof TimelinePart> {
  return {
    ...part,
    id: `${row.id}_part_${index + 1}`,
    messageID: row.id,
    sessionID: row.session_id ?? "",
  } as z.infer<typeof TimelinePart>
}

function scope(input: z.infer<typeof AppendInput>) {
  if (input.taskID) {
    return {
      scope: "task",
      id: input.taskID,
    } as const
  }
  if (input.sessionID) {
    return {
      scope: "session",
      id: input.sessionID,
    } as const
  }
  return {
    scope: "global",
    id: input.surface,
  } as const
}
