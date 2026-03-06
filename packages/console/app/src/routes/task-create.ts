import type { APIEvent } from "@solidjs/start/server"
import { CreateTaskRequest, createTask } from "./board/common"

export async function POST(event: APIEvent) {
  const input = await event.request.json().then(
    (body) => CreateTaskRequest.parse(body),
    () => undefined,
  )
  if (!input) return Response.json({ error: "Invalid task create payload" }, { status: 400 })

  const result = await createTask(input).then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 502 })
  }
  return Response.json(result.data, { status: 202 })
}
