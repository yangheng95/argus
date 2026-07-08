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
  expect(mcp).toContain("class SupervisedStdioClientTransport implements Transport")
  expect(mcp).toContain("ProcessSupervisor.spawnCommand")
  expect(mcp).toContain("new SupervisedStdioClientTransport({")
  expect(mcp).not.toContain("new StdioClientTransport({")
  expect(mcp).toContain("const STDIO_GRACEFUL_CLOSE_TIMEOUT_MS = 5_000")
  expect(mcp).toContain("private lastHandle?: ProcessSupervisor.Handle")
  expect(mcp).toContain("this.lastHandle = handle")
  expect(mcp).toContain("const handle = this.handle ?? this.lastHandle")
  expect(mcp).toContain("__opencorvusProcessToClose")
  expect(mcp).toContain("const closedStdioProcesses = new WeakSet<StdioChildProcess>()")
  expect(mcp).toContain("function stdioProcessHasExited")
  expect(mcp).toContain("function stdioProcessHasClosed")
  expect(mcp).toContain("function trackStdioProcessClose")
  expect(mcp).toContain("processToClose.exitCode !== null || processToClose.signalCode !== null")
  expect(mcp).toContain("if (!processToClose?.pid || stdioProcessHasExited(processToClose)) return")
  expect(mcp).toContain("function trackStdioTransportProcess")
  expect(mcp).toContain("async function settleClosedProcessHandle()")
  expect(mcp).toContain("setImmediate(resolve)")
  expect(mcp).toContain("setTimeout(resolve, 0)")
  expect(mcp).toContain("const connecting = objectValues(state.connecting)")
  expect(mcp).toContain("const settledConnections = await Promise.allSettled(connecting)")
  expect(mcp).toContain("for (const key of Object.keys(state.connecting)) delete state.connecting[key]")
  expect(mcp).toContain("for (const key of Object.keys(state.connections)) delete state.connections[key]")
  expect(mcp).toContain("for (const key of Object.keys(state.clients)) delete state.clients[key]")
  expect(mcp).toContain('import { ProcessSupervisor } from "@/shell/process-supervisor"')
  expect(mcp).toContain("let closePromise: Promise<void> | undefined")
  expect(mcp).toContain("closePromise ??= Promise.resolve(originalClose())")
  expect(mcp).toContain("const processClosedAfterClose = await waitForStdioProcessClose(processAfterClose)")
  expect(mcp).toContain('await terminateStdioProcessTree(processAfterClose, "MCP stdio transport")')
  expect(
    mcp.indexOf("const processClosedAfterClose = await waitForStdioProcessClose(processAfterClose)"),
  ).toBeLessThan(
    mcp.indexOf('await terminateStdioProcessTree(processAfterClose, "MCP stdio transport")'),
  )
  expect(mcp).toContain("const processClosedAfterTerminate = await waitForStdioProcessClose(processAfterClose)")
  expect(mcp).toContain("ProcessSupervisor.awaitWithTimeout")
  expect(mcp).toContain('processToClose?.once("close"')
  expect(mcp).toContain("const processAfterClose = processToClose ?? stdioProcessForTransport(transport)")
  expect(mcp).toContain("waitForStdioStreamsClosed(processAfterClose)")
  expect(mcp).toContain("waitForSupervisorStreamClose(handle.stdin")
  expect(mcp).toContain("await settleClosedProcessHandle()")
  expect(mcp).toContain("async function closeClientAndTransport")
  expect(mcp).toContain("await closeTransport(name, connection.transport, processToClose)")
  expect(mcp).toContain("await closeConnection(key, existingConnection)")
  expect(mcp).toContain("await closeConnection(name, s.connections[name])")
  expect(mcp).toContain("await closeConnection(clientName, state.connections[clientName])")
  expect(mcp).toContain('id: "host-mcp"')
})
