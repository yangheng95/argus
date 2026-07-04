import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "package-mcp-test", version: "1.0.0" })

server.registerTool(
  "snapshot",
  {
    description: "Return scoped package MCP evidence.",
    inputSchema: {
      label: z.string().optional(),
    },
  },
  async ({ label }) => ({
    content: [
      {
        type: "text" as const,
        text: `package-mcp-snapshot:${label ?? ""}:${process.cwd()}`,
      },
    ],
  }),
)

server.registerPrompt(
  "inspect",
  {
    description: "Return scoped package MCP prompt evidence.",
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
          text: `package-mcp-prompt:${label ?? ""}:${process.cwd()}`,
        },
      },
    ],
  }),
)

server.registerResource(
  "dom",
  "package://dom",
  {
    description: "Return scoped package MCP resource evidence.",
    mimeType: "text/plain",
  },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: `package-mcp-resource:${process.cwd()}`,
      },
    ],
  }),
)

await server.connect(new StdioServerTransport())
