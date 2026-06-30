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

const BAD_REQUEST_SCHEMA = z.object({
  data: z.any(),
  error: z.array(z.record(z.string(), z.any())),
  success: z.literal(false),
}).meta({
  ref: "BadRequestError",
})

/** Reply route 400 — direct-reply NamedError subclasses can land here. The
 *  generic ERRORS[400] (BadRequestError) describes validator and manual
 *  bad-request bodies, not reply-specific NamedError subclasses. */
const REPLY_400_RESPONSE = {
  description: "Reply rejected before persistence",
  content: {
    "application/json": {
      schema: namedErrorUnionSchema(
        "InvalidReplyTargetKindError",
        "AgentDirectReplyDisabledError",
        "MissingModelConfigError",
        "AgentSessionAttachmentReferenceError",
      ),
    },
  },
} as const

const OPERATOR_STEER_400_RESPONSE = {
  description: "Operator steer target or request body rejected",
  content: {
    "application/json": {
      schema: resolver(
        z.union([
          z.object({
            name: z.literal("OperatorSteerTargetError"),
            data: z.record(z.string(), z.any()),
          }),
          BAD_REQUEST_SCHEMA,
        ]),
      ),
    },
  },
} as const

const OPERATOR_STEER_409_RESPONSE = namedErrorResponse(
  "Operator steer conflict",
  "AgentSessionPendingCoordinationError",
  "OperatorSteerWakeError",
)

export const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(BAD_REQUEST_SCHEMA),
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
    error: [{ message }],
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

export function badRequestOrNamedErrorResponse(description: string, first: string, ...rest: string[]) {
  const branch = (name: string) =>
    z.object({
      name: z.literal(name),
      data: z.record(z.string(), z.any()),
    })
  return {
    description,
    content: {
      "application/json": {
        schema: resolver(z.union([BAD_REQUEST_SCHEMA, branch(first), ...rest.map(branch)])),
      },
    },
  }
}

const OPERATOR_STEER_400_RESPONSE = badRequestOrNamedErrorResponse(
  "Operator steer target or request body rejected",
  "OperatorSteerTargetError",
)

const OPERATOR_STEER_409_RESPONSE = namedErrorResponse(
  "Operator steer conflict",
  "AgentSessionPendingCoordinationError",
  "OperatorSteerWakeError",
)

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

export function operatorSteerRouteErrors(...codes: number[]) {
  return Object.fromEntries(
    codes.map((code) => [
      code,
      code === 400
        ? OPERATOR_STEER_400_RESPONSE
        : code === 409
          ? OPERATOR_STEER_409_RESPONSE
          : ERRORS[code as keyof typeof ERRORS],
    ]),
  )
}
