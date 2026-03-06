import type { APIEvent } from "@solidjs/start/server"
import { getProjects } from "./board/common"

export async function GET(_: APIEvent) {
  const result = await getProjects().then(
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
