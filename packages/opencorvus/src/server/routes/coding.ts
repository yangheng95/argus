import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { CodingCli } from "@/coding-cli"
import { SystemTerminal } from "@/system-terminal"
import { HTTPException } from "hono/http-exception"
import { Instance } from "@/project/instance"
import { EngineService } from "@/task-api"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import {
  RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
  isRightSidebarCodingAssistantSession,
  listRightSidebarCodingAssistantSessions,
  setRightSidebarCodingAssistantSelectedTask,
} from "@/coding-assistant/session"

const CodingSessionQuery = z.object({
  directory: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursorUpdated: z.coerce.number().int().positive().optional(),
  cursorSessionID: z.string().optional(),
  search: z.string().optional(),
})

const CodingSessionResponse = z.object({
  session: Session.Info,
})

const CodingSessionSelectionInput = z.object({
  taskID: z.string().nullable(),
})

const CodingSessionUpdateInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
})

const CodingSessionsResponse = z.object({
  sessions: Session.Info.array(),
  nextCursor: z
    .object({
      updated: z.number(),
      sessionID: z.string(),
    })
    .optional(),
})

async function assertRightSidebarCodingSession(sessionID: string) {
  const session = await Session.get(sessionID)
  if (session.projectID !== Instance.project.id || session.directory !== Instance.directory) {
    throw new HTTPException(404, { message: `Coding assistant session not found: ${sessionID}` })
  }
  if (!isRightSidebarCodingAssistantSession(session)) {
    throw new HTTPException(404, { message: `Coding assistant session not found: ${sessionID}` })
  }
  return session
}

export function CodingRoutes() {
  return new Hono()
    .get(
      "/cli/profiles",
      describeRoute({
        summary: "List installed coding CLIs",
        description: "List installed coding command-line interfaces launchable in the system terminal.",
        operationId: "coding.cli.profiles",
        responses: {
          200: {
            description: "Coding CLI profile list",
            content: {
              "application/json": {
                schema: resolver(CodingCli.ListResponse),
              },
            },
          },
        },
      }),
      async (c) => {
        const profiles = await CodingCli.list().catch((error) => {
          if (error instanceof CodingCli.ConfigError) {
            throw new HTTPException(400, { message: error.data.message })
          }
          throw error
        })
        return c.json(profiles)
      },
    )
    .post(
      "/cli/open",
      describeRoute({
        summary: "Open coding CLI",
        description: "Open an installed coding CLI in the operating system terminal application.",
        operationId: "coding.cli.open",
        responses: {
          200: {
            description: "Coding CLI launch result",
            content: {
              "application/json": {
                schema: resolver(CodingCli.OpenResponse),
              },
            },
          },
        },
      }),
      validator("json", CodingCli.OpenInput),
      async (c) => {
        const result = await CodingCli.open(c.req.valid("json")).catch((error) => {
          if (error instanceof CodingCli.ConfigError || error instanceof SystemTerminal.ConfigError) {
            throw new HTTPException(400, { message: error.data.message })
          }
          throw error
        })
        return c.json(result)
      },
    )
    .post(
      "/session",
      describeRoute({
        summary: "Create right sidebar coding assistant session",
        description:
          "Create a project-bound assistant session for the right sidebar coding assistant. Prompting and history use canonical /session routes.",
        operationId: "coding.session.create",
        responses: {
          201: {
            description: "Coding assistant session",
            content: {
              "application/json": {
                schema: resolver(CodingSessionResponse),
              },
            },
          },
        },
      }),
      async (c) => {
        const session = await Session.create({
          kind: "assistant",
          title: "Coding assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        return c.json({ session }, 201)
      },
    )
    .get(
      "/sessions",
      describeRoute({
        summary: "List right sidebar coding assistant sessions",
        description:
          "List project-bound right sidebar coding assistant sessions. Prompting and history use canonical /session routes.",
        operationId: "coding.sessions.list",
        responses: {
          200: {
            description: "Coding assistant sessions",
            content: {
              "application/json": {
                schema: resolver(CodingSessionsResponse),
              },
            },
          },
        },
      }),
      validator("query", CodingSessionQuery),
      async (c) => {
        const input = c.req.valid("query")
        return c.json(listRightSidebarCodingAssistantSessions(input))
      },
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Claim right sidebar coding assistant session",
        description: "Validate and return an existing project-bound right sidebar coding assistant session.",
        operationId: "coding.session.get",
        responses: {
          200: {
            description: "Coding assistant session",
            content: {
              "application/json": {
                schema: resolver(CodingSessionResponse),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const session = await assertRightSidebarCodingSession(c.req.valid("param").sessionID)
        return c.json({ session })
      },
    )
    .patch(
      "/session/:sessionID",
      describeRoute({
        summary: "Update right sidebar coding assistant session",
        description: "Update a project-bound right sidebar coding assistant session.",
        operationId: "coding.session.update",
        responses: {
          200: {
            description: "Updated coding assistant session",
            content: {
              "application/json": {
                schema: resolver(CodingSessionResponse),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", CodingSessionUpdateInput),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await assertRightSidebarCodingSession(sessionID)
        const updates = c.req.valid("json")
        let session = await Session.get(sessionID)
        if (updates.title !== undefined) {
          session = await Session.setTitle({ sessionID, title: updates.title })
        }
        return c.json({ session })
      },
    )
    .delete(
      "/session/:sessionID",
      describeRoute({
        summary: "Delete right sidebar coding assistant session",
        description: "Delete a project-bound right sidebar coding assistant session and its canonical history.",
        operationId: "coding.session.delete",
        responses: {
          200: {
            description: "Deleted coding assistant session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await assertRightSidebarCodingSession(sessionID)
        await EngineService.deleteSession(sessionID)
        return c.json(true)
      },
    )
    .post(
      "/session/:sessionID/abort",
      describeRoute({
        summary: "Abort right sidebar coding assistant session",
        description: "Stop active and queued processing for a project-bound right sidebar coding assistant session.",
        operationId: "coding.session.abort",
        responses: {
          200: {
            description: "Aborted coding assistant session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await assertRightSidebarCodingSession(sessionID)
        SessionPrompt.cancel(sessionID)
        TaskQueueService.cancelSessionPrompts({
          sessionIDs: [sessionID],
          reason: "coding assistant stopped",
          source: "session.prompt_async",
        })
        return c.json(true)
      },
    )
    .patch(
      "/session/:sessionID/selection",
      describeRoute({
        summary: "Update right sidebar coding assistant task selection",
        description:
          "Persist the selected project task for a right sidebar coding assistant session. The selected task is stored in session metadata and remains project-bound.",
        operationId: "coding.session.selection.update",
        responses: {
          200: {
            description: "Coding assistant session with updated selection",
            content: {
              "application/json": {
                schema: resolver(CodingSessionResponse),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", CodingSessionSelectionInput),
      async (c) => {
        const session = await assertRightSidebarCodingSession(c.req.valid("param").sessionID)
        const { taskID } = c.req.valid("json")
        if (taskID !== null) {
          const task = await EngineService.getTask(taskID)
          if (task.projectID !== Instance.project.id) {
            throw new HTTPException(404, { message: `Task not found: ${taskID}` })
          }
        }
        const updated = await setRightSidebarCodingAssistantSelectedTask({ session, taskID })
        return c.json({ session: updated })
      },
    )
}
