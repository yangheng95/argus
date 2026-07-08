import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { GlobalBus } from "@/bus/global"
import { isRightSidebarCodingAssistantSession } from "@/coding-assistant/session"
import { ProtocolStore } from "@/protocol/store"
import { Session, SessionStatus } from "@/session"
import { WorkLedgerList, listWorkLedger } from "@/work-ledger/projection"
import { errors } from "../error"
import { streamSSE } from "../sse"
import { isTaskListProjectionEventType, taskListProtocolEvent } from "./orchestrator"

const WorkLedgerListQuery = z
  .object({
    directory: z.string().optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursorUpdated: z.coerce.number().optional(),
    cursorRowKey: z.string().optional(),
  })
  .refine((query) => (query.cursorUpdated === undefined) === (query.cursorRowKey === undefined), {
    message: "cursorUpdated and cursorRowKey must be provided together",
    path: ["cursorUpdated"],
  })

export const WorkLedgerEvent = z.object({
  type: z.enum(["work-ledger.connected", "work-ledger.heartbeat", "work-ledger.changed"]),
  sourceType: z.string(),
  sessionID: z.string().optional(),
  taskID: z.string().nullable().optional(),
  sequence: z.number(),
})

function workLedgerSessionChangedEvent(
  sourceType: string,
  info: Session.Info,
  sequence = Number(info.time.updated) || 0,
): z.output<typeof WorkLedgerEvent> | null {
  const mission =
    info.kind === "mission" &&
    info.metadata &&
    typeof info.metadata === "object" &&
    typeof (info.metadata as Record<string, unknown>).mission === "object"
  if (!mission && !isRightSidebarCodingAssistantSession(info)) return null
  return {
    type: "work-ledger.changed",
    sourceType,
    sessionID: info.id,
    sequence,
  }
}

function writeWorkLedgerEventData(writeData: (data: string) => void, event: z.output<typeof WorkLedgerEvent>): void {
  writeData(JSON.stringify(event))
}

function workLedgerGlobalBusEvent(input: { payload?: unknown }): { sourceType: string; info: Session.Info } | null {
  const payload = input.payload
  if (!payload || typeof payload !== "object") return null
  const envelope = payload as { type?: unknown; properties?: unknown }
  const sourceType = typeof envelope.type === "string" ? envelope.type : ""
  if (
    sourceType !== Session.Event.Created.type &&
    sourceType !== Session.Event.Updated.type &&
    sourceType !== Session.Event.Deleted.type
  ) {
    return null
  }
  const properties = envelope.properties
  const info =
    properties && typeof properties === "object" ? (properties as { info?: unknown }).info : undefined
  const parsed = Session.Info.safeParse(info)
  if (!parsed.success) return null
  return { sourceType, info: parsed.data }
}

function workLedgerGlobalBusStatusEvent(
  input: { payload?: unknown },
): { sourceType: string; sessionID: string; sequence: number } | null {
  const payload = input.payload
  if (!payload || typeof payload !== "object") return null
  const envelope = payload as { type?: unknown; properties?: unknown }
  const sourceType = typeof envelope.type === "string" ? envelope.type : ""
  if (sourceType !== SessionStatus.Event.Status.type && sourceType !== SessionStatus.Event.Idle.type) return null
  const parsed = z.object({ sessionID: z.string().min(1) }).safeParse(envelope.properties)
  if (!parsed.success) return null
  return { sourceType, sessionID: parsed.data.sessionID, sequence: Date.now() }
}

export function WorkLedgerRoutes() {
  return new Hono().get(
    "/events",
    describeRoute({
      summary: "Subscribe to Work Ledger change notifications",
      description:
        "Pure change-notification SSE for the unified Work Ledger. Emits Mission, Chat, and Task projection changes; clients refetch /work-ledger for the canonical projection.",
      operationId: "workLedger.events",
      responses: {
        200: {
          description: "Work Ledger change stream",
          content: {
            "text/event-stream": {
              schema: resolver(WorkLedgerEvent),
            },
          },
        },
      },
    }),
    async (c) => {
      c.header("X-Accel-Buffering", "no")
      c.header("X-Content-Type-Options", "nosniff")
      return streamSSE(c, async (stream) => {
        let heartbeat: ReturnType<typeof setInterval> | undefined
        let stop = () => {}
        let finishStream = () => {}
        let closed = false
        const cleanup = (input?: { closeStream?: boolean }) => {
          if (closed) return
          closed = true
          if (heartbeat) clearInterval(heartbeat)
          stop()
          if (input?.closeStream) stream.close()
          finishStream()
        }
        const finished = new Promise<void>((resolve) => {
          finishStream = resolve
        })
        let writes = Promise.resolve()
        const writeData = (data: string) => {
          writes = writes
            .then(() => {
              if (closed) return
              return stream.writeSSE({ data })
            })
            .catch(() => {
              cleanup({ closeStream: true })
            })
        }
        const globalBusListener = (event: { payload?: unknown }) => {
          const sessionEvent = workLedgerGlobalBusEvent(event)
          if (sessionEvent) {
            const changed = workLedgerSessionChangedEvent(sessionEvent.sourceType, sessionEvent.info)
            if (changed) writeWorkLedgerEventData(writeData, changed)
            return
          }
          const statusEvent = workLedgerGlobalBusStatusEvent(event)
          if (!statusEvent) return
          void Session.get(statusEvent.sessionID)
            .then((info) => {
              const changed = workLedgerSessionChangedEvent(statusEvent.sourceType, info, statusEvent.sequence)
              if (changed) writeWorkLedgerEventData(writeData, changed)
            })
            .catch(() => {
              cleanup({ closeStream: true })
            })
        }
        GlobalBus.on("event", globalBusListener)
        const protocolSubscription = ProtocolStore.subscribeEvents((event) => {
          if (!isTaskListProjectionEventType(event.type)) return
          const taskEvent = taskListProtocolEvent(event)
          writeWorkLedgerEventData(writeData, {
            type: "work-ledger.changed",
            sourceType: taskEvent.type,
            taskID: taskEvent.taskID,
            sequence: taskEvent.sequence,
          })
        }, { aggregate: "task" })
        stop = () => {
          GlobalBus.off("event", globalBusListener)
          protocolSubscription()
        }
        writeWorkLedgerEventData(writeData, {
          type: "work-ledger.connected",
          sourceType: "work-ledger.connected",
          sequence: 0,
        })
        heartbeat = setInterval(() => {
          writeWorkLedgerEventData(writeData, {
            type: "work-ledger.heartbeat",
            sourceType: "work-ledger.heartbeat",
            sequence: 0,
          })
        }, 10_000)
        stream.onAbort(() => {
          cleanup()
        })
        await finished
        await writes
      })
    },
  ).get(
    "/",
    describeRoute({
      summary: "List Work Ledger rows",
      description:
        "Return one unified Mission, Task, and Chat ledger projection. Mission-owned tasks are nested under their Mission row and excluded from top-level Task rows.",
      operationId: "workLedger.list",
      responses: {
        200: {
          description: "Work Ledger rows",
          content: { "application/json": { schema: resolver(WorkLedgerList) } },
        },
        ...errors(400),
      },
    }),
    validator("query", WorkLedgerListQuery),
    async (c) => c.json(await listWorkLedger(c.req.valid("query"))),
  )
}
