import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Message } from "../../session/message"
import { SessionPrompt } from "../../session/prompt"
import { errors } from "../error"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import { TaskQueueTable } from "@/scheduler/task-queue.sql"
import { Database, and, eq } from "@/storage/db"

export function SessionInteractionPromptRoutes() {
  return new Hono()
    .post(
      "/:sessionID/message",
      describeRoute({
        summary: "Send message",
        description: "Create and send a new message to a session, waiting until assistant output is complete.",
        operationId: "session.prompt",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Assistant,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await TaskQueueService.executePrompt({
          sessionID,
          prompt: body,
          source: "session.prompt",
        })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/prompt_async",
      describeRoute({
        summary: "Send async message",
        description:
          "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
        operationId: "session.prompt_async",
        responses: {
          202: {
            description: "Prompt accepted",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    taskID: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const taskID = TaskQueueService.enqueuePrompt({
          sessionID,
          prompt: body,
          source: "session.prompt_async",
        })
        return c.json({ taskID }, 202)
      },
    )
    .get(
      "/:sessionID/prompt_async/:taskID",
      describeRoute({
        summary: "Get async prompt task status",
        description: "Get status for a previously submitted async prompt task.",
        operationId: "session.prompt_async_status",
        responses: {
          200: {
            description: "Task status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    taskID: z.string(),
                    sessionID: z.string(),
                    status: z.enum(["queued", "retrying", "running", "completed", "failed"]),
                    retryCount: z.number().int(),
                    maxRetries: z.number().int(),
                    source: z.string(),
                    prompt: z.string(),
                    error: z.string().nullable(),
                    startedAt: z.number().int().nullable(),
                    completedAt: z.number().int().nullable(),
                    updatedAt: z.number().int(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          taskID: z.string().meta({ description: "Task ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const taskID = c.req.valid("param").taskID
        const row = Database.use((db) =>
          db
            .select()
            .from(TaskQueueTable)
            .where(
              and(
                eq(TaskQueueTable.id, taskID),
                eq(TaskQueueTable.session_id, sessionID),
                eq(TaskQueueTable.source, "session.prompt_async"),
              ),
            )
            .get(),
        )
        if (!row) {
          return c.json({ message: `Task ${taskID} not found` }, 404)
        }
        return c.json({
          taskID: row.id,
          sessionID: row.session_id,
          status: row.status,
          retryCount: row.retry_count,
          maxRetries: row.max_retries,
          source: row.source,
          prompt: row.prompt,
          error: row.error_message ?? null,
          startedAt: row.time_started ?? null,
          completedAt: row.time_completed ?? null,
          updatedAt: row.time_updated,
        })
      },
    )
    .post(
      "/:sessionID/command",
      describeRoute({
        summary: "Send command",
        description: "Send a new command to a session for execution by the AI assistant.",
        operationId: "session.command",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Assistant,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.command({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/shell",
      describeRoute({
        summary: "Run shell command",
        description: "Execute a shell command within the session context and return the AI's response.",
        operationId: "session.shell",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(Message.Assistant),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.shell({ ...body, sessionID })
        return c.json(msg)
      },
    )
}
