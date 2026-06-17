import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"
import type { Socket } from "node:net"
import { Readable } from "node:stream"

export type BrowserFixtureServer = {
  origin: string
  port: number
  close(): Promise<void>
}

export type BrowserFixtureOptions = {
  port?: number
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
  if (response.body) {
    await new Promise<void>((resolve, reject) => {
      const stream = Readable.fromWeb(response.body as never)
      const done = () => resolve()
      stream.once("error", reject)
      res.once("error", reject)
      res.once("close", done)
      res.once("finish", done)
      stream.pipe(res)
    })
    return
  }
  res.end(Buffer.from(await response.arrayBuffer()))
}

export async function startBrowserFixture(
  handler: (req: Request) => Response | Promise<Response>,
  options: BrowserFixtureOptions = {},
): Promise<BrowserFixtureServer> {
  const sockets = new Set<Socket>()
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
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError)
      reject(error)
    }
    server.once("error", onError)
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", onError)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Browser fixture server did not bind a TCP port")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
