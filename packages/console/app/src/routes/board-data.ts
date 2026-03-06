import type { APIEvent } from "@solidjs/start/server"
import { getTaskBoard } from "./board/common"

export async function GET(event: APIEvent) {
  const url = new URL(event.request.url)
  const taskID = url.searchParams.get("task_id") ?? ""
  if (!taskID) return Response.json({ error: "Missing task_id" }, { status: 400 })

  const directory = url.searchParams.get("directory") ?? undefined
  const result = await getTaskBoard(taskID, directory).then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }),
  )

  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
      },
      { status: 502 },
    )
  }

  return Response.json(result.data)
}
