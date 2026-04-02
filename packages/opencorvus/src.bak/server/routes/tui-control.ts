import { Hono, type Context } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"

const TuiRequest = z.object({
  id: z.string(),
  path: z.string(),
  body: z.any(),
})
const TuiResponse = z
  .object({
    id: z.string(),
    body: z.any().optional(),
    error: z.string().min(1).optional(),
  })
  .refine((value) => (value.body === undefined) !== (value.error === undefined), {
    message: "exactly one of body or error is required",
  })

type TuiRequest = z.infer<typeof TuiRequest>

const request = [] as TuiRequest[]
const waiter = [] as ((item: TuiRequest) => void)[]
const NEXT_ABORTED = "tui control next aborted"

function pushRequest(item: TuiRequest) {
  const next = waiter.shift()
  if (next) {
    next(item)
    return
  }
  request.push(item)
}

function dropRequest(id: string) {
  const index = request.findIndex((item) => item.id === id)
  if (index >= 0) {
    request.splice(index, 1)
  }
}

function popRequest(signal?: AbortSignal) {
  const next = request.shift()
  if (next) {
    return Promise.resolve(next)
  }
  if (signal?.aborted) {
    return Promise.reject(new Error(NEXT_ABORTED))
  }
  return new Promise<TuiRequest>((resolve, reject) => {
    const item = (value: TuiRequest) => {
      signal?.removeEventListener("abort", onAbort)
      resolve(value)
    }
    const onAbort = () => {
      const index = waiter.indexOf(item)
      if (index >= 0) {
        waiter.splice(index, 1)
      }
      signal?.removeEventListener("abort", onAbort)
      reject(new Error(NEXT_ABORTED))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    waiter.push(item)
  })
}

const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }
>()

async function nextRequest(signal?: AbortSignal) {
  while (true) {
    const item = await popRequest(signal)
    if (signal?.aborted) {
      throw new Error(NEXT_ABORTED)
    }
    if (pending.has(item.id)) {
      return item
    }
  }
}

function timeoutMs() {
  const raw = process.env.OPENCORVUS_TUI_CONTROL_TIMEOUT_MS
  if (!raw) return 60_000
  const value = Number(raw)
  if (!Number.isFinite(value)) return 60_000
  if (value < 1000) return 1000
  return Math.floor(value)
}

export async function callTui(ctx: Context) {
  const body = await ctx.req.json()
  const id = crypto.randomUUID()
  pushRequest({
    id,
    path: ctx.req.path,
    body,
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      dropRequest(id)
      reject(new Error(`tui control response timeout for request ${id}`))
    }, timeoutMs())
    pending.set(id, { resolve, reject, timeout })
  })
}

export const TuiControlRoutes = lazy(() =>
  new Hono()
    .get(
      "/next",
      describeRoute({
        summary: "Get next TUI request",
        description: "Retrieve the next TUI (Terminal User Interface) request from the queue for processing.",
        operationId: "tui.control.next",
        responses: {
          200: {
            description: "Next TUI request",
            content: {
              "application/json": {
                schema: resolver(TuiRequest),
              },
            },
          },
        },
      }),
      async (c) => {
        try {
          const req = await nextRequest(c.req.raw.signal)
          return c.json(req)
        } catch (error) {
          if (error instanceof Error && error.message === NEXT_ABORTED) {
            return c.body(null, 408)
          }
          throw error
        }
      },
    )
    .post(
      "/response",
      describeRoute({
        summary: "Submit TUI response",
        description: "Submit a response to the TUI request queue to complete a pending request.",
        operationId: "tui.control.response",
        responses: {
          200: {
            description: "Response submitted successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("json", TuiResponse),
      async (c) => {
        const body = c.req.valid("json")
        const match = pending.get(body.id)
        if (!match) {
          return c.json(false, 404)
        }
        pending.delete(body.id)
        dropRequest(body.id)
        clearTimeout(match.timeout)
        if (body.error !== undefined) {
          match.reject(new Error(body.error))
        } else {
          match.resolve(body.body)
        }
        return c.json(true)
      },
    ),
)
