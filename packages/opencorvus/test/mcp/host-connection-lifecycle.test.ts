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
  expect(mcp).toContain("tools: MCPToolDef[]")
  expect(mcp).toContain("tools,")
  expect(mcp).toContain("type ClosableTransportWithStdioProcess")
  expect(mcp).toContain("type StdioStream")
  expect(mcp).toContain("__opencorvusProcessToClose")
  expect(mcp).toContain("function stdioProcessHasExited")
  expect(mcp).toContain("processToClose.exitCode !== null || processToClose.signalCode !== null")
  expect(mcp).toContain("if (!processToClose?.pid) return")
  expect(mcp).not.toContain("if (!processToClose?.pid || stdioProcessHasExited(processToClose)) return")
  expect(mcp).toContain("function trackStdioTransportProcess")
  expect(mcp).toContain('import { ProcessSupervisor } from "@/shell/process-supervisor"')
  expect(mcp).toContain("await terminateStdioProcessTree(tracked.__opencorvusProcessToClose")
  expect(mcp.indexOf("await terminateStdioProcessTree(tracked.__opencorvusProcessToClose")).toBeLessThan(
    mcp.indexOf("await originalClose()"),
  )
  expect(mcp).toContain("ProcessSupervisor.awaitWithTimeout")
  expect(mcp).toContain('processToClose?.once("close"')
  expect(mcp).toContain("const processAfterClose = processToClose ?? stdioProcessForTransport(transport)")
  expect(mcp).toContain("waitForStdioStreamsClosed(processAfterClose)")
  expect(mcp).toContain("async function closeClientAndTransport")
  expect(mcp).toContain("await closeTransport(name, connection.transport, processToClose)")
  expect(mcp).toContain("await closeConnection(key, existingConnection)")
  expect(mcp).toContain("await closeConnection(name, s.connections[name])")
  expect(mcp).toContain("await closeConnection(clientName, state.connections[clientName])")
  expect(mcp).toContain('id: "host-mcp"')
})
