import type { APIEvent } from "@solidjs/start/server"
import { RejectInteractionInput, rejectInteraction } from "./board/common"

export async function POST(event: APIEvent) {
  const input = await event.request.json().then(
    (body) => RejectInteractionInput.parse(body),
    () => undefined,
  )
  if (!input) return Response.json({ error: "Invalid interaction reject payload" }, { status: 400 })

  const result = await rejectInteraction(input).then(
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
