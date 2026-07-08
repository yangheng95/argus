import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { appendFileSync } from "node:fs"
import { z } from "zod"

const server = new McpServer({ name: "package-prompt-resource-only-mcp-test", version: "1.0.0" })
const transport = new StdioServerTransport()
let closing = false

if (process.env.OPENCORVUS_MCP_START_LOG) {
  appendFileSync(process.env.OPENCORVUS_MCP_START_LOG, `${process.pid}\n`, "utf8")
}

async function closeFromStdin() {
  if (closing) return
  closing = true
  await server.close().catch(() => undefined)
  process.exit(0)
}

process.stdin.once("end", () => void closeFromStdin())
process.stdin.once("close", () => void closeFromStdin())

server.registerPrompt(
  "inspect",
  {
    description: "Return scoped package MCP prompt evidence without tool support.",
    argsSchema: {
      label: z.string().optional(),
    },
  },
  ({ label }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `no-tool-mcp-prompt:${label ?? ""}:${process.cwd()}`,
        },
      },
    ],
  }),
)

server.registerResource(
  "dom",
  "package://dom",
  {
    description: "Return scoped package MCP resource evidence without tool support.",
    mimeType: "text/plain",
  },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: `no-tool-mcp-resource:${process.cwd()}`,
      },
    ],
  }),
)

await server.connect(transport)
