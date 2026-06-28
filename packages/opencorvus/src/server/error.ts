import { resolver } from "hono-openapi"
import z from "zod"
import { NotFoundError } from "../storage/db"

function namedErrorSchema(name: string) {
  return resolver(
    z
      .object({
        name: z.literal(name),
        data: z.record(z.string(), z.any()),
      })
      .meta({ ref: name }),
  )
}

function namedErrorUnionSchema(first: string, ...rest: string[]) {
  const branch = (name: string) =>
    z.object({
      name: z.literal(name),
      data: z.record(z.string(), z.any()),
    })
  if (rest.length === 0) return resolver(branch(first))
  return resolver(z.union([branch(first), ...rest.map(branch)]))
}

/** Reply route 400 — direct-reply NamedError subclasses can land here. The
 *  generic ERRORS[400] (BadRequestError) only describes the hono
 *  validator shape, which never reaches the reply route's 400s; using
 *  it would be a lie in OpenAPI. codex review 2026-05-26 — minor. */
const REPLY_400_RESPONSE = {
  description: "Reply rejected before persistence",
  content: {
    "application/json": {
      schema: namedErrorUnionSchema(
        "InvalidReplyTargetKindError",
        "BuildSessionDirectReplyError",
        "MissingModelConfigError",
        "AgentSessionAttachmentReferenceError",
      ),
    },
  },
} as const

export const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              data: z.any(),
              errors: z.array(z.record(z.string(), z.any())),
              success: z.literal(false),
            })
            .meta({
              ref: "BadRequestError",
            }),
        ),
      },
    },
  },
  404: {
    description: "Not found",
    content: {
      "application/json": {
        schema: namedErrorUnionSchema("NotFoundError", "LogFileNotFoundError"),
      },
    },
  },
  409: {
    description: "Conflict",
    content: {
      "application/json": {
        schema: namedErrorUnionSchema(
          "ReplyTargetEnvelopeMissingError",
          "AgentSessionPendingCoordinationError",
          "TaskCancellationIncompleteError",
        ),
      },
    },
  },
  410: {
    description: "Session runtime contract no longer present",
    content: {
      "application/json": {
        schema: namedErrorSchema("SessionRuntimeContractMissingError"),
      },
    },
  },
  500: {
    description: "Internal server error",
    content: {
      "application/json": {
        schema: namedErrorSchema("UnknownError"),
      },
    },
  },
} as const

export function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}

export function badRequestBody(message: string) {
  return {
    data: { message },
    errors: [{ message }],
    success: false as const,
  }
}

export function namedErrorResponse(description: string, first: string, ...rest: string[]) {
  return {
    description,
    content: {
      "application/json": {
        schema: namedErrorUnionSchema(first, ...rest),
      },
    },
  }
}

export const ActiveExecutorSessionsResponse = namedErrorResponse(
  "Active executor sessions prevent this operation",
  "ActiveExecutorSessionsError",
)

/** Reply route's response set — same shape as `errors(...)` but
 *  substitutes REPLY_400_RESPONSE for the generic 400 entry so OpenAPI
 *  documents the actual NamedError union the route returns. */
export function replyRouteErrors(...codes: number[]) {
  return Object.fromEntries(
    codes.map((code) => [code, code === 400 ? REPLY_400_RESPONSE : ERRORS[code as keyof typeof ERRORS]]),
  )
}
