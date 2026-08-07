import https, { type RequestOptions } from "node:https"
import type { IncomingHttpHeaders } from "node:http"
import { Readable } from "node:stream"

/**
 * Hexin's provider-owned network endpoint.
 *
 * Keep the HTTPS origin unchanged so HTTP Host and Transport Layer Security
 * (TLS) Server Name Indication (SNI) remain bound to the certificate hostname.
 * Only the socket lookup is pinned to the reachable private address.
 */
export const HEXIN_ENDPOINT = {
  url: "https://aimemodeldev.myhexin.com/litellm/v1",
  hostname: "aimemodeldev.myhexin.com",
  address: "172.20.210.183",
  family: 4,
} as const

type EndpointFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

let testFetch: EndpointFetch | undefined

export function resolveHexinEndpoint(hostname: string): { address: string; family: 4 } {
  if (hostname !== HEXIN_ENDPOINT.hostname) {
    throw new Error(`Hexin endpoint dispatcher received unexpected hostname ${hostname}`)
  }
  return {
    address: HEXIN_ENDPOINT.address,
    family: HEXIN_ENDPOINT.family,
  }
}

const hexinLookup = ((hostname, options, callback) => {
  let endpoint: ReturnType<typeof resolveHexinEndpoint>
  try {
    endpoint = resolveHexinEndpoint(hostname)
  } catch (error) {
    callback(error as Error, "")
    return
  }
  if (typeof options === "object" && options.all) {
    callback(null, [endpoint])
    return
  }
  callback(null, endpoint.address, endpoint.family)
}) as NonNullable<RequestOptions["lookup"]>

export function hexinRequestOptions(signal: AbortSignal): Pick<
  RequestOptions,
  "lookup" | "rejectUnauthorized" | "servername" | "signal"
> & { lookup: NonNullable<RequestOptions["lookup"]> } {
  return {
    lookup: hexinLookup,
    rejectUnauthorized: true,
    servername: HEXIN_ENDPOINT.hostname,
    signal,
  }
}

function responseHeaders(input: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
      continue
    }
    if (value !== undefined) headers.set(name, value)
  }
  return headers
}

async function requestBody(request: Request): Promise<Buffer | undefined> {
  if (!request.body || request.method === "GET" || request.method === "HEAD") return
  return Buffer.from(await request.arrayBuffer())
}

async function fetchWithPinnedSocket(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const target = new URL(request.url)
  if (target.hostname !== HEXIN_ENDPOINT.hostname) {
    throw new Error(`Hexin endpoint fetch received unexpected hostname ${target.hostname}`)
  }
  const body = await requestBody(request)

  return new Promise<Response>((resolve, reject) => {
    const outgoing = https.request(
      target,
      {
        ...hexinRequestOptions(request.signal),
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
      },
      (incoming) => {
        const status = incoming.statusCode
        if (!status) {
          const error = new Error("Hexin endpoint response is missing an HTTP status")
          incoming.destroy(error)
          reject(error)
          return
        }
        resolve(
          new Response(Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>, {
            status,
            statusText: incoming.statusMessage,
            headers: responseHeaders(incoming.headers),
          }),
        )
      },
    )
    outgoing.once("error", reject)
    outgoing.end(body)
  })
}

export async function fetchHexinEndpoint(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (testFetch) return await testFetch(input, init)
  return fetchWithPinnedSocket(input, init)
}

/**
 * Install a request recorder for isolated contract tests without changing the
 * production endpoint declaration or transport.
 */
export function installHexinEndpointTestFetch(fetcher: EndpointFetch): () => void {
  testFetch = fetcher
  return () => {
    if (testFetch === fetcher) testFetch = undefined
  }
}
