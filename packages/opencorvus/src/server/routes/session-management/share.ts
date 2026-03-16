import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Session } from "../../../session"
import { SessionPrompt } from "../../../session/prompt"
import { SessionCompaction } from "../../../session/compaction"
import { SessionRevert } from "../../../session/revert"
import { SessionSummary } from "@/session/summary"
import { Agent } from "../../../agent/agent"
import { Snapshot } from "@/snapshot"
import { LLMTrace } from "@/session/llm-trace"
import { Filesystem } from "../../../util/filesystem"
import { buildSessionTraceHtml } from "../../../cli/cmd/export-html"
import { errors } from "../../error"
import { lazy } from "../../../util/lazy"
import path from "path"

export const SessionShareRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID/diff",
      describeRoute({
        summary: "Get message diff",
        description: "Get the file changes (diff) that resulted from a specific user message in the session.",
        operationId: "session.diff",
        responses: {
          200: {
            description: "Successfully retrieved diff",
            content: {
              "application/json": {
                schema: resolver(Snapshot.FileDiff.array()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionSummary.diff.schema.shape.sessionID,
        }),
      ),
      validator(
        "query",
        z.object({
          messageID: SessionSummary.diff.schema.shape.messageID,
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const params = c.req.valid("param")
        const result = await SessionSummary.diff({
          sessionID: params.sessionID,
          messageID: query.messageID,
        })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/export-html",
      describeRoute({
        summary: "Export session HTML",
        description: "Export a session as HTML trace report and return generated file path.",
        operationId: "session.exportHtml",
        responses: {
          200: {
            description: "Exported HTML file path",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    file: z.string(),
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
          sessionID: Session.get.schema,
        }),
      ),
      validator(
        "json",
        z
          .object({
            out: z.string().optional(),
          })
          .optional(),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json") ?? {}
        const session = await Session.get(sessionID)
        const messages = await Session.messages({ sessionID })
        const calls = await LLMTrace.read(sessionID)
        const report = await buildSessionTraceHtml({
          session: {
            id: session.id,
            title: session.title,
            time: session.time,
          },
          messages,
          calls,
        })
        const out = path.resolve(process.cwd(), String(body.out ?? `opencorvus-trace-${sessionID}.html`))
        await Filesystem.write(out, report)
        return c.json({ file: out })
      },
    )
    .post(
      "/:sessionID/summarize",
      describeRoute({
        summary: "Summarize session",
        description: "Generate a concise summary of the session using AI compaction to preserve key information.",
        operationId: "session.summarize",
        responses: {
          200: {
            description: "Summarized session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
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
      validator(
        "json",
        z.object({
          providerID: z.string(),
          modelID: z.string(),
          auto: z.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await Session.get(sessionID)
        await SessionRevert.cleanup(session)
        const msgs = await Session.messages({ sessionID })
        let currentAgent = await Agent.defaultAgent()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            currentAgent = info.agent || (await Agent.defaultAgent())
            break
          }
        }
        await SessionCompaction.create({
          sessionID,
          agent: currentAgent,
          model: {
            providerID: body.providerID,
            modelID: body.modelID,
          },
          auto: body.auto,
        })
        await SessionPrompt.loop({ sessionID })
        return c.json(true)
      },
    ),
)
