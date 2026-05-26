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
