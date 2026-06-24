import { Hono } from "hono"
import { streamSSE } from "../sse"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Session } from "../../session"
import { SessionStatus } from "@/session"
import { conversationMessageHasDisplay, projectConversationView } from "@/conversation/view"
import { Config } from "@/config/config"
import { EffectiveConfig } from "@/config/effective"
import { validateConfigModelReferences } from "@/config/model-reference-validation"
import { Agent } from "@/agent/agent"
import { PromptProfile } from "@/agent/prompt-profile"
import { Provider } from "@/provider/provider"
import { SessionPrompt } from "../../session/prompt"
import { Instance } from "@/project/instance"
import { clearRewindCursorForSession } from "@/engine/rewind"
import { CompactionHandoff } from "@/session/compaction-handoff"
import { SessionSummary } from "@/session/summary"
import { Message } from "../../session/message"
import { Todo } from "../../session/todo"
import { EngineService } from "@/task-api"
import { Snapshot } from "@/snapshot"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import { Log } from "../../util/log"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { ProtocolStore } from "@/protocol/store"
import { enrichStandaloneSessionTranscript, subscribeSessionMirror } from "@/protocol/session-mirror"
import { BusEvent } from "@/bus/bus-event"
import { SessionConversationHydration, SessionEvent } from "@/engine/model"
import {
  applyRightSidebarCodingAssistantPromptOverlay,
  isRightSidebarCodingAssistantSession,
} from "@/coding-assistant/session"
import { SessionAgentIdentity } from "@/session/agent-identity"
import { awaitSessionPromptFinishedInScope, cancelSessionPromptInScope } from "@/engine/cancellation-scope"

const log = Log.create({ service: "server" })

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function applySessionPromptRouteOverlay(sessionID: string, prompt: Omit<SessionPrompt.PromptInput, "sessionID">) {
  const session = await getActiveProjectSession(sessionID)
  if (isRightSidebarCodingAssistantSession(session)) {
    return applyRightSidebarCodingAssistantPromptOverlay(prompt)
  }
  return SessionAgentIdentity.applyToPrompt(session.kind, prompt)
}

function protocolSessionEvent(event: ReturnType<typeof ProtocolStore.listTaskEventsAfter>[number]) {
  const timestamp = event.time.emitted
  if (!(typeof timestamp === "number" && timestamp > 0)) {
    throw new Error(`protocolSessionEvent: event ${event.id} missing time.emitted (schema-invariant violated)`)
  }
  const notify = BusEvent.resolveNotify(event.type, event.payload ?? {})
  return {
    event_id: event.id,
    session_id: event.sessionID,
    type: event.type.replace("engine.", ""),
    emittedAt: timestamp,
    timestamp,
    sequence: event.sequence,
    summary: event.summary,
    payload: event.payload || {},
    ...(notify ? { notify } : {}),
  }
}

const SessionConfigResponse = z
  .object({
    config: Config.Info,
    origin: z.record(z.string(), z.unknown()).meta({
      description: "Per-key origin tree. Leaf values are 'project' or 'session'.",
    }),
  })
  .meta({ ref: "SessionConfig" })

type Origin = "project" | "session"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function originTree(effective: unknown, overlay: unknown): unknown {
  if (!isRecord(effective)) return overlay === undefined ? ("project" as Origin) : ("session" as Origin)
  const out: Record<string, unknown> = {}
  const overlayRecord = isRecord(overlay) ? overlay : undefined
  for (const [key, value] of Object.entries(effective)) {
    if (overlayRecord && Object.hasOwn(overlayRecord, key)) {
      const override = overlayRecord[key]
      if (override === null) continue
      out[key] = isRecord(value) && isRecord(override) ? originTree(value, override) : "session"
      continue
    }
    out[key] = isRecord(value) ? originTree(value, undefined) : "project"
  }
  return out
}

/**
 * A persisted session overlay is normalized by `Session.mergeConfigOverlay`
 * (it re-parses the result of `Config.mergeOverlay`, which strips RFC 7396
 * null-deletes). A `null` therefore must NEVER appear in the STORED overlay —
 * if one does, the write path is corrupt and we fail fast (R5.1 item 7)
 * instead of serving a half-deleted config. Pinned keys are already rejected
 * by `Config.Overlay` `.strict()` at parse time (same single schema).
 */
function assertNoStoredNull(value: unknown, path = "configOverlay"): void {
  if (value === null) {
    throw new Error(
      `Stored session overlay contains a null at ${path}; the persisted overlay must be ` +
        `null-normalized. This indicates a corrupt write path (R5.1 item 7).`,
    )
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) assertNoStoredNull(child, `${path}.${key}`)
  }
}

async function sessionConfig(input: {
  sessionID: string
  projectID: string
}): Promise<z.output<typeof SessionConfigResponse>> {
  const { sessionID, projectID } = input
  const session = await Session.getInProject({ sessionID, projectID })
  // R5.1 item 2: only a root session (task root or standalone root) owns a
  // config overlay; a child session is rejected (same guard as the write path).
  Session.assertConfigurableRoot(session)
  const base = await EffectiveConfig.base({ sessionID })
  const stored = session.metadata?.configOverlay ?? {}
  // R5.1 item 7: fail fast on a null or pinned key in the STORED overlay.
  // `.strict()` rejects pinned/unknown keys; assertNoStoredNull rejects nulls.
  const overlay = Config.Overlay.parse(stored)
  assertNoStoredNull(stored)
  const config = Config.mergeOverlay(base, overlay)
  return {
    config,
    origin: originTree(config, overlay) as Record<string, unknown>,
  }
}

async function getActiveProjectSession(sessionID: string) {
  return Session.getInProject({ sessionID, projectID: Instance.project.id })
}

async function assertActiveProjectSession(sessionID: string) {
  return getActiveProjectSession(sessionID)
}

export const SessionRoutes = lazy(() =>
  new Hono()
    // === query: list ===
    .get(
      "/",
      describeRoute({
        summary: "List sessions",
        description: "Get a list of all OpenCorvus sessions, sorted by most recently updated.",
        operationId: "session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: { "application/json": { schema: resolver(Session.Info.array()) } },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessions: Session.Info[] = []
        for await (const session of Session.list({
          directory: query.directory,
          roots: query.roots,
          start: query.start,
          search: query.search,
          limit: query.limit,
        })) {
          sessions.push(session)
        }
        return c.json(sessions)
      },
    )
    .get(
      "/global",
      describeRoute({
        summary: "List sessions across projects",
        description:
          "List sessions across all projects with cursor-based pagination and optional archived inclusion. Sets x-next-cursor response header when more results are available.",
        operationId: "session.listGlobal",
        responses: {
          200: {
            description: "List of sessions across projects",
            content: { "application/json": { schema: resolver(Session.GlobalInfo.array()) } },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          cursor: z.coerce
            .number()
            .optional()
            .meta({ description: "Return sessions updated before this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
          archived: z.coerce.boolean().optional().meta({ description: "Include archived sessions (default false)" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const limit = query.limit ?? 100
        const sessions: Session.GlobalInfo[] = []
        for await (const session of Session.listGlobal({
          directory: query.directory,
          roots: query.roots,
          start: query.start,
          cursor: query.cursor,
          search: query.search,
          limit: limit + 1,
          archived: query.archived,
        })) {
          sessions.push(session)
        }
        const hasMore = sessions.length > limit
        const list = hasMore ? sessions.slice(0, limit) : sessions
        if (hasMore && list.length > 0) {
          c.header("x-next-cursor", String(list[list.length - 1].time.updated))
        }
        return c.json(list)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get session status",
        description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
        operationId: "session.status",
        responses: {
          200: {
            description: "Get session status",
            content: { "application/json": { schema: resolver(z.record(z.string(), SessionStatus.Info)) } },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return c.json(SessionStatus.list())
      },
    )
    .get(
      "/:sessionID/config",
      describeRoute({
        summary: "Get session effective configuration",
        description:
          "Return project configuration with the session overlay applied, plus a per-key origin tree for project vs session values.",
        operationId: "session.config.get",
        responses: {
          200: {
            description: "Effective session configuration",
            content: { "application/json": { schema: resolver(SessionConfigResponse) } },
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
      async (c) => {
        return c.json(
          await sessionConfig({
            sessionID: c.req.valid("param").sessionID,
            projectID: Instance.project.id,
          }),
        )
      },
    )
    .patch(
      "/:sessionID/config",
      describeRoute({
        summary: "Update session configuration overlay",
        description:
          "Merge a sparse session-scoped config overlay into session metadata. Project configuration is unchanged.",
        operationId: "session.config.update",
        responses: {
          200: {
            description: "Effective session configuration after update",
            content: { "application/json": { schema: resolver(SessionConfigResponse) } },
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
      validator("json", Config.Overlay),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const patch = c.req.valid("json")
        const projectID = Instance.project.id
        await Session.getInProject({ sessionID, projectID })
        await validateConfigModelReferences(patch, "configOverlay")
        if (typeof patch.prompt_profile?.active === "string") {
          try {
            PromptProfile.assertKnownProfileID(patch.prompt_profile.active, await EffectiveConfig.base({ sessionID }))
          } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
        await Session.mergeConfigOverlayInProject({ sessionID, projectID, patch })
        Provider.reset()
        Agent.reset()
        return c.json(await sessionConfig({ sessionID, projectID }))
      },
    )
    .get(
      "/:sessionID/conversation",
      describeRoute({
        summary: "Hydrate session conversation state",
        description:
          "Load the persisted conversation inputs needed to rebuild the overlay conversation tree for a supervisor session before SSE resumes.",
        operationId: "session.conversation",
        responses: {
          200: {
            description: "Session conversation hydrate payload",
            content: {
              "application/json": {
                schema: resolver(SessionConversationHydration),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await getActiveProjectSession(sessionID)
        const transcript = enrichStandaloneSessionTranscript(await Session.messages({ sessionID })).filter(
          conversationMessageHasDisplay,
        )
        const board = {
          kind: "session" as const,
          sessionID,
          status: session.time.archived ? "archived" : "active",
          title: session.title ?? null,
          directory: session.directory ?? null,
        }
        const view = projectConversationView(board, transcript)
        return c.json({
          board,
          transcript,
          timeline: [],
          events: [],
          view,
          agentView: view,
          history: {
            oldestTimestamp: transcript[0]?.info?.time?.created ?? null,
            oldestMessageID: transcript[0]?.info?.id ?? null,
            hasMore: false,
            limit: transcript.length,
          },
        })
      },
    )
    .get(
      "/:sessionID/events",
      describeRoute({
        summary: "Subscribe to session events",
        operationId: "session.events",
        responses: {
          200: {
            description: "Session event stream",
            content: {
              "text/event-stream": {
                schema: resolver(SessionEvent),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await assertActiveProjectSession(sessionID)
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          let heartbeat: ReturnType<typeof setInterval> | undefined
          let stopProtocol = () => {}
          let stopMirror = () => {}
          let finishStream = () => {}
          let closed = false
          const cleanup = (input?: { closeStream?: boolean; error?: unknown }) => {
            if (closed) return
            closed = true
            if (heartbeat) clearInterval(heartbeat)
            stopMirror()
            stopProtocol()
            if (input?.error) {
              log.warn("session event stream write failed", {
                sessionID,
                error: errorMessage(input.error),
              })
            }
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
              .catch((error) => {
                cleanup({ closeStream: true, error })
              })
            return writes
          }
          stopProtocol = ProtocolStore.subscribeEvents(
            (event) => {
              if (event.sessionID !== sessionID) return
              void writeData(JSON.stringify(protocolSessionEvent(event)))
            },
            { sessionID },
          )
          stopMirror = subscribeSessionMirror(sessionID)
          await writeData(
            JSON.stringify({
              event_id: `session-connected-${Date.now()}`,
              session_id: sessionID,
              type: "session.connected",
              emittedAt: Date.now(),
              timestamp: Date.now(),
              sequence: 0,
              summary: "Session event stream connected",
              payload: { sessionID },
            }),
          )
          if (closed) {
            await writes
            return
          }
          heartbeat = setInterval(() => {
            const now = Date.now()
            void writeData(
              JSON.stringify({
                event_id: `session-heartbeat-${now}`,
                session_id: sessionID,
                type: "session.heartbeat",
                emittedAt: now,
                timestamp: now,
                sequence: 0,
                summary: "Session event stream heartbeat",
                payload: { sessionID },
              }),
            )
          }, 10_000)
          stream.onAbort(() => {
            cleanup()
          })
          await finished
          await writes
        })
      },
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get session",
        description: "Retrieve detailed information about a specific OpenCorvus session.",
        tags: ["Session"],
        operationId: "session.get",
        responses: {
          200: {
            description: "Get session",
            content: { "application/json": { schema: resolver(Session.Info) } },
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
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await getActiveProjectSession(sessionID)
        log.info("session.get", { sessionID, session })
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/children",
      describeRoute({
        summary: "Get session children",
        tags: ["Session"],
        description: "Retrieve all child sessions that were forked from the specified parent session.",
        operationId: "session.children",
        responses: {
          200: {
            description: "List of children",
            content: { "application/json": { schema: resolver(Session.Info.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.children.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await assertActiveProjectSession(sessionID)
        return c.json(await Session.children(sessionID))
      },
    )
    .get(
      "/:sessionID/todo",
      describeRoute({
        summary: "Get session todos",
        description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
        operationId: "session.todo",
        responses: {
          200: {
            description: "Todo list",
            content: { "application/json": { schema: resolver(Todo.Info.array()) } },
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
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.getInProject({ sessionID, projectID: Instance.project.id })
        return c.json(await Todo.get(sessionID))
      },
    )
    // === mutate: CRUD ===
    .post(
      "/",
      describeRoute({
        summary: "Create session",
        description: "Create a new OpenCorvus session for interacting with AI assistants and managing conversations.",
        operationId: "session.create",
        responses: {
          ...errors(400),
          200: {
            description: "Successfully created session",
            content: { "application/json": { schema: resolver(Session.Info) } },
          },
        },
      }),
      validator("json", Session.create.schema),
      async (c) => {
        const session = await Session.create(c.req.valid("json"))
        return c.json(session)
      },
    )
    .delete(
      "/:sessionID",
      describeRoute({
        summary: "Delete session",
        description: "Delete a session and permanently remove all associated data, including messages and history.",
        operationId: "session.delete",
        responses: {
          200: {
            description: "Successfully deleted session",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.remove.schema,
        }),
      ),
      validator(
        "query",
        z.object({
          deleteTasks: z.coerce.boolean().optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await assertActiveProjectSession(sessionID)
        await EngineService.deleteSession(sessionID, {
          deleteTasks: c.req.valid("query").deleteTasks === true,
        })
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID",
      describeRoute({
        summary: "Update session",
        description: "Update properties of an existing session, such as title or other metadata.",
        operationId: "session.update",
        responses: {
          200: {
            description: "Successfully updated session",
            content: { "application/json": { schema: resolver(Session.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          time: z
            .object({
              archived: z.number().optional(),
            })
            .optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const updates = c.req.valid("json")

        let session = await getActiveProjectSession(sessionID)
        if (updates.title !== undefined) {
          session = await Session.setTitle({ sessionID, title: updates.title })
        }
        if (updates.time?.archived !== undefined) {
          session = await Session.setArchived({ sessionID, time: updates.time.archived })
        }

        return c.json(session)
      },
    )
    // === mutate: flow (init / fork / abort) ===
    .post(
      "/:sessionID/init",
      describeRoute({
        summary: "Initialize session",
        description:
          "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
        operationId: "session.init",
        responses: {
          200: { description: "200", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", Session.initialize.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await assertActiveProjectSession(sessionID)
        await Session.initialize({ ...body, sessionID })
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/fork",
      describeRoute({
        summary: "Fork session",
        description: "Create a new session by forking an existing session at a specific message point.",
        operationId: "session.fork",
        responses: {
          200: { description: "200", content: { "application/json": { schema: resolver(Session.Info) } } },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.fork.schema.shape.sessionID,
        }),
      ),
      validator("json", Session.fork.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await assertActiveProjectSession(sessionID)
        const result = await Session.fork({ ...body, sessionID })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/abort",
      describeRoute({
        summary: "Abort session",
        description: "Abort an active session and stop any ongoing AI processing or command execution.",
        operationId: "session.abort",
        responses: {
          200: {
            description: "Aborted session",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await assertActiveProjectSession(sessionID)
        cancelSessionPromptInScope({ session })
        TaskQueueService.cancelSessionPrompts({
          sessionIDs: [sessionID],
          reason: "session aborted",
          source: "session.prompt_async",
        })
        await awaitSessionPromptFinishedInScope({ session, handle: "session.abort" })
        return c.json(true)
      },
    )
    // === share: diff / summarize ===
    .get(
      "/:sessionID/diff",
      describeRoute({
        summary: "Get message diff",
        description: "Get the file changes (diff) that resulted from a specific user message in the session.",
        operationId: "session.diff",
        responses: {
          200: {
            description: "Successfully retrieved diff",
            content: { "application/json": { schema: resolver(Snapshot.FileDiff.array()) } },
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
        await assertActiveProjectSession(params.sessionID)
        const result = await SessionSummary.diff({
          sessionID: params.sessionID,
          messageID: query.messageID,
        })
        return c.json(result)
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
            content: { "application/json": { schema: resolver(z.boolean()) } },
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
          focus: z.string().optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await getActiveProjectSession(sessionID)
        await clearRewindCursorForSession(sessionID)
        const msgs = await Session.messages({ sessionID })
        let source: Message.User | undefined
        for (let i = msgs.length - 1; i >= 0; i--) {
          const msg = msgs[i]
          const info = msg.info
          if (info.role === "user" && !msg.parts.some((part) => part.type === "compaction")) {
            source = info
            break
          }
        }
        if (!source) {
          throw new Error(`Cannot compact session ${sessionID}: no real user message found`)
        }
        const result = await TaskQueueService.executeCompaction({
          sessionID,
          sourceUserMessageID: source.id,
          model: {
            providerID: body.providerID,
            modelID: body.modelID,
          },
          auto: body.auto,
          focus: body.focus,
        })
        return c.json(result.info.role === "assistant" && CompactionHandoff.isValidSummaryMessage(result.info))
      },
    )
    // === message read / delete / patch ===
    .get(
      "/:sessionID/message",
      describeRoute({
        summary: "Get session messages",
        description: "Retrieve all messages in a session, including user prompts and AI responses.",
        operationId: "session.messages",
        responses: {
          200: {
            description: "List of messages",
            content: { "application/json": { schema: resolver(Message.WithParts.array()) } },
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
        "query",
        z.object({
          limit: z.coerce.number().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessionID = c.req.valid("param").sessionID
        await assertActiveProjectSession(sessionID)
        const messages = await Session.messages({
          sessionID,
          limit: query.limit,
        })
        return c.json(messages)
      },
    )
    .get(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Get message",
        description: "Retrieve a specific message from a session by its message ID.",
        operationId: "session.message",
        responses: {
          200: {
            description: "Message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Info,
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
          messageID: z.string().meta({ description: "Message ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await assertActiveProjectSession(params.sessionID)
        return c.json(await Message.get({ sessionID: params.sessionID, messageID: params.messageID }))
      },
    )
    .delete(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Delete message",
        description:
          "Permanently delete a specific message (and all of its parts) from a session. This does not revert any file changes that may have been made while processing the message.",
        operationId: "session.deleteMessage",
        responses: {
          200: {
            description: "Successfully deleted message",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          messageID: z.string().meta({ description: "Message ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await assertActiveProjectSession(params.sessionID)
        SessionPrompt.assertNotBusy(params.sessionID)
        await Session.removeMessage({ sessionID: params.sessionID, messageID: params.messageID })
        return c.json(true)
      },
    )
    .delete(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Delete a part from a message",
        operationId: "part.delete",
        responses: {
          200: {
            description: "Successfully deleted part",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          messageID: z.string().meta({ description: "Message ID" }),
          partID: z.string().meta({ description: "Part ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await assertActiveProjectSession(params.sessionID)
        await Session.removePart({
          sessionID: params.sessionID,
          messageID: params.messageID,
          partID: params.partID,
        })
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Update a part in a message",
        operationId: "part.update",
        responses: {
          200: {
            description: "Successfully updated part",
            content: { "application/json": { schema: resolver(Message.Part) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          messageID: z.string().meta({ description: "Message ID" }),
          partID: z.string().meta({ description: "Part ID" }),
        }),
      ),
      validator("json", Message.Part),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        if (body.id !== params.partID || body.messageID !== params.messageID || body.sessionID !== params.sessionID) {
          throw new Error(
            `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
          )
        }
        await assertActiveProjectSession(params.sessionID)
        const part = await Session.updatePart(body)
        return c.json(part)
      },
    )
    // === prompt (sync / async) / command / shell ===
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
          prompt: await applySessionPromptRouteOverlay(sessionID, body),
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
                    user_message: Message.WithParts,
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
        const result = await TaskQueueService.enqueuePromptAfterPersistingUserMessage({
          sessionID,
          prompt: await applySessionPromptRouteOverlay(sessionID, body),
          source: "session.prompt_async",
        })
        const [userMessage] = enrichStandaloneSessionTranscript([result.userMessage])
        return c.json({ taskID: result.taskID, user_message: userMessage }, 202)
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
                    status: z.enum(["queued", "running", "completed", "failed"]),
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
        await assertActiveProjectSession(sessionID)
        const status = TaskQueueService.getStatus({
          sessionID,
          taskID,
          source: "session.prompt_async",
        })
        if (!status) return c.json({ message: `Task ${taskID} not found` }, 404)
        return c.json(status)
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
        await assertActiveProjectSession(sessionID)
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
            content: { "application/json": { schema: resolver(Message.Assistant) } },
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
        await assertActiveProjectSession(sessionID)
        const msg = await SessionPrompt.shell({ ...body, sessionID })
        return c.json(msg)
      },
    ),
)
