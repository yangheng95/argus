import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import { Bus } from "@/bus"
import {
  Artifact,
  CreateTaskInput,
  Delivery,
  ExecutorEvent,
  ExecutorSession,
  Evaluation,
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
  UpdatePreferenceInput,
} from "@/orchestrator/model"
import { ExecutorNotConfiguredError, OrchestratorService } from "@/orchestrator/service"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const OrchestratorRoutes = lazy(() =>
  new Hono()
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
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          await stream.writeSSE({
            data: JSON.stringify(taskEvent(taskID, {
              type: "task.connected",
              properties: {
                taskID,
                summary: "Task event stream connected",
              },
            })),
          })
          const unsub = Bus.subscribeAll(async (event) => {
            if (event.properties?.taskID !== taskID) return
            await stream.writeSSE({ data: JSON.stringify(taskEvent(taskID, event)) })
          })
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify(taskEvent(taskID, {
                type: "task.heartbeat",
                properties: {
                  taskID,
                  summary: "Task event stream heartbeat",
                },
              })),
            })
          }, 10_000)
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              unsub()
              resolve()
            })
          })
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
        return c.json(await OrchestratorService.getBoard(c.req.valid("param").taskID))
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
        return c.json(await OrchestratorService.replanTask(c.req.valid("param").taskID))
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
      "/run/:runID/executor-events",
      describeRoute({
        summary: "List run executor events",
        operationId: "run.executorEvents",
        responses: {
          200: {
            description: "Executor events",
            content: {
              "application/json": {
                schema: resolver(ExecutorEvent.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: Run.shape.id })),
      async (c) => {
        return c.json(await OrchestratorService.listExecutorEvents(c.req.valid("param").runID))
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
      "/preference/:preferenceID",
      validator("param", z.object({ preferenceID: z.string() })),
      validator("json", UpdatePreferenceInput),
      async (c) => {
        return c.json(await OrchestratorService.updatePreference(c.req.valid("param").preferenceID, c.req.valid("json")))
      },
    )
    .delete(
      "/preference/:preferenceID",
      validator("param", z.object({ preferenceID: z.string() })),
      async (c) => {
        return c.json(await OrchestratorService.deletePreference(c.req.valid("param").preferenceID))
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
    ),
)

function taskEvent(taskID: string, event: { type: string; properties: Record<string, unknown> }) {
  return {
    event_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    task_id: taskID,
    run_id: typeof event.properties.runID === "string" ? event.properties.runID : undefined,
    type: event.type.replace("orchestrator.", ""),
    timestamp: Date.now(),
    summary: typeof event.properties.summary === "string" ? event.properties.summary : event.type,
    payload: event.properties,
  }
}
