import { afterEach, expect, test } from "bun:test"
import {
  processBelongsToDirectory,
  resolveFrontendPreview,
} from "../src/preview/frontend"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(body: string, contentType = "text/html") {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(body, {
        headers: { "content-type": contentType },
      })
    },
  })
  servers.push(server)
  return server.port
}

test("frontend preview resolver returns a loopback HTML server when explicitly allowed", async () => {
  const port = serve("<!doctype html><html><body>preview</body></html>")
  const result = await resolveFrontendPreview({
    directory: import.meta.dir,
    queryPorts: String(port),
    requireOwnedProcess: false,
  })
  expect(result.url).toBe(`http://127.0.0.1:${port}/`)
  expect(result.source).toBe("port_probe")
  expect(result.port).toBe(port)
})

test("frontend preview resolver rejects non-HTML responses", async () => {
  const port = serve(JSON.stringify({ ok: true }), "application/json")
  const result = await resolveFrontendPreview({
    directory: import.meta.dir,
    queryPorts: String(port),
    requireOwnedProcess: false,
  })
  expect(result.url).toBeNull()
  expect(result.reason).toBe("no_html_document")
})

test("frontend preview resolver excludes the OpenCorvus server port", async () => {
  const port = serve("<!doctype html><html><body>overlay</body></html>")
  const result = await resolveFrontendPreview({
    directory: import.meta.dir,
    queryPorts: String(port),
    excludePorts: [port],
    requireOwnedProcess: false,
  })
  expect(result.url).toBeNull()
  expect(result.reason).toBe("no_preview_ports")
})

test("automatic resolver does not accept unowned loopback ports", async () => {
  const port = serve("<!doctype html><html><body>foreign</body></html>")
  const result = await resolveFrontendPreview({
    directory: import.meta.dir,
    queryPorts: String(port),
    requireOwnedProcess: true,
  })
  expect(result.url).toBeNull()
  expect(result.reason).toBe("no_owned_frontend_document")
})

test("process ownership accepts command lines rooted in the project directory", () => {
  const directory = "D:\\work\\sample-app"
  expect(processBelongsToDirectory({
    port: 5173,
    commandLine: "node D:\\work\\sample-app\\node_modules\\vite\\bin\\vite.js",
  }, directory)).toBe(true)
  expect(processBelongsToDirectory({
    port: 3000,
    commandLine: "node D:\\other\\sample-app\\node_modules\\vite\\bin\\vite.js",
  }, directory)).toBe(false)
})
