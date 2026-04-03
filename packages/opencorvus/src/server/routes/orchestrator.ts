import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import {
  Artifact,
  Budget,
  CreateTaskInput,
  Delivery,
  ExecutorSession,
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
  TaskMessageInput,
  TaskMessageResult,
  TaskAccepted,
  TaskEvent,
  Task,
  UpdateGoalInput,
  UpdateTaskChecksInput,
} from "@/orchestrator/model"
import { ExecutorNotConfiguredError, OrchestratorService, PlannerFailureError } from "@/orchestrator/service"
import { ProtocolStore } from "@/protocol/store"
import { Session } from "@/session"
import { Message } from "@/session/message"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { registerGoalRunSession, sessionRole, taskSession } from "./task-event"
import { ensureTaskMessageProtocolBridge, overlayMeta } from "./task-message-protocol-bridge"
import { listGoalRunsByTask } from "@/orchestrator/store"

export const OrchestratorRoutes = lazy(() =>
  new Hono()
    .use(async (c, next) => {
      // Initialize bridge lazily on first request — Instance context is available here
      ensureTaskMessageProtocolBridge()
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
        const taskID = await OrchestratorService.createTask({
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
      async (c) => {
        const query = c.req.query("q") || undefined
        const status = c.req.query("status") || undefined
        const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined
        return c.json(await OrchestratorService.getProjectBoard({ query, status, limit }))
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
        return c.json(await OrchestratorService.getGlobalTaskBoard({
          directory: query.directory,
          query: query.q,
          status: query.status,
          limit: query.limit,
          cursor: query.cursor,
        }))
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
        return c.json(await OrchestratorService.getTask(c.req.valid("param").taskID))
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
        return c.json(await OrchestratorService.getProgress(c.req.valid("param").taskID))
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
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          const sessionID = taskSession(taskID)
          // Seed the goal-run registry with any existing child sessions so
          // reconnecting SSE streams pick up events for already-running goals.
          if (sessionID) {
            const queue = [sessionID]
            while (queue.length > 0) {
              const id = queue.shift()!
              if (id !== sessionID) registerGoalRunSession(id, taskID)
              const children = await Session.children(id)
              queue.push(...children.map((child) => child.id))
            }
          }
          let cursor = after
          let ready = false
          const buffered: Array<{ sequence: number; data: string }> = []
          let writes = Promise.resolve()
          const writeData = (data: string) => {
            writes = writes.then(() => stream.writeSSE({ data }))
            return writes
          }
          const enqueueProtocolEvent = (event: ReturnType<typeof ProtocolStore.listTaskEventsAfter>[number]) => {
            if (!event.taskID || event.taskID !== taskID) return
            const isEphemeral = event.sequence === 0
            // Ephemeral events (sequence=0) always pass through — they're not sequenced
            // and not replayed on reconnect. Sequenced events are deduplicated by cursor.
            if (!isEphemeral && event.sequence <= cursor) return
            const data = JSON.stringify(protocolTaskEvent(event))
            if (!ready) {
              if (isEphemeral) {
                // Ephemeral events during replay phase: write immediately (they can't be buffered by sequence)
                void writeData(data)
              } else {
                buffered.push({ sequence: event.sequence, data })
              }
              return
            }
            if (!isEphemeral) cursor = Math.max(cursor, event.sequence)
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
          ready = true
          buffered
            .sort((a, b) => a.sequence - b.sequence)
            .filter((item) => item.sequence > cursor)
            .forEach((item) => {
              cursor = Math.max(cursor, item.sequence)
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
        return c.json(await OrchestratorService.getBrief({ taskID: c.req.valid("param").taskID }))
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
        const etag = await OrchestratorService.getBoardTag(taskID, { sync })
        if (c.req.header("if-none-match") === etag) {
          return new Response(null, {
            status: 304,
            headers: {
              ETag: etag,
            },
          })
        }
        c.header("ETag", etag)
        return c.json(await OrchestratorService.getBoard(taskID, { sync: false }))
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
        const task = await OrchestratorService.getTask(c.req.valid("param").taskID)
        const rootSessionID = task.sessionID
        if (!rootSessionID) return c.json([])
        // Collect all session IDs in the tree (primary + goal run children)
        const sessionIDs: string[] = []
        const queue = [rootSessionID]
        while (queue.length > 0) {
          const id = queue.shift()!
          sessionIDs.push(id)
          const children = await Session.children(id)
          queue.push(...children.map((child) => child.id))
        }
        const all = await Promise.all(sessionIDs.map((id) => Session.messages({ sessionID: id })))
        const messages = all.flat().sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0))
        // Build session→goalID map from goal run records so executor sessions
        // can be matched to their parent goal during transcript enrichment.
        const taskID = task.id
        const goalRuns = listGoalRunsByTask(taskID)
        const sessionToGoal = new Map<string, string>()
        for (const gr of goalRuns) {
          if (gr.session_id) sessionToGoal.set(gr.session_id, gr.goal_id)
          const provSid = (gr.metadata as any)?.provider_session_id
          if (typeof provSid === "string" && provSid) sessionToGoal.set(provSid, gr.goal_id)
        }

        // Seed the goal-run registry with child sessions (with goalID when known)
        // so sessionRole() and sessionGoalID() resolve correctly for enrichment.
        for (const id of sessionIDs) {
          if (id !== rootSessionID) {
            const goalID = sessionToGoal.get(id)
            registerGoalRunSession(id, taskID, "executor", goalID)
          }
        }
        // Enrich each message with resolvedRole/channel/goalID — same logic as the
        // SSE bridge so the overlay receives identical metadata regardless of
        // whether messages arrive via SSE or transcript reload.
        for (const msg of messages) {
          const sid = msg.info.sessionID || ""
          // Fill missing agent from session registry — matches bridge enrichment
          // in task-message-protocol-bridge.ts enrichProperties().
          let agent = (msg.info as any).agent || ""
          if (!agent) {
            const role = sessionRole(sid)
            if (role) agent = role
          }
          const meta = overlayMeta(sid, taskID, { role: msg.info.role, agent })
          ;(msg.info as any).resolvedRole = meta.resolvedRole
          ;(msg.info as any).channel = meta.channel
          // Stamp goalID so the overlay can group executor messages into their goal card
          const goalID = sessionToGoal.get(sid)
          if (goalID) (msg.info as any).goalID = goalID
        }
        return c.json(messages)
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
        return c.json(await OrchestratorService.listRuns(c.req.valid("param").taskID))
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
        return c.json(await OrchestratorService.listTaskInteractions(c.req.valid("param").taskID))
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
        return c.json(await OrchestratorService.handleTaskMessage(c.req.valid("param").taskID, c.req.valid("json")))
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
                schema: resolver(z.object({ resumed: z.boolean(), status: z.string() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator("json", InjectMessageInput),
      async (c) => {
        return c.json(await OrchestratorService.injectMessage(c.req.valid("param").taskID, c.req.valid("json").message))
      },
    )
    .patch(
      "/task/:taskID/checks",
      describeRoute({
        summary: "Update task checks",
        operationId: "task.checks.update",
        responses: {
          200: {
            description: "Task checks updated",
            content: {
              "application/json": {
                schema: resolver(Task),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      validator("json", UpdateTaskChecksInput),
      async (c) => {
        return c.json(await OrchestratorService.updateTaskChecks(c.req.valid("param").taskID, c.req.valid("json")))
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
        return c.json(await OrchestratorService.cancelTask(c.req.valid("param").taskID))
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
        return c.json(await OrchestratorService.retryTask(c.req.valid("param").taskID))
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
        return c.json(await OrchestratorService.replanTask(c.req.valid("param").taskID).catch((error) => {
          if (error instanceof PlannerFailureError) {
            throw new HTTPException(503, {
              message: error.message,
            })
          }
          throw error
        }))
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
        return c.json(await OrchestratorService.getRun(c.req.valid("param").runID))
      },
    )
    .get(
      "/run/:runID/executor",
      describeRoute({
        summary: "Get run executor session",
        operationId: "run.executorSession",
        responses: {
          200: {
            description: "Executor session",
            content: {
              "application/json": {
                schema: resolver(ExecutorSession),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: Run.shape.id })),
      async (c) => {
        return c.json(await OrchestratorService.getExecutorSession(c.req.valid("param").runID))
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
        const run = await OrchestratorService.getRun(runID)
        return c.json(await OrchestratorService.getBrief({ taskID: run.taskID, runID }))
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
        return c.json(await OrchestratorService.abortRun(c.req.valid("param").runID))
      },
    )
    .get(
      "/run/:runID/delivery",
      describeRoute({
        summary: "Get run delivery",
        operationId: "run.delivery",
        responses: {
          200: {
            description: "Run delivery",
            content: {
              "application/json": {
                schema: resolver(Delivery),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: Run.shape.id })),
      async (c) => {
        return c.json(await OrchestratorService.getDelivery(c.req.valid("param").runID))
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
        return c.json(await OrchestratorService.listArtifacts(c.req.valid("param").runID))
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
        return c.json(await OrchestratorService.listEvaluations(c.req.valid("param").runID))
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
          await OrchestratorService.replyInteraction(c.req.valid("param").interactionID, c.req.valid("json")),
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
          await OrchestratorService.rejectInteraction(c.req.valid("param").interactionID, c.req.valid("json")),
        )
      },
    )
    .patch(
      "/goal/:goalID",
      validator("param", z.object({ goalID: z.string() })),
      validator("json", UpdateGoalInput),
      async (c) => {
        return c.json(await OrchestratorService.updateGoal(c.req.valid("param").goalID, c.req.valid("json")))
      },
    )
    .delete(
      "/goal/:goalID",
      validator("param", z.object({ goalID: z.string() })),
      async (c) => {
        return c.json(await OrchestratorService.deleteGoal(c.req.valid("param").goalID))
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
        return c.json(await OrchestratorService.deleteTask(c.req.valid("param").taskID))
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
        return c.json(await OrchestratorService.updateTaskBudget(c.req.valid("param").taskID, budget))
      },
    )
)

function taskEvent(taskID: string, event: { type: string; properties: Record<string, unknown> }, sequence?: number) {
  return {
    event_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    task_id: taskID,
    run_id: typeof event.properties.runID === "string" ? event.properties.runID : undefined,
    type: event.type.replace("orchestrator.", ""),
    timestamp: Date.now(),
    sequence: sequence ?? 0,
    summary: typeof event.properties.summary === "string" ? event.properties.summary : event.type,
    payload: event.properties,
  }
}

function protocolTaskEvent(event: ReturnType<typeof ProtocolStore.listTaskEventsAfter>[number]) {
  return {
    event_id: event.id,
    task_id: event.taskID,
    run_id: event.runID,
    type: event.type.replace("orchestrator.", ""),
    timestamp: event.time.emitted || event.time.created || Date.now(),
    sequence: event.sequence,
    summary: event.summary,
    payload: event.payload || {},
  }
}
