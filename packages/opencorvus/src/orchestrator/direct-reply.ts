import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"

const DIRECT_REPLY_AGENT_KIND_VALUES = [
  "assistant",
  "intent-analysis",
  "requirements",
  "frontend-design",
  "goal",
  "architect",
  "integrity",
  "acceptance",
  "evaluator",
]

export const DIRECT_REPLY_AGENT_KINDS = new Set(DIRECT_REPLY_AGENT_KIND_VALUES)

// A2A means Agent-to-Agent coordination between a task worker and orchestrator.
const A2A_WORKER_CONTROL_AGENT_KIND_VALUES = [
  "build",
  "fact-check",
  "deep-research",
  "frontend-research",
  "visual-qa",
  "goal-workload-analyst",
]

export const DIRECT_AGENT_SESSION_CONTROL_KINDS = new Set([
  ...DIRECT_REPLY_AGENT_KIND_VALUES,
  ...A2A_WORKER_CONTROL_AGENT_KIND_VALUES,
])

export function canReceiveDirectAgentReply(kind: string | undefined): boolean {
  return !!kind && DIRECT_REPLY_AGENT_KINDS.has(kind)
}

export function canReceiveDirectAgentSessionControl(kind: string | undefined): boolean {
  return !!kind && DIRECT_AGENT_SESSION_CONTROL_KINDS.has(kind)
}

// ── Error taxonomy for the direct-reply path ────────────────────────────
//
// All four conditions used to collapse onto plain `Error` and surface as
// HTTP 500, which the overlay could not distinguish from a real server
// crash. They are split into NamedError subclasses so `server/server.ts`
// onError maps each to a precise 4xx/410, and the overlay can react —
// e.g. grey out the reply box when the session is structurally unable
// to continue.

export const InvalidReplyTargetKindError = NamedError.create(
  "InvalidReplyTargetKindError",
  z.object({
    message: z.string(),
    sessionID: z.string(),
    kind: z.string(),
  }),
)

export const ReplyTargetEnvelopeMissingError = NamedError.create(
  "ReplyTargetEnvelopeMissingError",
  z.object({
    message: z.string(),
    sessionID: z.string(),
  }),
)

export const AgentSessionPendingCoordinationError = NamedError.create(
  "AgentSessionPendingCoordinationError",
  z.object({
    message: z.string(),
    taskID: z.string(),
    sessionID: z.string(),
    requestIDs: z.array(z.string()),
  }),
)

export const BuildSessionDirectReplyError = NamedError.create(
  "BuildSessionDirectReplyError",
  z.object({
    message: z.string(),
    sessionID: z.string(),
    /** The session's underlying kind. When sessionKind === "build" the
     *  reply was rejected because the session itself is a build attempt.
     *  When sessionKind !== "build" but envelopeAgent === "build", the
     *  reply was rejected because the last user envelope is tagged to
     *  resume under the build agent (which would wake build tools on a
     *  non-build session, bypassing the build retry lifecycle). The
     *  overlay reads these to render hybrid-specific UX rather than the
     *  generic "kind not allowed" copy. */
    sessionKind: z.string(),
    envelopeAgent: z.string(),
  }),
)

export const SessionRuntimeContractMissingError = NamedError.create(
  "SessionRuntimeContractMissingError",
  z.object({
    message: z.string(),
    sessionID: z.string(),
    agentKind: z.string().optional(),
    reason: z.enum(["missing", "terminal_satisfied"]),
  }),
)
