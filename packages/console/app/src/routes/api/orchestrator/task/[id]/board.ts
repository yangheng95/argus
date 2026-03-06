import type { APIEvent } from "@solidjs/start"
import { getTaskBoard } from "~/routes/board/common"

export async function GET(event: APIEvent) {
  const taskID = event.params.id ?? ""
  if (!taskID) return Response.json({ error: "Missing task id" }, { status: 400 })

  const directory = new URL(event.request.url).searchParams.get("directory") ?? undefined
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
