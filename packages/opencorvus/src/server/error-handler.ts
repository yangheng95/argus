import { NamedError } from "@opencorvus-ai/util/error"
import { HTTPException } from "hono/http-exception"
import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { Log } from "../util/log"
import { NotFoundError } from "../storage/db"
import { badRequestBody } from "./error"

const log = Log.create({ service: "server" })

type NamedErrorLike = Error & {
  name: string
  toObject(): { name: string; data: unknown }
}

function isNamedErrorLike(err: unknown): err is NamedErrorLike {
  if (err instanceof NamedError) return true
  if (!err || typeof err !== "object") return false
  const candidate = err as { name?: unknown; toObject?: unknown }
  return typeof candidate.name === "string" && typeof candidate.toObject === "function"
}

export function requestID(c: { req: { header(name: string): string | undefined }; res: Response }) {
  return c.req.header("x-opencorvus-request-id") ?? c.res.headers.get("x-opencorvus-request-id") ?? crypto.randomUUID()
}

export function namedErrorStatus(err: { name: string }): ContentfulStatusCode {
  if (err.name === "NotFoundError") return 404
  if (err.name === "LogFileNotFoundError") return 404
  if (err.name === "ProviderModelNotFoundError") return 400
  if (err.name === "DirectoryRequiredError") return 400
  if (err.name === "RequestOriginForbiddenError") return 403
  if (err.name === "InvalidInitGitParameterError") return 400
  if (err.name === "ActiveExecutorSessionsError") return 409
  if (err.name === "InvalidDirectoryError") return 400
  if (err.name === "ChildSessionConfigError") return 400
  if (err.name === "WorktreeNotGitError") return 412
  if (err.name.startsWith("Worktree")) return 400
  if (err.name === "InvalidReplyTargetKindError") return 400
  if (err.name === "BuildSessionDirectReplyError") return 400
  if (err.name === "AgentSessionAttachmentReferenceError") return 400
  if (err.name === "ReplyTargetEnvelopeMissingError") return 409
  if (err.name === "AgentSessionPendingCoordinationError") return 409
  if (err.name === "SessionRuntimeContractMissingError") return 410
  if (err.name === "TaskEmptyMessageError") return 400
  if (err.name === "TaskGlobalProjectBindingError") return 409
  if (err.name === "TaskChannelBindingProjectConflictError") return 409
  if (err.name === "TaskCancellationIncompleteError") return 409
  if (err.name === "MissingModelConfigError") return 400
  if (err.name === "PtyCreateFailedError") return 400
  if (err.name === "FileUploadConflictError") return 409
  if (err.name.startsWith("FileUpload")) return 400
  if (err.name === "FileNotFoundError") return 404
  if (err.name === "FileConflictError") return 409
  if (err.name === "FileInvalidPathError") return 400
  if (err.name === "PluginServiceNotFoundError") return 404
  if (err.name === "PluginServiceRegistrationError") return 500
  if (err.name === "PluginServiceDuplicateIDError") return 500
  return 500
}

export function serverErrorResponse(err: Error | unknown, c: Context): Response | Promise<Response> {
  const id = requestID(c)
  c.header("x-opencorvus-request-id", id)
  const namedError = isNamedErrorLike(err)
  const status = namedError ? namedErrorStatus(err) : err instanceof HTTPException ? err.status : 500
  log.error("request failed", {
    requestID: id,
    method: c.req.method,
    path: c.req.path,
    statusCode: status,
    error: err,
  })
  if (namedError) {
    return c.json(err.toObject(), { status })
  }
  if (err instanceof HTTPException) {
    const message = err.message
    if (err.status === 400) {
      return c.json(badRequestBody(message), { status: 400 })
    }
    if (err.status === 404) {
      return c.json(new NotFoundError({ message }).toObject(), { status: 404 })
    }
    return c.json(new NamedError.Unknown({ message }).toObject(), { status })
  }
  const message = err instanceof Error ? err.message : String(err)
  return c.json(new NamedError.Unknown({ message }).toObject(), {
    status: 500,
  })
}
