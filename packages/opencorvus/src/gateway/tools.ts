/**
 * Gateway tool set — six tools the Gateway LLM uses to dispatch user intent.
 *
 * Design rules:
 *  - Every tool delegates to existing OrchestratorService / Question / Session APIs.
 *    No new business logic lives here; the Gateway is purely a router.
 *  - Tasks are enqueued with `kind: "workflow"`; the task-agent itself chooses
 *    between a direct build and the full pipeline via its `build` tool.
 *  - cwd resolution: tools accept an explicit `cwd`; if missing, the agent layer
 *    fills in the session's current cwd (see agent.ts).
 *  - No fallback decisions: if the LLM picks the wrong gateway tool the wrong
 *    thing happens. System prompt + tool descriptions carry the rules; the
 *    runtime does not silently rewrite.
 */

import { tool } from "ai"
import z from "zod"
import { Instance } from "@/project/instance"
import { OrchestratorService } from "@/orchestrator/service"
import { listProjectTasks } from "@/orchestrator/store"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { writeCwd } from "./cwd-state"

const AttachmentInput = z.object({
  mime: z.string(),
  data: z.string().describe("base64-encoded bytes"),
  filename: z.string().optional(),
})

export type GatewayToolsContext = {
  /** Gateway session ID — `switch_cwd` writes to its metadata. */
  sessionID: string
  /** Used when the LLM omits an explicit cwd. */
  defaultCwd: string
  /** Channel binding from the originating ingress event. When a Gateway turn
   *  comes in via Slack/Discord/etc, ingress passes (platform, channel,
   *  thread) here so any task this turn creates is bound to that thread.
   *  Without this, follow-up messages on the same thread would not find a
   *  binding and Gateway would create duplicate tasks. */
  channelBinding?: {
    platform: string
    channel: string
    thread: string
    payload?: Record<string, unknown>
  }
}

export function createGatewayTools(ctx: GatewayToolsContext) {
  const resolveCwd = (cwd?: string) => cwd?.trim() || ctx.defaultCwd

  return {
    list_tasks: tool({
      description:
        "List recent tasks for a project (defaults to the current cwd). " +
        "Use this for status queries like 'what's running' or 'show recent tasks'.",
      inputSchema: z.object({
        cwd: z.string().optional().describe("Project working directory; defaults to current cwd."),
        status: z.enum(["queued", "active", "completed", "failed", "cancelled"]).optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
      execute: async ({ cwd, status, limit }) => {
        return Instance.provide({
          directory: resolveCwd(cwd),
          fn: () => {
            const rows = listProjectTasks(Instance.project.id, limit ?? 20)
            const filtered = status ? rows.filter((r) => r.status === status) : rows
            return filtered.map((r) => ({
              id: r.id,
              title: r.title,
              status: r.status,
              priority: r.priority,
              kind: r.kind,
              timeUpdated: r.time_updated,
            }))
          },
        })
      },
    }),

    get_task: tool({
      description: "Fetch full details of a single task (status, request, error, timestamps).",
      inputSchema: z.object({
        taskID: z.string(),
        cwd: z.string().optional(),
      }),
      execute: async ({ taskID, cwd }) =>
        Instance.provide({
          directory: resolveCwd(cwd),
          fn: () => OrchestratorService.getTask(taskID),
        }),
    }),

    cancel_task: tool({
      description:
        "Cancel an active or queued task. Idempotent — cancelling an already-finished " +
        "task is a no-op. Use this when the user explicitly asks to abort.",
      inputSchema: z.object({
        taskID: z.string(),
        cwd: z.string().optional(),
      }),
      execute: async ({ taskID, cwd }) =>
        Instance.provide({
          directory: resolveCwd(cwd),
          fn: () => OrchestratorService.cancelTask(taskID),
        }),
    }),

    enqueue_task: tool({
      description:
        "Create a new task for the user's request. The task-agent decides internally whether the " +
        "work runs as a direct build (single-shot edit/debug via the build agent) or as a full " +
        "pipeline (requirements → architect → execute → deliver). Gateway does NOT make that choice — " +
        "it just enqueues the task with the user's verbatim request.",
      inputSchema: z.object({
        request: z.string().describe("The full task request, paraphrased and clarified by Gateway."),
        title: z.string().describe("Short title (≤80 chars) for task lists."),
        cwd: z.string().optional(),
        priority: z.enum(["critical", "high", "normal", "low"]).optional(),
        attachments: AttachmentInput.array().optional(),
      }),
      execute: async ({ request, title, cwd, priority, attachments }) =>
        Instance.provide({
          directory: resolveCwd(cwd),
          fn: () =>
            OrchestratorService.createTask({
              request,
              title,
              priority,
              attachments,
              kind: "workflow",
              source: "gateway",
              channelBinding: ctx.channelBinding,
              metadata: { gateway: { sessionID: ctx.sessionID } },
            }),
        }),
    }),

    forward_to_task: tool({
      description:
        "Forward a user message as additional context to a running or stopped task. " +
        "Use when the user is continuing a conversation about an in-flight task " +
        "(adding constraints, answering an agent question, supplying missing info, " +
        "asking the agent to retry differently). Equivalent to typing into the task's " +
        "own chat panel. Routes through OrchestratorService.handleTaskMessage so the " +
        "task's own intent classifier picks it up. NOT for clarifications raised via " +
        "Question.ask — use forward_clarification for those.",
      inputSchema: z.object({
        taskID: z.string().describe("Target task ID."),
        text: z.string().describe("The user's message verbatim, minus any '@task' prefix."),
        cwd: z.string().optional(),
      }),
      execute: async ({ taskID, text, cwd }) =>
        Instance.provide({
          directory: resolveCwd(cwd),
          fn: () => OrchestratorService.handleTaskMessage(taskID, { text, source: "gateway" }),
        }),
    }),

    forward_clarification: tool({
      description:
        "Reply to a pending clarification question raised by a running task. The Gateway " +
        "renders Question.Event.Asked into the dialog stream; once the user answers, call " +
        "this tool to unblock the task's `Question.ask` await. The answer is a list of " +
        "selected option labels; for a single free-text answer pass `[text]`.",
      inputSchema: z.object({
        questionID: z.string().describe("ID from the original Question.Event.Asked payload."),
        answers: z
          .array(z.array(z.string()))
          .describe(
            "Per-question answers; each entry is the list of selected labels (or a single-element list for free-text).",
          ),
      }),
      execute: async ({ questionID, answers }) => {
        await Question.reply({ requestID: questionID, answers })
        return { ok: true }
      },
    }),

    switch_cwd: tool({
      description:
        "Change the default cwd for subsequent tool calls in this Gateway session. " +
        "Use when the user says 'now I'm working on project X' or similar. The new cwd " +
        "must be a directory the Project registry recognises.",
      inputSchema: z.object({
        cwd: z.string().describe("Absolute path to the target project directory."),
      }),
      execute: async ({ cwd }) => {
        // Verify the directory resolves to a known project before persisting.
        await Instance.provide({
          directory: cwd,
          fn: () => {
            const project = Project.get(Instance.project.id)
            if (!project) throw new Error(`Project not found for cwd: ${cwd}`)
            return project
          },
        })
        await writeCwd({ sessionID: ctx.sessionID, cwd })
        return { cwd }
      },
    }),
  }
}
