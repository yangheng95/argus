import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { Bus } from "@/bus"
import { Trace } from "@/trace"
import { lazy } from "../../util/lazy"

const TraceEventOut = z.object({
  ts: z.number(),
  seq: z.number(),
  taskID: z.string(),
  sessionID: z.string().optional(),
  agent: z.string().optional(),
  round: z.number().optional(),
  category: z.string(),
  payload: z.unknown().optional(),
})

/**
 * Trace routes — overlay UI consumes these to render the per-orchestrator
 * decision tree. Two endpoints:
 *
 *   GET /trace                       List recent task IDs (newest first).
 *   GET /trace/:taskID               Read full historical events as JSON array.
 *   GET /trace/:taskID/stream        SSE stream: replay history then push live.
 *
 * The /stream variant first sends every event already on disk (so the client
 * sees a complete picture even if it connected late), then subscribes to
 * Bus.subscribe(Trace.Event) and forwards every matching event live.
 */
export const TraceRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List recent traced tasks",
        operationId: "trace.list",
        responses: {
          200: {
            description: "Task IDs newest first",
            content: {
              "application/json": {
                schema: resolver(z.object({ tasks: z.array(z.string()) })),
              },
            },
          },
        },
      }),
      async (c) => {
        const tasks = await Trace.listTasks()
        return c.json({ tasks })
      },
    )
    .get(
      "/:taskID",
      describeRoute({
        summary: "Read all trace events for a task",
        operationId: "trace.read",
        responses: {
          200: {
            description: "Events array (empty if file does not exist)",
            content: {
              "application/json": {
                schema: resolver(z.object({ events: z.array(TraceEventOut) })),
              },
            },
          },
        },
      }),
      async (c) => {
        const events = await Trace.read(c.req.param("taskID"))
        return c.json({ events })
      },
    )
    .get(
      "/:taskID/stream",
      describeRoute({
        summary: "Subscribe to trace events for a task (SSE)",
        description:
          "Replays existing events first, then pushes new events as they happen. Client should consume until the SSE connection closes.",
        operationId: "trace.stream",
        responses: {
          200: {
            description: "Server-sent event stream of TraceEvent",
          },
        },
      }),
      async (c) => {
        const taskID = c.req.param("taskID")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          // Replay history so a late-connecting overlay still sees full trace.
          const history = await Trace.read(taskID)
          for (const ev of history) {
            await stream.writeSSE({ data: JSON.stringify(ev) })
          }

          let lastSeq = history.at(-1)?.seq ?? 0
          const unsub = Bus.subscribe(Trace.Event, async (msg) => {
            const ev = msg.properties
            if (ev.taskID !== taskID) return
            // Defensive ordering: a Bus event that arrives before its history
            // counterpart was flushed could re-send it. Skip seqs we've seen.
            if (ev.seq <= lastSeq) return
            lastSeq = ev.seq
            await stream.writeSSE({ data: JSON.stringify(ev) })
          })

          const heartbeat = setInterval(() => {
            stream.writeSSE({ data: JSON.stringify({ category: "_heartbeat", ts: Date.now() }) })
          }, 15_000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              unsub()
              resolve()
            })
          })
        })
      },
    ),
)
