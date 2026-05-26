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

function namedErrorUnionSchema(first: string, second: string, ...rest: string[]) {
  const branch = (name: string) =>
    z.object({
      name: z.literal(name),
      data: z.record(z.string(), z.any()),
    })
  return resolver(
    z.union([branch(first), branch(second), ...rest.map(branch)]),
  )
}

/** Reply route 400 — three NamedError subclasses can land here. The
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
        schema: resolver(NotFoundError.Schema),
      },
    },
  },
  409: {
    description: "Reply target not ready",
    content: {
      "application/json": {
        schema: namedErrorSchema("ReplyTargetEnvelopeMissingError"),
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
} as const

export function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}

/** Reply route's response set — same shape as `errors(...)` but
 *  substitutes REPLY_400_RESPONSE for the generic 400 entry so OpenAPI
 *  documents the actual NamedError union the route returns. */
export function replyRouteErrors(...codes: number[]) {
  return Object.fromEntries(
    codes.map((code) => [code, code === 400 ? REPLY_400_RESPONSE : ERRORS[code as keyof typeof ERRORS]]),
  )
}
