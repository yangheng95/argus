import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import { ControlTimeline } from "@/control/timeline"
import { conversationMessageHasDisplay, projectConversationView } from "@/conversation/view"
import {
  Artifact,
  AgentSessionCancelResult,
  AgentSessionReplyInput,
  AgentSessionReplyResult,
  Budget,
  CreateTaskInput,
  Acceptance,
  Evaluation,
  GlobalTaskBoard,
  InjectMessageInput,
  Interaction,
  Progress,
  ProjectBoard,
  RejectInteractionInput,
  ReplyInteractionInput,
  Run,
  TaskBoard,
  TaskBrief,
  TaskConversationEventPage,
  TaskConversationHistoryPage,
  TaskConversationHydration,
  TaskMessageInput,
  TaskMessageResult,
  TaskAccepted,
  TaskEvent,
  Task,
  TraceEventList,
  UpdateGoalInput,
} from "@/engine/model"
import { RewindTaskInput, taskRewindCursor } from "@/engine/rewind"
import { requireTask } from "@/engine/store"
import { abortChildExecutionForSession } from "@/engine/execution-abort"
import { TaskQueueReorderError } from "@/engine/queue"
import { ExecutorNotConfiguredError, EngineService, PlannerFailureError, TaskQueueStartError } from "@/task-api"
import { ProtocolStore } from "@/protocol/store"
import { ChannelIngress } from "@/channel/ingress"
import { Identifier } from "@/id/id"
import { Session } from "@/session"
import { Message } from "@/session/message"
import { buildTaskProjectArchive, TaskProjectArchiveUnsupportedProjectError } from "@/engine/task-project-archive"
import { errors, replyRouteErrors } from "../error"
import { lazy } from "../../util/lazy"
import { Log } from "@/util/log"
import { sessionGoalID, sessionParentID, sessionRole, taskIDForSession, taskMessageWatermark, taskSession } from "@/orchestrator/task-event"
import { ensureTaskMessageProtocolBridge, overlayMeta } from "@/orchestrator/protocol/message-bridge"
import { DIRECT_AGENT_SESSION_CONTROL_KINDS } from "@/orchestrator/direct-reply"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
const log = Log.create({ service: "server.routes.orchestrator" })
const CONVERSATION_EVENT_PAGE_LIMIT = 500
const TASK_MESSAGE_CHANGE_POLL_MS = 2_000

export const TaskListEvent = z.object({
  type: z.string(),
  taskID: z.string().nullable(),
  sequence: z.number(),
  notify: BusEvent.NotifyDescriptorSchema.optional(),
  notificationDetails: z.string().optional(),
})

const TaskListQuery = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

const TaskProjectArchiveUnsupportedProjectResponse = z.object({
  message: z.string(),
})

const ConversationEventPageQuery = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  until: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(CONVERSATION_EVENT_PAGE_LIMIT),
  since: z.coerce.number().positive().optional(),
})

const CONVERSATION_TAIL_MESSAGE_LIMIT = 80
const CONVERSATION_HISTORY_PAGE_LIMIT = 160

const ConversationHydrationQuery = z.object({
  tail_limit: z.coerce.number().int().min(1).max(2000).optional(),
})

const ConversationHistoryQuery = z.object({
  before: z.coerce.number().positive(),
  before_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(CONVERSATION_HISTORY_PAGE_LIMIT),
})

const ReorderTaskQueueInput = z.object({
  directory: z.string().min(1),
  orderedTaskIDs: z.array(z.string()).default([]),
  revision: z.string().optional(),
})

const ReorderTaskQueueResult = z.object({
  directory: z.string(),
  revision: z.string(),
  queuedTaskIDs: z.array(z.string()),
})

const StartQueuedTaskNowResult = z.object({
  task: Task,
  directory: z.string(),
  status: z.string(),
  started: z.boolean(),
  queuedTaskIDs: z.array(z.string()),
})

const TaskBindingList = z.array(
  z.object({
    id: z.string(),
    task_id: z.string(),
    platform: z.string(),
    channel: z.string(),
    thread: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
    time_created: z.number().optional(),
    time_updated: z.number().optional(),
  }),
)

export const EngineRoutes = lazy(() =>
  new Hono()
    .use(async (c, next) => {
      if (c.req.path !== "/global/tasks" && Instance.current()) {
        ensureTaskMessageProtocolBridge()
      }
      return next()
    })
    .post(
      "/task",
      describeRoute({
        summary: "Create task",
        operationId: "task.create",
        responses: {
          202: {
            description: "Task accepted",
            content: {
              "application/json": {
                schema: resolver(TaskAccepted),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", CreateTaskInput),
      async (c) => {
        const input = c.req.valid("json")
        const requestID = c.req.header("x-opencorvus-request-id") ?? undefined
        const taskID = await EngineService.createTask({
          ...input,
          requestID: input.requestID ?? requestID,
        }).catch((error) => {
          if (error instanceof ExecutorNotConfiguredError) {
            throw new HTTPException(400, {
              message: error.data.message,
            })
          }
          if (error instanceof PlannerFailureError) {
            throw new HTTPException(503, {
              message: error.message,
            })
          }
          throw error
        })
        return c.json({ task_id: taskID }, 202)
      },
    )
    .get(
      "/tasks",
      describeRoute({
        summary: "List project tasks",
        operationId: "task.list",
        responses: {
          200: {
            description: "Project task board",
            content: {
              "application/json": {
                schema: resolver(ProjectBoard),
              },
            },
          },
        },
      }),
      validator("query", TaskListQuery),
      async (c) => {
        const { q: query, status, limit } = c.req.valid("query")
        return c.json(await EngineService.getProjectBoard({ query, status, limit }))
      },
    )
    .get(
      "/global/tasks",
      describeRoute({
        summary: "List tasks across projects",
        operationId: "task.global.list",
        responses: {
          200: {
            description: "Global task board",
            content: {
              "application/json": {
                schema: resolver(GlobalTaskBoard),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional(),
          q: z.string().optional(),
          status: z.string().optional(),
          limit: z.coerce.number().optional(),
          cursor: z.coerce.number().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await EngineService.getGlobalTaskBoard({
          directory: query.directory,
          query: query.q,
          status: query.status,
          limit: query.limit,
          cursor: query.cursor,
        }))
      },
    )
    .patch(
      "/task-queue/reorder",
      describeRoute({
        summary: "Reorder queued tasks in a directory",
        operationId: "task.queue.reorder",
        responses: {
          200: {
            description: "Updated directory queue order",
            content: {
              "application/json": {
                schema: resolver(ReorderTaskQueueResult),
              },
            },
          },
          409: { description: "Queue revision conflict" },
          422: { description: "Invalid queued task ordering" },
        },
      }),
      validator("json", ReorderTaskQueueInput),
      async (c) => {
        try {
          return c.json(await EngineService.reorderTaskQueue(c.req.valid("json")))
        } catch (error) {
          if (error instanceof TaskQueueReorderError) {
            throw new HTTPException(error.code === "conflict" ? 409 : 422, { message: error.message })
          }
          throw error
        }
      },
    )
    .post(
      "/task/:taskID/start-now",
      describeRoute({
        summary: "Start a queued task immediately",
        operationId: "task.queue.startNow",
        responses: {
          200: {
            description: "Queued task started and scheduler invoked",
            content: {
              "application/json": {
                schema: resolver(StartQueuedTaskNowResult),
              },
            },
          },
          409: { description: "Task is not queued" },
          422: { description: "Task has no working directory" },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        try {
          return c.json(await EngineService.startQueuedTaskNow(c.req.valid("param").taskID))
        } catch (error) {
          if (error instanceof TaskQueueStartError) {
            throw new HTTPException(error.code === "not_queued" ? 409 : 422, { message: error.message })
          }
          throw error
        }
      },
    )
    .get(
      "/task/events",
      describeRoute({
        summary: "Subscribe to global task-list change notifications",
        description:
          "Pure change-notification SSE for the task list sidebar. Emits " +
          "`{type, taskID, sequence}` whenever any task aggregate event is " +
          "persisted (created/updated/completed/failed/cancelled/...). Notify-worthy " +
          "events also carry `notificationDetails` for copyable diagnostics. No " +
          "replay — clients call /task separately to fetch the refreshed list.",
        operationId: "task.list.events",
        responses: {
          200: {
            description: "Task-list change stream",
            content: {
              "text/event-stream": {
                schema: resolver(TaskListEvent),
              },
            },
          },
        },
      }),
      async (c) => {
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          let writes = Promise.resolve()
          const writeData = (data: string) => {
            writes = writes.then(() => stream.writeSSE({ data }))
            return writes
          }
          const stop = ProtocolStore.subscribeEvents(
            (event) => {
              const payload = JSON.stringify(taskListProtocolEvent(event))
              void writeData(payload)
            },
            { aggregate: "task" },
          )
          await writeData(
            JSON.stringify({ type: "task-list.connected", taskID: null, sequence: 0 }),
          )
          const heartbeat = setInterval(() => {
            void writeData(
              JSON.stringify({ type: "task-list.heartbeat", taskID: null, sequence: 0 }),
            )
          }, 10_000)
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              stop()
              resolve()
            })
          })
          await writes
        })
      },
    )
    .get(
      "/task/:taskID",
      describeRoute({
        summary: "Get task",
        operationId: "task.get",
        responses: {
          200: {
            description: "Task",
            content: {
              "application/json": {
                schema: resolver(Task),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.getTask(c.req.valid("param").taskID))
      },
    )
    .get(
      "/task/:taskID/project-archive",
      describeRoute({
        summary: "Download task project archive",
        description:
          "Return a ZIP containing the task project's Git-included files plus the task execution flow exported from OpenCorvus task projections.",
        operationId: "task.projectArchive",
        responses: {
          200: {
            description: "ZIP archive",
            content: {
              "application/zip": {
                schema: resolver(z.string()),
              },
            },
          },
          422: {
            description: "Task project is not a Git worktree",
            content: {
              "application/json": {
                schema: resolver(TaskProjectArchiveUnsupportedProjectResponse),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        try {
          const archive = await buildTaskProjectArchive({
            taskID,
            transcript: await loadTaskTranscript(taskID),
          })
          return new Response(archive.bytes, {
            status: 200,
            headers: {
              "content-type": "application/zip",
              "content-disposition": `attachment; filename="${archive.filename}"`,
              "content-length": String(archive.bytes.byteLength),
              "x-opencorvus-archive-file-count": String(archive.fileCount),
            },
          })
        } catch (error) {
          if (error instanceof TaskProjectArchiveUnsupportedProjectError) {
            return c.json({ message: error.message }, 422)
          }
          throw error
        }
      },
    )
    .get(
      "/task/:taskID/bindings",
      describeRoute({
        summary: "List channel bindings for a task",
        description:
          "Return every (platform, channel, thread) binding that points at this task. " +
          "Used by the Mission page to surface inbound channel provenance for a selected task.",
        operationId: "task.bindings",
        responses: {
          200: {
            description: "Channel bindings for the task",
            content: {
              "application/json": {
                schema: resolver(TaskBindingList),
              },
            },
          },
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        const rows = ChannelIngress.bindingsByTaskID(taskID)
        return c.json(
          rows.map((row) => ({
            id: String(row.id),
            task_id: String(row.task_id),
            platform: String(row.platform),
            channel: String(row.channel),
            thread: String(row.thread),
            payload: (row.payload ?? {}) as Record<string, unknown>,
            time_created: typeof row.time_created === "number" ? row.time_created : undefined,
            time_updated: typeof row.time_updated === "number" ? row.time_updated : undefined,
          })),
        )
      },
    )
    .get(
      "/task/:taskID/progress",
      describeRoute({
        summary: "Get task progress",
        operationId: "task.progress",
        responses: {
          200: {
            description: "Task progress",
            content: {
              "application/json": {
                schema: resolver(Progress),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.getProgress(c.req.valid("param").taskID))
      },
    )
    .get(
      "/task/:taskID/events",
      describeRoute({
        summary: "Subscribe to task events",
        operationId: "task.events",
        responses: {
          200: {
            description: "Task event stream",
            content: {
              "text/event-stream": {
                schema: resolver(TaskEvent),
              },
            },
          },
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        const after = Math.max(0, parseInt(c.req.query("after") ?? "0", 10) || 0)
        const afterLiveRaw = c.req.query("after_live")
        const shouldReplayLive = afterLiveRaw !== undefined
        const afterLive = shouldReplayLive
          ? Math.max(0, parseInt(afterLiveRaw ?? "0", 10) || 0)
          : 0
        const afterLiveEpochRaw = c.req.query("after_live_epoch")
        const afterLiveEpoch = afterLiveEpochRaw === undefined
          ? undefined
          : Math.max(0, parseInt(afterLiveEpochRaw, 10) || 0)
        const afterMessageWatermark = Math.max(0, parseInt(c.req.query("after_message_watermark") ?? "0", 10) || 0)
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          const sessionID = taskSession(taskID)
          // No registry to reseed: sessionRole/sessionGoalID/taskIDForSession
          // all read directly from session.kind / session.goal_id / session
          // parent chain in the DB, so reconnecting picks up running goals
          // without any in-process state restoration.
          let cursor = after
          let liveCursor = afterLive
          let messageWatermark = afterMessageWatermark
          let ready = false
          const buffered: Array<{ sequence: number; liveSequence: number; data: string }> = []
          let writes = Promise.resolve()
          const writeData = (data: string) => {
            writes = writes.then(() => stream.writeSSE({ data }))
            return writes
          }
          const emitMessageChange = async (watermark: number) => {
            messageWatermark = watermark
            const data = JSON.stringify(taskEvent(taskID, {
              type: "task.messages.changed",
              properties: {
                taskID,
                watermark,
                summary: "Task message append/update tables changed",
              },
            }))
            await writeData(data)
          }
          const markLiveMessageSeen = (event: ReturnType<typeof ProtocolStore.listTaskEventsAfter>[number]) => {
            if (!isMessageTaskEvent(event.type)) return
            messageWatermark = Math.max(messageWatermark, taskMessageWatermark(taskID))
          }
          const enqueueProtocolEvent = (event: ReturnType<typeof ProtocolStore.listTaskEventsAfter>[number]) => {
            if (!event.taskID || event.taskID !== taskID) return
            const isEphemeral = event.sequence === 0
            // Ephemeral events (sequence=0) always pass through — they're not sequenced
            // and not replayed on reconnect. Sequenced events are deduplicated by cursor.
            if (!isEphemeral && event.sequence <= cursor) return
            if (isEphemeral && (event.liveSequence ?? 0) <= liveCursor) return
            const data = JSON.stringify(protocolTaskEvent(event))
            markLiveMessageSeen(event)
            if (!ready) {
              buffered.push({ sequence: event.sequence, liveSequence: event.liveSequence ?? 0, data })
              return
            }
            if (!isEphemeral) cursor = Math.max(cursor, event.sequence)
            else liveCursor = Math.max(liveCursor, event.liveSequence ?? 0)
            void writeData(data)
          }
          const stop = ProtocolStore.subscribeEvents(enqueueProtocolEvent, {
            aggregate: "task",
            taskID,
          })
          const replayed = ProtocolStore.listTaskEventsAfter(taskID, after)
          for (const event of replayed) {
            const data = JSON.stringify(protocolTaskEvent(event))
            cursor = Math.max(cursor, event.sequence)
            await writeData(data)
          }
          if (shouldReplayLive) {
            const liveReplay = ProtocolStore.listTaskLiveEventsAfter(taskID, afterLive, {
              liveEpoch: afterLiveEpoch,
            })
            if (liveReplay.expired) {
              await writeData(JSON.stringify(protocolTaskEvent(liveReplay.event)))
              stop()
              return
            }
            for (const event of liveReplay.events) {
              liveCursor = Math.max(liveCursor, event.liveSequence ?? 0)
              markLiveMessageSeen(event)
              await writeData(JSON.stringify(protocolTaskEvent(event)))
            }
          }
          ready = true
          buffered.forEach((item) => {
            if (item.sequence > 0) {
              if (item.sequence <= cursor) return
              cursor = Math.max(cursor, item.sequence)
            } else {
              if (item.liveSequence <= liveCursor) return
              liveCursor = Math.max(liveCursor, item.liveSequence)
            }
            void writeData(item.data)
          })

          const connData = JSON.stringify(taskEvent(taskID, {
            type: "task.connected",
            properties: {
              taskID,
              summary: "Task event stream connected",
            },
          }))
          await writeData(connData)
          const initialMessageWatermark = taskMessageWatermark(taskID)
          if (initialMessageWatermark > messageWatermark) {
            await emitMessageChange(initialMessageWatermark)
          }
          const heartbeat = setInterval(() => {
            const data = JSON.stringify(taskEvent(taskID, {
              type: "task.heartbeat",
              properties: {
                taskID,
                summary: "Task event stream heartbeat",
              },
            }))
            void writeData(data)
          }, 10_000)
          const messageChangePoll = setInterval(() => {
            const nextWatermark = taskMessageWatermark(taskID)
            if (nextWatermark <= messageWatermark) return
            void emitMessageChange(nextWatermark)
          }, TASK_MESSAGE_CHANGE_POLL_MS)
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              clearInterval(messageChangePoll)
              stop()
              resolve()
            })
          })
          await writes
        })
      },
    )
    .get(
      "/task/:taskID/conversation",
      describeRoute({
        summary: "Hydrate task conversation state",
        description:
          "Load the current task board plus the persisted conversation inputs " +
          "needed to rebuild the overlay conversation tree before SSE resumes.",
        operationId: "task.conversation",
        responses: {
          200: {
            description: "Task conversation hydrate payload",
            content: {
              "application/json": {
                schema: resolver(TaskConversationHydration),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator("query", ConversationHydrationQuery),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        const query = c.req.valid("query")
        const rewindCursor = taskRewindCursor(taskID)
        const [board, transcript, timeline] = await Promise.all([
          EngineService.getBoard(taskID, { sync: true }),
          loadTaskTranscript(taskID),
          Promise.resolve(ControlTimeline.list({ taskID })),
        ])
        const filterByCursor = <T extends { info?: { time?: { created?: number } }; timestamp?: number }>(items: T[]) => {
          if (rewindCursor == null) return items
          return items.filter((item) => {
            const created =
              typeof item?.timestamp === "number"
                ? item.timestamp
                : typeof item?.info?.time?.created === "number"
                  ? item.info.time.created
                  : undefined
            return created == null || created <= rewindCursor
          })
        }
        const filteredTranscript = filterByCursor(transcript)
        const filteredTimeline = filterByCursor(timeline)
        const tailLimit = query.tail_limit ?? CONVERSATION_TAIL_MESSAGE_LIMIT
        const messageWatermark = taskMessageWatermark(taskID)
        const historyWindow = __conversationHistoryWindowForTest(filteredTranscript, filteredTimeline, {
          tailLimit,
        })
        const latestSequence = Number(board.lastSequence)
        if (!Number.isInteger(latestSequence) || latestSequence < 0) {
          throw new Error(`conversation hydrate board.lastSequence invalid: ${JSON.stringify(board.lastSequence)}`)
        }
        const eventPage = conversationEventPage(taskID, {
          after: 0,
          until: latestSequence,
          limit: CONVERSATION_EVENT_PAGE_LIMIT,
          rewindCursor,
          sinceTimestamp: historyWindow.history.hasMore
            ? historyWindow.history.oldestTimestamp
            : null,
        })
        const view = projectConversationView(board, historyWindow.transcript, eventPage.events)
        const agentView = historyWindow.history.hasMore
          ? projectConversationView(board, filteredTranscript, eventPage.events)
          : view
        return c.json({
          lastSequence: latestSequence,
          messageWatermark,
          board,
          transcript: historyWindow.transcript,
          timeline: historyWindow.timeline,
          events: eventPage.events,
          eventReplay: eventPage.eventReplay,
          history: historyWindow.history,
          agentView,
          view,
        })
      },
    )
    .get(
      "/task/:taskID/conversation/session/:sessionID",
      describeRoute({
        summary: "Get one task conversation session transcript",
        description:
          "Return the persisted transcript for one task child session so the overlay can hydrate old build-agent output directly instead of paging through the whole task history.",
        operationId: "task.conversation.session",
        responses: {
          200: {
            description: "Task conversation session transcript",
            content: {
              "application/json": {
                schema: resolver(TaskConversationHistoryPage),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id, sessionID: z.string().min(1) })),
      async (c) => {
        const { taskID, sessionID } = c.req.valid("param")
        const rewindCursor = taskRewindCursor(taskID)
        const [board, transcript, timeline] = await Promise.all([
          EngineService.getBoard(taskID, { sync: false }),
          loadTaskTranscript(taskID),
          Promise.resolve(ControlTimeline.list({ taskID })),
        ])
        const sessionTranscript = transcript.filter((item) => {
          if (String(item?.info?.sessionID || "") !== sessionID) return false
          if (rewindCursor == null) return true
          const created = typeof item?.info?.time?.created === "number" ? item.info.time.created : undefined
          return created == null || created <= rewindCursor
        })
        const oldestTimestamp = sessionTranscript.length > 0
          ? conversationItemTimestamp(sessionTranscript[0])
          : null
        const newestTimestamp = sessionTranscript.length > 0
          ? conversationItemTimestamp(sessionTranscript[sessionTranscript.length - 1])
          : null
        const sessionTimeline = oldestTimestamp == null || newestTimestamp == null
          ? []
          : timeline.filter((item) => {
              const created = conversationItemTimestamp(item)
              return created >= oldestTimestamp && created <= newestTimestamp
            })
        const sessionEvents = conversationSessionEvents(taskID, sessionID, { rewindCursor })
        return c.json({
          transcript: sessionTranscript,
          timeline: sessionTimeline,
          events: sessionEvents,
          view: projectConversationView(board, sessionTranscript, sessionEvents),
          history: {
            oldestTimestamp: oldestTimestamp ?? sessionEvents[0]?.timestamp ?? null,
            oldestMessageID: sessionTranscript[0] ? conversationItemID(sessionTranscript[0]) || null : null,
            hasMore: false,
            limit: Math.max(1, sessionTranscript.length),
          },
        })
      },
    )
    .get(
      "/task/:taskID/conversation/history",
      describeRoute({
        summary: "Page older task conversation transcript",
        description:
          "Return a bounded transcript/timeline slice older than a timestamp so the overlay can prepend history without blocking the live tail.",
        operationId: "task.conversation.history",
        responses: {
          200: {
            description: "Task conversation history page",
            content: {
              "application/json": {
                schema: resolver(TaskConversationHistoryPage),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator("query", ConversationHistoryQuery),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        const query = c.req.valid("query")
        const rewindCursor = taskRewindCursor(taskID)
        const [board, transcript, timeline] = await Promise.all([
          EngineService.getBoard(taskID, { sync: false }),
          loadTaskTranscript(taskID),
          Promise.resolve(ControlTimeline.list({ taskID })),
        ])
        const filterByCursor = <T extends { info?: { time?: { created?: number } }; timestamp?: number }>(items: T[]) => {
          if (rewindCursor == null) return items
          return items.filter((item) => {
            const created =
              typeof item?.timestamp === "number"
                ? item.timestamp
                : typeof item?.info?.time?.created === "number"
                  ? item.info.time.created
                  : undefined
            return created == null || created <= rewindCursor
          })
        }
        const page = __conversationHistoryBeforeForTest(
          filterByCursor(transcript),
          filterByCursor(timeline),
          { before: query.before, beforeID: query.before_id, limit: query.limit },
        )
        const pageEvents = conversationHistoryEvents(taskID, {
          before: query.before,
          oldestTimestamp: page.history.oldestTimestamp,
          rewindCursor,
        })
        return c.json({
          transcript: page.transcript,
          timeline: page.timeline,
          events: pageEvents,
          view: projectConversationView(board, page.transcript, pageEvents),
          history: page.history,
        })
      },
    )
    .get(
      "/task/:taskID/conversation/events",
      describeRoute({
        summary: "Page task conversation replay events",
        description:
          "Return a bounded protocol_event slice for rebuilding task conversation history after the initial hydrate.",
        operationId: "task.conversation.events",
        responses: {
          200: {
            description: "Task conversation event page",
            content: {
              "application/json": {
                schema: resolver(TaskConversationEventPage),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator("query", ConversationEventPageQuery),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        const query = c.req.valid("query")
        await EngineService.getTask(taskID)
        return c.json(conversationEventPage(taskID, {
          after: query.after,
          until: query.until,
          limit: query.limit,
          rewindCursor: taskRewindCursor(taskID),
          sinceTimestamp: query.since ?? null,
        }))
      },
    )
    .get(
      "/task/:taskID/brief",
      describeRoute({
        summary: "Get task brief",
        operationId: "task.brief",
        responses: {
          200: {
            description: "Task brief",
            content: {
              "application/json": {
                schema: resolver(TaskBrief),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.getBrief({ taskID: c.req.valid("param").taskID }))
      },
    )
    .get(
      "/task/:taskID/board",
      describeRoute({
        summary: "Get task board",
        operationId: "task.board",
        responses: {
          200: {
            description: "Task board",
            content: {
              "application/json": {
                schema: resolver(TaskBoard),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        const sync = c.req.query("sync") !== "0"
        const etag = await EngineService.getBoardTag(taskID, { sync })
        if (c.req.header("if-none-match") === etag) {
          return new Response(null, {
            status: 304,
            headers: {
              ETag: etag,
            },
          })
        }
        c.header("ETag", etag)
        return c.json(await EngineService.getBoard(taskID, { sync: false }))
      },
    )
    .get(
      "/task/:taskID/transcript",
      describeRoute({
        summary: "Get task transcript",
        operationId: "task.transcript",
        responses: {
          200: {
            description: "Task session messages including tool calls",
            content: {
              "application/json": {
                schema: resolver(Message.WithParts.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await loadTaskTranscript(c.req.valid("param").taskID))
      },
    )
    .get(
      "/task/:taskID/runs",
      describeRoute({
        summary: "List task runs",
        operationId: "task.runs",
        responses: {
          200: {
            description: "Task runs",
            content: {
              "application/json": {
                schema: resolver(Run.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.listRuns(c.req.valid("param").taskID))
      },
    )
    .get(
      "/task/:taskID/interactions",
      describeRoute({
        summary: "List task interactions",
        operationId: "task.interactions",
        responses: {
          200: {
            description: "Task interactions",
            content: {
              "application/json": {
                schema: resolver(Interaction.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.listTaskInteractions(c.req.valid("param").taskID))
      },
    )
    .post(
      "/task/:taskID/message",
      describeRoute({
        summary: "Handle task message",
        operationId: "task.message",
        responses: {
          200: {
            description: "Task message handled",
            content: {
              "application/json": {
                schema: resolver(TaskMessageResult),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator("json", TaskMessageInput),
      async (c) => {
        return c.json(await EngineService.handleTaskMessage(c.req.valid("param").taskID, c.req.valid("json")))
      },
    )
    .post(
      "/task/:taskID/inject",
      describeRoute({
        summary: "Inject message into running task",
        operationId: "task.inject",
        responses: {
          200: {
            description: "Message injected",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    appended: z.boolean(),
                    orchestratorWoken: z.boolean(),
                    executorResumed: z.boolean(),
                    resumed: z.boolean(),
                    status: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator("json", InjectMessageInput),
      async (c) => {
        return c.json(await EngineService.injectMessage(c.req.valid("param").taskID, c.req.valid("json").message))
      },
    )
    .post(
      "/task/:taskID/session/:sessionID/reply",
      describeRoute({
        summary: "Reply directly to a task agent session",
        description:
          "Append a human-authored message to a non-orchestrator task agent session. " +
          "This is scoped input for the target agent session, not a global task routing command. " +
          "Returns 400 InvalidReplyTargetKindError / BuildSessionDirectReplyError for kinds the route refuses, " +
          "409 ReplyTargetEnvelopeMissingError when the session has no prior user envelope yet, and " +
          "410 SessionRuntimeContractMissingError when the in-memory runtime contract is gone (process " +
          "restart or terminal collector already satisfied) — the overlay uses these to decide whether " +
          "to retry, hide the reply box, or surface a generic failure.",
        operationId: "task.session.reply",
        responses: {
          202: {
            description: "Reply accepted",
            content: {
              "application/json": {
                schema: resolver(AgentSessionReplyResult),
              },
            },
          },
          ...replyRouteErrors(400, 404, 409, 410),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id, sessionID: z.string().min(1) })),
      validator("json", AgentSessionReplyInput),
      async (c) => {
        const params = c.req.valid("param")
        const input = c.req.valid("json")
        return c.json(await EngineService.replyAgentSession(params.taskID, params.sessionID, input), 202)
      },
    )
    .post(
      "/task/:taskID/session/:sessionID/cancel",
      describeRoute({
        summary: "Cancel a task agent session",
        description:
          "Abort the active SessionLoop for a non-orchestrator task agent session. " +
          "For executor-owned child sessions, also abort the live executor stream.",
        operationId: "task.session.cancel",
        responses: {
          200: {
            description: "Agent session cancelled",
            content: {
              "application/json": {
                schema: resolver(AgentSessionCancelResult),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id, sessionID: z.string().min(1) })),
      async (c) => {
        const params = c.req.valid("param")
        await assertDirectAgentSession(params.taskID, params.sessionID)
        await abortChildExecutionForSession({
          taskID: params.taskID,
          sessionID: params.sessionID,
          reason: "agent session cancelled",
        })
        return c.json({
          task_id: params.taskID,
          session_id: params.sessionID,
          cancelled: true as const,
        })
      },
    )
    .post(
      "/task/:taskID/cancel",
      describeRoute({
        summary: "Cancel task",
        operationId: "task.cancel",
        responses: {
          200: {
            description: "Task cancelled",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.cancelTask(c.req.valid("param").taskID))
      },
    )
    .post(
      "/task/:taskID/rewind",
      describeRoute({
        summary: "Rewind task timeline; optionally also reset worktree files via PatchPart replay",
        operationId: "task.rewind",
        responses: {
          200: {
            description: "Rewind applied",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  taskID: z.string(),
                  cursorTime: z.number(),
                  rewindCount: z.number(),
                  resetWorktree: z.boolean(),
                  anchorKind: z.enum(["cursorTime", "message"]),
                })),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator("json", RewindTaskInput.omit({ taskID: true })),
      async (c) => {
        const { rewindTask } = await import("@/engine/rewind")
        const { taskID } = c.req.valid("param")
        const body = c.req.valid("json")
        const result = await rewindTask({
          taskID,
          ...body,
        })
        return c.json(result)
      },
    )
    .post(
      "/task/:taskID/rewind/clear",
      describeRoute({
        summary: "Clear the rewind cursor (visibility only; will not unrevert any reset worktree files)",
        operationId: "task.rewind.clear",
        responses: {
          200: {
            description: "Cursor cleared",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        const { clearRewindCursor } = await import("@/engine/rewind")
        await clearRewindCursor(c.req.valid("param").taskID)
        return c.json(true)
      },
    )
    .post(
      "/task/:taskID/retry",
      describeRoute({
        summary: "Retry task",
        operationId: "task.retry",
        responses: {
          200: {
            description: "Task retry queued",
            content: {
              "application/json": {
                schema: resolver(Run),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.retryTask(c.req.valid("param").taskID))
      },
    )
    .post(
      "/task/:taskID/replan",
      describeRoute({
        summary: "Replan task",
        operationId: "task.replan",
        responses: {
          200: {
            description: "Task replan queued",
            content: {
              "application/json": {
                schema: resolver(Run),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.retryTask(c.req.valid("param").taskID).catch((error) => {
          if (error instanceof PlannerFailureError) {
            throw new HTTPException(503, {
              message: error.message,
            })
          }
          throw error
        }))
      },
    )
    .post(
      "/task/:taskID/followup",
      describeRoute({
        summary: "Generate follow-up suggestion",
        operationId: "task.followup",
        responses: {
          200: {
            description: "A single short follow-up suggestion string",
            content: {
              "application/json": {
                schema: resolver(z.object({ suggestion: z.string() })),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.generateFollowup(c.req.valid("param").taskID))
      },
    )
    .get(
      "/run/:runID",
      describeRoute({
        summary: "Get run",
        operationId: "run.get",
        responses: {
          200: {
            description: "Run",
            content: {
              "application/json": {
                schema: resolver(Run),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: Run.shape.id })),
      async (c) => {
        return c.json(await EngineService.getRun(c.req.valid("param").runID))
      },
    )
    .get(
      "/run/:runID/brief",
      describeRoute({
        summary: "Get run brief",
        operationId: "run.brief",
        responses: {
          200: {
            description: "Run brief",
            content: {
              "application/json": {
                schema: resolver(TaskBrief),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: Run.shape.id })),
      async (c) => {
        const runID = c.req.valid("param").runID
        const run = await EngineService.getRun(runID)
        return c.json(await EngineService.getBrief({ taskID: run.taskID, runID }))
      },
    )
    .post(
      "/run/:runID/abort",
      describeRoute({
        summary: "Abort run",
        operationId: "run.abort",
        responses: {
          200: {
            description: "Run aborted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: Run.shape.id })),
      async (c) => {
        return c.json(await EngineService.abortRun(c.req.valid("param").runID))
      },
    )
    .get(
      "/run/:runID/acceptance",
      describeRoute({
        summary: "Get run acceptance",
        operationId: "run.acceptance",
        responses: {
          200: {
            description: "Run acceptance",
            content: {
              "application/json": {
                schema: resolver(Acceptance),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: Run.shape.id })),
      async (c) => {
        return c.json(await EngineService.getAcceptance(c.req.valid("param").runID))
      },
    )
    .get(
      "/goal-run/:goalRunID/acceptance",
      describeRoute({
        summary: "Get goal-run acceptance",
        operationId: "goalRun.acceptance",
        responses: {
          200: {
            description: "Goal-run acceptance, or null when the goal_run exists but has not produced a acceptance yet (in-flight build).",
            content: {
              "application/json": {
                schema: resolver(Acceptance.nullable()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ goalRunID: z.string().min(1) })),
      async (c) => {
        return c.json(await EngineService.getGoalRunAcceptance(c.req.valid("param").goalRunID))
      },
    )
    .get(
      "/session/:sessionID/trace",
      describeRoute({
        summary: "Get session AgentTrace events",
        operationId: "session.trace",
        responses: {
          200: {
            description: "Session AgentTrace events",
            content: {
              "application/json": {
                schema: resolver(TraceEventList),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string().min(1) })),
      async (c) => {
        return c.json(await EngineService.getSessionTrace(c.req.valid("param").sessionID))
      },
    )
    .get(
      "/task/:taskID/trace",
      describeRoute({
        summary: "Get task AgentTrace events (all sessions)",
        operationId: "task.trace",
        responses: {
          200: {
            description: "Aggregated task AgentTrace events",
            content: {
              "application/json": {
                schema: resolver(TraceEventList),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: z.string().min(1) })),
      async (c) => {
        return c.json(await EngineService.getTaskTrace(c.req.valid("param").taskID))
      },
    )
    .get(
      "/run/:runID/artifacts",
      describeRoute({
        summary: "List run artifacts",
        operationId: "run.artifacts",
        responses: {
          200: {
            description: "Run artifacts",
            content: {
              "application/json": {
                schema: resolver(Artifact.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: Run.shape.id })),
      async (c) => {
        return c.json(await EngineService.listArtifacts(c.req.valid("param").runID))
      },
    )
    .get(
      "/run/:runID/evaluations",
      describeRoute({
        summary: "List run evaluations",
        operationId: "run.evaluations",
        responses: {
          200: {
            description: "Run evaluations",
            content: {
              "application/json": {
                schema: resolver(Evaluation.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: Run.shape.id })),
      async (c) => {
        return c.json(await EngineService.listEvaluations(c.req.valid("param").runID))
      },
    )
    .post(
      "/interaction/:interactionID/reply",
      describeRoute({
        summary: "Reply to interaction",
        operationId: "interaction.reply",
        responses: {
          200: {
            description: "Interaction resolved",
            content: {
              "application/json": {
                schema: resolver(Interaction),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ interactionID: Interaction.shape.id })),
      validator("json", ReplyInteractionInput),
      async (c) => {
        return c.json(
          await EngineService.replyInteraction(c.req.valid("param").interactionID, c.req.valid("json")),
        )
      },
    )
    .post(
      "/interaction/:interactionID/reject",
      describeRoute({
        summary: "Reject interaction",
        operationId: "interaction.reject",
        responses: {
          200: {
            description: "Interaction rejected",
            content: {
              "application/json": {
                schema: resolver(Interaction),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ interactionID: Interaction.shape.id })),
      validator("json", RejectInteractionInput),
      async (c) => {
        return c.json(
          await EngineService.rejectInteraction(c.req.valid("param").interactionID, c.req.valid("json")),
        )
      },
    )
    .patch(
      "/goal/:goalID",
      describeRoute({
        summary: "Update goal",
        operationId: "goal.update",
        responses: {
          200: {
            description: "Goal updated",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ goalID: z.string() })),
      validator("json", UpdateGoalInput),
      async (c) => {
        return c.json(await EngineService.updateGoal(c.req.valid("param").goalID, c.req.valid("json")))
      },
    )
    .delete(
      "/goal/:goalID",
      describeRoute({
        summary: "Delete goal",
        operationId: "goal.delete",
        responses: {
          200: {
            description: "Goal deleted",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ goalID: z.string() })),
      async (c) => {
        return c.json(await EngineService.deleteGoal(c.req.valid("param").goalID))
      },
    )
    .delete(
      "/task/:taskID",
      describeRoute({
        summary: "Delete task",
        operationId: "task.delete",
        responses: {
          200: { description: "Task deleted" },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        return c.json(await EngineService.deleteTask(c.req.valid("param").taskID))
      },
    )
    .patch(
      "/task/:taskID/budget",
      describeRoute({
        summary: "Update task budget",
        operationId: "task.updateBudget",
        responses: {
          200: { description: "Budget updated" },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator("json", z.object({ budget: Budget.nullable() })),
      async (c) => {
        const { budget } = c.req.valid("json")
        return c.json(await EngineService.updateTaskBudget(c.req.valid("param").taskID, budget))
      },
    )
    .patch(
      "/task/:taskID/title",
      describeRoute({
        summary: "Update task title",
        operationId: "task.updateTitle",
        responses: {
          200: { description: "Title updated" },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator(
        "json",
        z.object({
          title: z
            .string()
            .transform((value) => value.trim())
            .pipe(z.string().min(1).max(200)),
        }),
      ),
      async (c) => {
        const { title } = c.req.valid("json")
        return c.json(await EngineService.updateTaskTitle(c.req.valid("param").taskID, title))
      },
    )
)

async function assertDirectAgentSession(taskID: string, sessionID: string) {
  const owningTask = taskIDForSession(sessionID)
  if (owningTask !== taskID) {
    throw new HTTPException(404, {
      message: `Session ${sessionID} does not belong to task ${taskID}`,
    })
  }
  const kind = sessionRole(sessionID)
  if (!kind) {
    throw new HTTPException(404, {
      message: `Session ${sessionID} has no task agent kind`,
    })
  }
  // The cancel route is a SESSION CONTROL surface, not the reply surface
  // — its allowed kinds include "build" (per DIRECT_AGENT_SESSION_CONTROL_KINDS).
  // Until this fix the route reused DIRECT_REPLY_AGENT_KINDS, which
  // excludes build, so cancelling a build session 400'd. The two sets
  // exist precisely to keep these two surfaces distinct (rule 8 single
  // source per concept).
  if (!DIRECT_AGENT_SESSION_CONTROL_KINDS.has(kind)) {
    throw new HTTPException(400, {
      message: `Session ${sessionID} has kind "${kind}" and cannot be controlled through the direct agent session control surface`,
    })
  }
  return Session.get(sessionID)
}

function taskEvent(taskID: string, event: { type: string; properties: Record<string, unknown> }, sequence?: number) {
  return {
    event_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    task_id: taskID,
    run_id: typeof event.properties.runID === "string" ? event.properties.runID : undefined,
    type: event.type.replace("engine.", ""),
    timestamp: Date.now(),
    sequence: sequence ?? 0,
    summary: typeof event.properties.summary === "string" ? event.properties.summary : event.type,
    payload: event.properties,
  }
}

function isMessageTaskEvent(type: string): boolean {
  return (
    type === "message.updated" ||
    type === "message.part.updated" ||
    type === "message.part.delta" ||
    type === "message.removed" ||
    type === "message.part.removed"
  )
}

function conversationItemTimestamp(item: any): number {
  const value =
    typeof item?.timestamp === "number"
      ? item.timestamp
      : typeof item?.info?.time?.created === "number"
        ? item.info.time.created
        : 0
  return Number.isFinite(value) ? value : 0
}

export const __taskMessageWatermarkForTest = taskMessageWatermark

function conversationItemSessionID(item: any): string {
  return String(item?.info?.sessionID || "")
}

function conversationItemID(item: any): string {
  return String(item?.info?.id || item?.id || "")
}

function compareConversationItems(left: any, right: any): number {
  const timeDiff = conversationItemTimestamp(left) - conversationItemTimestamp(right)
  if (timeDiff !== 0) return timeDiff
  return conversationItemID(left).localeCompare(conversationItemID(right))
}

function isBeforeConversationCursor(item: any, cursor: { before: number; beforeID?: string }): boolean {
  const timestamp = conversationItemTimestamp(item)
  if (timestamp < cursor.before) return true
  if (timestamp > cursor.before) return false
  if (!cursor.beforeID) return false
  const id = conversationItemID(item)
  return !!id && id < cursor.beforeID
}

function expandWindowStartToSessionBoundary(items: any[], start: number): number {
  return Math.max(0, Math.min(start, items.length))
}

function conversationHistoryState(
  allTranscript: any[],
  visibleTranscript: any[],
  limit: number,
) {
  const oldestItem = visibleTranscript[0] ?? null
  const oldest = oldestItem ? conversationItemTimestamp(oldestItem) : null
  const oldestMessageID = oldestItem ? conversationItemID(oldestItem) || null : null
  return {
    oldestTimestamp: oldest,
    oldestMessageID,
    hasMore: oldestItem != null && allTranscript.some((item) =>
      compareConversationItems(item, oldestItem) < 0
    ),
    limit,
  }
}

export function __conversationHistoryWindowForTest(
  transcript: any[],
  timeline: any[],
  input: { tailLimit: number },
) {
  const orderedTranscript = [...transcript].sort(
    compareConversationItems,
  )
  const start = expandWindowStartToSessionBoundary(
    orderedTranscript,
    Math.max(0, orderedTranscript.length - input.tailLimit),
  )
  const visibleTranscript = orderedTranscript.slice(start)
  const oldestTimestamp = visibleTranscript.length > 0
    ? conversationItemTimestamp(visibleTranscript[0])
    : null
  const visibleTimeline = oldestTimestamp == null
    ? [...timeline]
    : timeline.filter((item) => conversationItemTimestamp(item) >= oldestTimestamp)
  return {
    transcript: visibleTranscript,
    timeline: visibleTimeline,
    history: conversationHistoryState(orderedTranscript, visibleTranscript, input.tailLimit),
  }
}

export function __conversationHistoryBeforeForTest(
  transcript: any[],
  timeline: any[],
  input: { before: number; beforeID?: string; limit: number },
) {
  const olderTranscript = [...transcript]
    .filter((item) => isBeforeConversationCursor(item, { before: input.before, beforeID: input.beforeID }))
    .sort(compareConversationItems)
  const start = expandWindowStartToSessionBoundary(
    olderTranscript,
    Math.max(0, olderTranscript.length - input.limit),
  )
  const visibleTranscript = olderTranscript.slice(start)
  const oldestTimestamp = visibleTranscript.length > 0
    ? conversationItemTimestamp(visibleTranscript[0])
    : null
  const visibleTimeline = oldestTimestamp == null
    ? []
    : timeline.filter((item) => {
        const created = conversationItemTimestamp(item)
        return created >= oldestTimestamp && created < input.before
      })
  return {
    transcript: visibleTranscript,
    timeline: visibleTimeline,
    history: conversationHistoryState(olderTranscript, visibleTranscript, input.limit),
  }
}

export function __displayableConversationTranscriptForTest(transcript: any[]) {
  return transcript.filter(conversationMessageHasDisplay)
}

async function loadTaskTranscript(taskID: string) {
  const task = requireTask(taskID)
  const rootSessionID = task.session_id
  if (!rootSessionID) return []
  const rootSession = await Session.get(rootSessionID)
  if (rootSession.projectID !== task.project_id) {
    throw new Error(
      `Task ${taskID} root session ${rootSessionID} belongs to project ${rootSession.projectID}, expected ${task.project_id}`,
    )
  }
  const sessionIDs: string[] = []
  const queue = [rootSessionID]
  while (queue.length > 0) {
    const id = queue.shift()!
    sessionIDs.push(id)
    const children = await Session.childrenInProject({ parentID: id, projectID: task.project_id })
    queue.push(...children.map((child) => child.id))
  }
  const all = await Promise.all(sessionIDs.map((id) => Session.messages({ sessionID: id })))
  const messages = all.flat().sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0))
  for (const msg of messages) {
    const sid = msg.info.sessionID || ""
    const meta = overlayMeta(sid, rootSessionID, { role: msg.info.role })
    ;(msg.info as any).resolvedRole = meta.resolvedRole
    ;(msg.info as any).channel = meta.channel
    const goalID = sessionGoalID(sid)
    if (goalID) (msg.info as any).goalID = goalID
    const parentSessionID = sessionParentID(sid)
    if (parentSessionID) (msg.info as any).parentSessionID = parentSessionID
  }
  return __displayableConversationTranscriptForTest(messages)
}

function conversationEventPage(
  taskID: string,
  input: {
    after: number;
    until?: number;
    limit: number;
    rewindCursor: number | null;
    sinceTimestamp?: number | null;
  },
) {
  const latestSequence = typeof input.until === "number"
    ? input.until
    : ProtocolStore.latestTaskSequence(taskID)
  const rows = ProtocolStore.listTaskEventsAfter(taskID, input.after, {
    until: latestSequence,
    limit: input.limit,
  })
  const cursor = rows.reduce((max, event) => Math.max(max, event.sequence), input.after)
  const events = rows
    .map(protocolTaskEvent)
    .filter((event) =>
      (input.rewindCursor == null || event.timestamp <= input.rewindCursor)
      && (input.sinceTimestamp == null || event.timestamp >= input.sinceTimestamp)
    )
  return {
    events,
    eventReplay: {
      cursor,
      latestSequence,
      complete: cursor >= latestSequence || rows.length === 0,
      limit: input.limit,
      sinceTimestamp: input.sinceTimestamp ?? null,
    },
  }
}

function conversationSessionEvents(
  taskID: string,
  sessionID: string,
  input: {
    rewindCursor: number | null;
  },
) {
  return ProtocolStore.listTaskEvents(taskID)
    .filter((event) =>
      event.sessionID === sessionID &&
      (event.type === "session.status" || event.type === "session.error") &&
      (input.rewindCursor == null || event.time.emitted <= input.rewindCursor)
    )
    .map(protocolTaskEvent)
}

function conversationHistoryEvents(
  taskID: string,
  input: {
    before: number;
    oldestTimestamp: number | null;
    rewindCursor: number | null;
  },
) {
  if (input.oldestTimestamp == null) return []
  const oldestTimestamp = input.oldestTimestamp
  return ProtocolStore.listTaskEvents(taskID)
    .filter((event) =>
      (event.type === "session.status" || event.type === "session.error") &&
      event.time.emitted >= oldestTimestamp &&
      event.time.emitted < input.before &&
      (input.rewindCursor == null || event.time.emitted <= input.rewindCursor)
    )
    .map(protocolTaskEvent)
}

export function taskListProtocolEvent(event: ReturnType<typeof ProtocolStore.listTaskEventsAfter>[number]) {
  const notify = BusEvent.resolveNotify(event.type, event.payload ?? {})
  return {
    type: event.type.replace("engine.", ""),
    taskID: event.taskID ?? null,
    sequence: event.sequence,
    ...(notify ? { notify } : {}),
    ...(notify ? { notificationDetails: taskListNotificationDetails(event) } : {}),
  }
}

function taskListNotificationDetails(event: ReturnType<typeof ProtocolStore.listTaskEventsAfter>[number]): string {
  return JSON.stringify({
    type: event.type.replace("engine.", ""),
    taskID: event.taskID ?? null,
    sequence: event.sequence,
    summary: event.summary ?? (event.payload as Record<string, unknown> | undefined)?.summary ?? "",
    payload: event.payload ?? {},
  }, null, 2)
}

export function protocolTaskEvent(event: ReturnType<typeof ProtocolStore.listTaskEventsAfter>[number]) {
  // Schema (protocol/schema.ts) requires `emitted_at` to be a positive int.
  // Reading `time.emitted || time.created || Date.now()` was a rule-1
  // fallback chain that silently repaired schema-invalid rows — if we ever
  // reach that branch the upstream writer is broken and the right answer
  // is to crash loudly, not to stamp envelopes with a client-local clock.
  const timestamp = event.time.emitted
  if (!(typeof timestamp === "number" && timestamp > 0)) {
    throw new Error(
      `protocolTaskEvent: event ${event.id} missing time.emitted (schema-invariant violated)`,
    )
  }
  const notify = BusEvent.resolveNotify(event.type, event.payload ?? {})
  return {
    event_id: event.id,
    task_id: event.taskID,
    run_id: event.runID,
    type: event.type.replace("engine.", ""),
    emittedAt: timestamp,
    timestamp,
    sequence: event.sequence,
    ...(event.liveSequence !== undefined ? { live_sequence: event.liveSequence } : {}),
    ...(event.liveEpoch !== undefined ? { live_epoch: event.liveEpoch } : {}),
    summary: event.summary,
    payload: event.payload || {},
    ...(notify ? { notify } : {}),
  }
}
