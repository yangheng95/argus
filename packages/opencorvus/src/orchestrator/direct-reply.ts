import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"

const DIRECT_REPLY_AGENT_KIND_VALUES = [
  "assistant",
  "intent-analysis",
  "requirements",
  "design-analyst",
  "goal",
  "architect",
  "integrity",
  "delivery",
  "evaluator",
]

export const DIRECT_REPLY_AGENT_KINDS = new Set(DIRECT_REPLY_AGENT_KIND_VALUES)

export const DIRECT_AGENT_SESSION_CONTROL_KINDS = new Set([...DIRECT_REPLY_AGENT_KIND_VALUES, "build"])

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

export const BuildSessionDirectReplyError = NamedError.create(
  "BuildSessionDirectReplyError",
  z.object({
    message: z.string(),
    sessionID: z.string(),
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
