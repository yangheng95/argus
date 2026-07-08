import z from "zod"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Database, and, asc, eq } from "@/storage/db"
import { ControlMessageTable } from "./control.sql"
import { ChannelSurface } from "@/channel/catalog"
import { ControlStoredAttachment } from "./message-schema"
import { timelineOrderKey } from "@/timeline/order"

export const TimelineQuery = z.object({
  taskID: z.string().optional(),
  sessionID: z.string().optional(),
  surface: ChannelSurface.optional(),
})

export const TimelineMessage = z.object({
  info: z.object({
    id: z.string(),
    orderKey: z.string().min(1),
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
  parts: z.array(
    z.discriminatedUnion("type", [
      z.object({
        id: z.string(),
        type: z.literal("text"),
        text: z.string(),
      }),
      z.object({
        id: z.string(),
        type: z.literal("file"),
        mime: z.string(),
        url: z.string(),
        filename: z.string().optional(),
      }),
    ]),
  ),
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
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
})

const DeleteProjectMessagesInput = z.object({
  projectID: z.string(),
})

export namespace ControlTimeline {
  export function list(raw: z.input<typeof TimelineQuery>) {
    const input = TimelineQuery.parse(raw)
    const projectID = Instance.project.id
    const rows = Database.use((db) =>
      input.taskID
        ? db
            .select()
            .from(ControlMessageTable)
            .where(
              and(
                eq(ControlMessageTable.project_id, projectID),
                eq(ControlMessageTable.scope, "task"),
                eq(ControlMessageTable.scope_id, input.taskID),
              ),
            )
            .orderBy(asc(ControlMessageTable.time_created), asc(ControlMessageTable.id))
            .all()
        : input.sessionID
          ? db
              .select()
              .from(ControlMessageTable)
              .where(
                and(
                  eq(ControlMessageTable.project_id, projectID),
                  eq(ControlMessageTable.scope, "session"),
                  eq(ControlMessageTable.scope_id, input.sessionID),
                ),
              )
              .orderBy(asc(ControlMessageTable.time_created), asc(ControlMessageTable.id))
              .all()
          : db
              .select()
              .from(ControlMessageTable)
              .where(
                and(
                  eq(ControlMessageTable.project_id, projectID),
                  eq(ControlMessageTable.scope, "global"),
                  eq(ControlMessageTable.scope_id, input.surface ?? "panel"),
                ),
              )
              .orderBy(asc(ControlMessageTable.time_created), asc(ControlMessageTable.id))
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
            metadata: item.metadata,
            time_created: now,
            time_updated: now,
          })
          .run()
      }
    })
  }

  export function deleteProjectMessages(
    raw: z.input<typeof DeleteProjectMessagesInput>,
    db?: Database.TxOrDb,
  ) {
    const input = DeleteProjectMessagesInput.parse(raw)
    const write = (target: Database.TxOrDb) =>
      target.delete(ControlMessageTable).where(eq(ControlMessageTable.project_id, input.projectID)).run()
    if (db) return write(db)
    return Database.use(write)
  }
}

function view(row: typeof ControlMessageTable.$inferSelect) {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : undefined
  const attachments = ControlStoredAttachment.array().safeParse(metadata?.attachments).data ?? []
  return {
    info: {
      id: row.id,
      orderKey: timelineOrderKey({
        domain: "control",
        time: row.time_created,
        id: row.id,
      }),
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
    parts: [
      {
        id: `${row.id}_text`,
        type: "text" as const,
        text: row.text,
      },
      ...attachments.map((item, index) => ({
        id: `${row.id}_file_${index + 1}`,
        type: "file" as const,
        mime: item.mime,
        url: item.url,
        ...(item.filename ? { filename: item.filename } : {}),
      })),
    ],
  }
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
