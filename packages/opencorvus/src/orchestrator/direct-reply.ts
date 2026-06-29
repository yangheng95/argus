import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { AgentRoleContract } from "@/agent/role-contract"
import type { SessionKind } from "@/session/session.sql"

const DIRECT_REPLY_NON_ROLE_SESSION_KIND_VALUES = [
  "assistant",
  "goal",
  "acceptance",
  "evaluator",
] as const satisfies readonly SessionKind[]

const DIRECT_REPLY_AGENT_KIND_VALUES = [
  ...DIRECT_REPLY_NON_ROLE_SESSION_KIND_VALUES,
  ...AgentRoleContract.directSessionReplyIDs(),
]

const DIRECT_REPLY_AGENT_KINDS = new Set<string>(DIRECT_REPLY_AGENT_KIND_VALUES)

// A2A means Agent-to-Agent coordination between a task worker and orchestrator.
const A2A_WORKER_CONTROL_AGENT_KIND_VALUES = AgentRoleContract.agentOwnedTaskWorkerIDs()

const DIRECT_AGENT_SESSION_CONTROL_KINDS = new Set<string>([
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

export const AgentDirectReplyDisabledError = NamedError.create(
  "AgentDirectReplyDisabledError",
  z.object({
    message: z.string(),
    sessionID: z.string(),
    /** The session's persisted kind and the latest user envelope agent.
     *  A direct-replyable session may still be rejected when the envelope
     *  would resume a different agent that is not direct-replyable. */
    sessionKind: z.string(),
    envelopeAgent: z.string(),
    reason: z.literal("envelope_agent_not_direct_replyable"),
  }),
)

export const AgentSessionAttachmentReferenceError = NamedError.create(
  "AgentSessionAttachmentReferenceError",
  z.object({
    message: z.string(),
    taskID: z.string(),
    sessionID: z.string(),
    url: z.string(),
    reason: z.enum(["invalid_url", "wrong_project", "missing_attachment", "metadata_mismatch"]),
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
