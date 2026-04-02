import { Server } from "@/server/server"

export const IN_PROCESS_BASE_URL = "http://opencorvus.internal"

export function serverAuthorizationHeader() {
  const password = process.env.OPENCORVUS_SERVER_PASSWORD?.trim()
  if (!password) return undefined
  const username = process.env.OPENCORVUS_SERVER_USERNAME?.trim() || "opencorvus"
  return `Basic ${btoa(`${username}:${password}`)}`
}

export function createInProcessRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
  authorization = serverAuthorizationHeader(),
) {
  const request = new Request(input, init)
  if (!authorization) return request
  if (request.headers.has("authorization") || request.headers.has("Authorization")) return request
  request.headers.set("Authorization", authorization)
  return request
}

export function createInProcessFetch(input?: { authorization?: string }) {
  return (async (request: RequestInfo | URL, init?: RequestInit) => {
    return Server.App().fetch(createInProcessRequest(request, init, input?.authorization))
  }) as typeof globalThis.fetch
}

export async function fetchInProcessServer(input: {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  authorization?: string
}) {
  const response = await Server.App().fetch(
    createInProcessRequest(
      input.url,
      {
        method: input.method,
        headers: input.headers,
        body: input.body,
      },
      input.authorization,
    ),
  )
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  }
}
