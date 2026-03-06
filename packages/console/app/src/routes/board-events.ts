import type { APIEvent } from "@solidjs/start/server"

function upstream() {
  const value = process.env.OPENCORVUS_BOARD_URL ?? process.env.OPENCORVUS_SERVER_URL ?? "http://127.0.0.1:7878"
  return value.endsWith("/") ? value : `${value}/`
}

function auth() {
  const headers = new Headers()
  const password = process.env.OPENCORVUS_SERVER_PASSWORD
  if (!password) return headers
  const username = process.env.OPENCORVUS_SERVER_USERNAME ?? "opencorvus"
  headers.set("authorization", `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`)
  return headers
}

export async function GET(event: APIEvent) {
  const url = new URL(event.request.url)
  const taskID = url.searchParams.get("task_id") ?? ""
  if (!taskID) return new Response("Missing task_id", { status: 400 })

  const target = new URL(`task/${taskID}/events`, upstream())
  const directory = url.searchParams.get("directory")
  if (directory) target.searchParams.set("directory", directory)

  const headers = auth()
  headers.set("accept", "text/event-stream")

  const response = await fetch(target, {
    headers,
  }).catch((error: unknown) => new Response(String(error), { status: 502 }))

  if (!response.ok || !response.body) {
    return new Response(await response.text(), {
      status: response.status || 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
