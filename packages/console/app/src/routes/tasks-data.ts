import type { APIEvent } from "@solidjs/start/server"
import { getProjectBoard } from "./board/common"

export async function GET(event: APIEvent) {
  const directory = new URL(event.request.url).searchParams.get("directory") ?? undefined
  const result = await getProjectBoard(directory).then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 502 })
  }
  return Response.json(result.data)
}
