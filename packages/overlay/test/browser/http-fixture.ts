import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"

export type BrowserFixtureServer = {
  origin: string
  port: number
  close(): Promise<void>
}

function headersFromIncoming(headers: IncomingHttpHeaders): Headers {
  const out = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) out.append(key, item)
    } else if (value !== undefined) {
      out.set(key, value)
    }
  }
  return out
}

async function bodyFromIncoming(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

async function writeResponse(res: ServerResponse, response: Response) {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(response.status, response.statusText, headers)
  if (res.req.method === "HEAD") {
    res.end()
    return
  }
  res.end(Buffer.from(await response.arrayBuffer()))
}

export async function startBrowserFixture(
  handler: (req: Request) => Response | Promise<Response>,
): Promise<BrowserFixtureServer> {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const host = incoming.headers.host || "127.0.0.1"
      const url = new URL(incoming.url || "/", `http://${host}`)
      const body = await bodyFromIncoming(incoming)
      const response = await handler(
        new Request(url, {
          method: incoming.method || "GET",
          headers: headersFromIncoming(incoming.headers),
          body,
        }),
      )
      await writeResponse(outgoing, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (outgoing.headersSent || outgoing.writableEnded) {
        if (!outgoing.writableEnded) outgoing.end()
        return
      }
      outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      outgoing.end(message)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Browser fixture server did not bind a TCP port")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
