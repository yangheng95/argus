import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { WorkLedgerList, listWorkLedger } from "@/work-ledger/projection"
import { errors } from "../error"

const WorkLedgerListQuery = z
  .object({
    directory: z.string().optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursorUpdated: z.coerce.number().optional(),
    cursorRowKey: z.string().optional(),
  })
  .refine((query) => (query.cursorUpdated === undefined) === (query.cursorRowKey === undefined), {
    message: "cursorUpdated and cursorRowKey must be provided together",
    path: ["cursorUpdated"],
  })

export function WorkLedgerRoutes() {
  return new Hono().get(
    "/",
    describeRoute({
      summary: "List Work Ledger rows",
      description:
        "Return one unified Mission, Task, and Chat ledger projection. Mission-owned tasks are nested under their Mission row and excluded from top-level Task rows.",
      operationId: "workLedger.list",
      responses: {
        200: {
          description: "Work Ledger rows",
          content: { "application/json": { schema: resolver(WorkLedgerList) } },
        },
        ...errors(400),
      },
    }),
    validator("query", WorkLedgerListQuery),
    async (c) => c.json(await listWorkLedger(c.req.valid("query"))),
  )
}
