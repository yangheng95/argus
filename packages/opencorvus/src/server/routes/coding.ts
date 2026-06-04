import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Session } from "@/session"
import { CodingCli } from "@/coding-cli"
import { SystemTerminal } from "@/system-terminal"
import { HTTPException } from "hono/http-exception"
import { Instance } from "@/project/instance"
import {
  RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
  isRightSidebarCodingAssistantSession,
  listRightSidebarCodingAssistantSessions,
} from "@/coding-assistant/session"

const CodingSessionQuery = z.object({
  directory: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const CodingSessionResponse = z.object({
  session: Session.Info,
})

const CodingSessionsResponse = z.object({
  sessions: Session.Info.array(),
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
        const sessions = listRightSidebarCodingAssistantSessions(input)
        return c.json({ sessions })
      },
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Claim right sidebar coding assistant session",
        description:
          "Validate and return an existing project-bound right sidebar coding assistant session.",
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
}
