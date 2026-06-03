import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { ExecutorBootstrap } from "../../src/executor/bootstrap"
import { ExecutorDiscovery } from "../../src/executor/discovery"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const RUN_LIVE = process.env.OPENCORVUS_RUN_LIVE_EXECUTOR_TESTS === "1" || process.env.OPENCORVUS_RUN_LIVE_EXECUTOR_TESTS === "true"
const liveCodex = RUN_LIVE && !!Bun.which("codex") ? test : test.skip
const liveClaude = RUN_LIVE && (!!Bun.which("claude") || !!Bun.which("claude.exe")) ? test : test.skip

const repoRoot = path.resolve(import.meta.dir, "..", "..")
const mcpServerModule = pathToFileURL(path.join(repoRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "mcp.js")).href
const mcpStdioModule = pathToFileURL(path.join(repoRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "stdio.js")).href

afterEach(async () => {
  delete process.env.OPENCORVUS_EXECUTOR_CODEX_MAX_TURNS
  delete process.env.OPENCORVUS_EXECUTOR_CLAUDE_MAX_TURNS
  delete process.env.OPENCORVUS_EXECUTOR_CODEX_SYSTEM
  delete process.env.OPENCORVUS_EXECUTOR_CLAUDE_SYSTEM
  ExecutorRegistry.reset()
  await resetDatabase().catch(() => undefined)
})

describe("official executor live smoke", () => {
  liveCodex(
    "codex app-server can use proxied external MCP tools",
    async () => {
      await runLiveSmoke("codex")
    },
    { timeout: 180_000 },
  )

  liveClaude(
    "claude agent sdk can use proxied external MCP tools",
    async () => {
      await runLiveSmoke("claude-code")
    },
    { timeout: 180_000 },
  )
})

async function runLiveSmoke(executorName: "codex" | "claude-code") {
  const found = await ExecutorDiscovery.scan()
  const target = found[executorName]
  if (!target.available) throw new Error(`executor unavailable: ${executorName}`)

  await using tmp = await tmpdir({ git: true })
  const marker = `mcp-live-${executorName}-${Date.now().toString(36)}`
  const script = path.join(tmp.path, "fixture-mcp.mjs")
  await fs.writeFile(
    script,
    [
      `import { McpServer } from ${JSON.stringify(mcpServerModule)}`,
      `import { StdioServerTransport } from ${JSON.stringify(mcpStdioModule)}`,
      `const server = new McpServer({ name: "fixture", version: "1.0.0" })`,
      `server.registerTool("magic_lookup", { description: "Return the hidden live marker", inputSchema: {} }, async () => ({ content: [{ type: "text", text: ${JSON.stringify(marker)} }] }))`,
      `const transport = new StdioServerTransport()`,
      `await server.connect(transport)`,
      `process.stdin.resume()`,
    ].join("\n"),
    "utf8",
  )

  const bun = Bun.which("bun") ?? process.execPath
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
  )

  process.env.OPENCORVUS_EXECUTOR_CODEX_MAX_TURNS = "4"
  process.env.OPENCORVUS_EXECUTOR_CLAUDE_MAX_TURNS = "4"
  process.env.OPENCORVUS_EXECUTOR_CODEX_SYSTEM =
    "When the user requests a tool by name, call that MCP tool and return exactly the tool output with no extra text."
  process.env.OPENCORVUS_EXECUTOR_CLAUDE_SYSTEM =
    "When the user requests a tool by name, call that MCP tool and return exactly the tool output with no extra text."

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await ExecutorBootstrap.autoRegister(true)
      const executor = ExecutorRegistry.require(executorName)
      const sessionID = `live_${executorName.replace(/[^a-z]/g, "_")}`
      const submitted = await executor.submit({
        sessionID,
        prompt:
          executorName === "claude-code"
            ? "Use ToolSearch to find the MCP tool related to fixture_magic_lookup, then call that exact tool and reply with exactly its output. No extra text."
            : "Use the MCP tool named fixture_magic_lookup and reply with exactly its output. No extra text.",
      })

      const status = await waitForStatus(executor, submitted.queueTaskID)
      if (status.status !== "completed") {
        throw new Error(`executor ${executorName} failed: ${status.error ?? status.status}`)
      }

      const acceptance = await executor.acceptance({ sessionID })
      expect(acceptance.summary).toContain(marker)
    },
  })
}

async function waitForStatus(
  executor: ReturnType<typeof ExecutorRegistry.require>,
  queueTaskID: string,
) {
  let status = await executor.status(queueTaskID)
  for (let index = 0; index < 180 && status.status !== "completed" && status.status !== "failed"; index++) {
    await Bun.sleep(1000)
    status = await executor.status(queueTaskID)
  }
  return status
}
