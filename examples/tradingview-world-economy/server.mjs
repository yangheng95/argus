import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))
const port = Number.parseInt(process.env.PORT || "4187", 10)

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
}

function resolveRequestPath(url) {
  const pathname = new URL(url, `http://127.0.0.1:${port}`).pathname
  const requested = pathname === "/" ? "/index.html" : pathname
  const filePath = normalize(join(root, requested))
  if (!filePath.startsWith(root)) throw new Error("Request path escapes artifact root")
  return filePath
}

const server = createServer(async (request, response) => {
  try {
    const filePath = resolveRequestPath(request.url || "/")
    const file = await stat(filePath)
    if (!file.isFile()) {
      response.writeHead(404)
      response.end("Not found")
      return
    }
    response.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" })
    createReadStream(filePath).pipe(response)
  } catch (error) {
    response.writeHead(404)
    response.end(error instanceof Error ? error.message : "Not found")
  }
})

server.listen(port, "127.0.0.1", () => {
  console.log(`TradingView world economy clone: http://127.0.0.1:${port}`)
})
