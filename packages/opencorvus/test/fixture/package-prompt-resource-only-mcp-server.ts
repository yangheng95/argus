import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "package-prompt-resource-only-mcp-test", version: "1.0.0" })

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

await server.connect(new StdioServerTransport())
