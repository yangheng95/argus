import { afterEach, describe, expect, mock, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { JsonRpcLineTransport } from "../../src/executor/protocol/json-rpc"
import { Instance } from "../../src/project/instance"
import { Installation } from "../../src/installation"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const repoRoot = path.resolve(import.meta.dir, "..", "..")
const mcpServerModule = pathToFileURL(path.join(repoRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "mcp.js")).href
const mcpStdioModule = pathToFileURL(path.join(repoRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "stdio.js")).href

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await resetDatabase().catch(() => undefined)
})

describe("mcp.serve integration", () => {
  test(
    "proxies external MCP tools, prompts, and resources through opencorvus mcp serve",
    async () => {
      mock.restore()
      await using tmp = await tmpdir({ git: true })
      const script = path.join(tmp.path, "fixture-mcp.mjs")
      const bun = Bun.which("bun") ?? process.execPath
      const marker = `fixture-${Date.now().toString(36)}`

      await fs.writeFile(
        script,
        [
          `import { McpServer } from ${JSON.stringify(mcpServerModule)}`,
          `import { StdioServerTransport } from ${JSON.stringify(mcpStdioModule)}`,
          `import * as z from "zod/v4"`,
          `const server = new McpServer({ name: "fixture", version: "1.0.0" })`,
          `server.registerTool("magic_lookup", { description: "Return marker", inputSchema: {} }, async () => ({ content: [{ type: "text", text: ${JSON.stringify(marker)} }] }))`,
          `server.registerPrompt("review_prompt", { description: "Fixture prompt", argsSchema: { topic: z.string().describe("Topic") } }, async ({ topic }) => ({ messages: [{ role: "user", content: { type: "text", text: "prompt:" + topic } }] }))`,
          `server.registerResource("fixture_resource", "fixture://readme", { description: "Fixture resource", mimeType: "text/plain" }, async () => ({ contents: [{ uri: "fixture://readme", text: "resource:${marker}" }] }))`,
          `const transport = new StdioServerTransport()`,
          `await server.connect(transport)`,
          `process.stdin.resume()`,
        ].join("\n"),
        "utf8",
      )

      await fs.writeFile(
        path.join(tmp.path, "opencorvus.json"),
        JSON.stringify(
          {
            $schema: "https://opencorvus.ai/config.json",
            mcp: {
              fixture: {
                type: "local",
                command: [bun, script],
                enabled: true,
                timeout: 10_000,
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      )

      const cmd = Installation.command(["mcp", "serve", "--cwd", tmp.path, "--toolset", "executor"])
      const transport = JsonRpcLineTransport.create({
        command: [cmd.command, ...cmd.args],
        cwd: repoRoot,
        env: {
          ...process.env,
          ...cmd.env,
        },
      })

      try {
        await transport.request("initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {
            prompts: { listChanged: true },
            resources: { listChanged: true },
            tools: { listChanged: true },
          },
          clientInfo: {
            name: "mcp-serve-test",
            version: "1.0.0",
          },
        })
        await transport.notify("notifications/initialized", {})

        const tools = await transport.request("tools/list") as { tools: Array<{ name: string }> }
        expect(tools.tools.some((item) => item.name === "fixture_magic_lookup")).toBe(true)

        const toolResult = await transport.request("tools/call", {
          name: "fixture_magic_lookup",
          arguments: {},
        })
        expect(JSON.stringify(toolResult)).toContain(marker)

        const prompts = await transport.request("prompts/list") as { prompts: Array<{ name: string; description?: string }> }
        const prompt = prompts.prompts.find((item) => item.name === "fixture:review_prompt")
        expect(prompt?.description).toContain("Fixture prompt")

        const promptResult = await transport.request("prompts/get", {
          name: "fixture:review_prompt",
          arguments: {
            topic: "test",
          },
        })
        expect(JSON.stringify(promptResult)).toContain("prompt:test")

        const resources = await transport.request("resources/list") as { resources: Array<{ name: string; uri: string }> }
        const resource = resources.resources.find((item) => item.name === "fixture_resource")
        expect(resource?.uri.startsWith("opencorvus://mcp-resource/")).toBe(true)

        const resourceResult = await transport.request("resources/read", {
          uri: resource?.uri ?? "",
        })
        expect(JSON.stringify(resourceResult)).toContain(`resource:${marker}`)
      } finally {
        await transport.close().catch(() => undefined)
      }
    },
    { timeout: 60_000 },
  )

})
