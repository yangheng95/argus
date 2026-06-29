import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"

export const OperatorSteerTargetError = NamedError.create(
  "OperatorSteerTargetError",
  z.object({
    message: z.string(),
    taskID: z.string(),
    sessionID: z.string(),
    reason: z.enum(["task_root", "orchestrator_session", "foreign_task", "invalid_kind", "unowned_session"]),
  }),
)

export const OperatorSteerWakeError = NamedError.create(
  "OperatorSteerWakeError",
  z.object({
    message: z.string(),
    taskID: z.string(),
    sessionID: z.string(),
    requestID: z.string(),
    reason: z.enum(["ignored"]),
  }),
)
