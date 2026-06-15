import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..", "..")

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8")
}

test("host MCP lifecycle stores connection records and closes transports", () => {
  const mcp = source("src/mcp/index.ts")

  expect(mcp).toContain("type McpConnection =")
  expect(mcp).toContain("connections: Record<string, McpConnection>")
  expect(mcp).toContain("Promise.resolve(connection.transport.close())")
  expect(mcp).toContain("await closeConnection(key, existingConnection)")
  expect(mcp).toContain("await closeConnection(name, s.connections[name])")
  expect(mcp).toContain("await closeConnection(clientName, s.connections[clientName])")
  expect(mcp).toContain('id: "host-mcp"')
})
