import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createServer } from "http"
import { createMcpServer } from "./tools.js"
import { handleMonitorRequest } from "./monitor.js"
import { BrowserMCPBuiltin } from "./builtin"

export namespace BrowserMCP {
  export const ServerName = BrowserMCPBuiltin.ServerName
  export const command = BrowserMCPBuiltin.command
  export const localConfig = BrowserMCPBuiltin.localConfig

  export async function serveHttp(port = Number(process.env.PORT ?? 8931)) {
    const httpServer = createServer(async (req, res) => {
      if (await handleMonitorRequest(req, res)) return

      if (req.url === "/mcp") {
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, last-event-id")

        if (req.method === "OPTIONS") {
          res.writeHead(204)
          res.end()
          return
        }

        const server = createMcpServer()
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        res.on("close", () => {
          transport.close()
          server.close()
        })
        await server.connect(transport)
        await transport.handleRequest(req, res)
        return
      }

      res.writeHead(404)
      res.end()
    })

    httpServer.listen(port, () => {
      console.error(`[browser-mcp] HTTP server listening on :${port}`)
    })
  }

  export async function serveStdio() {
    const server = createMcpServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}
