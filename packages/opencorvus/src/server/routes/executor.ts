import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ToolAdapterRegistry, protocolInfo } from "@/executor/protocol"
import { ExecutorDiscovery } from "@/executor/discovery"
import { ExecutorRegistry } from "@/executor/registry"
import { lazy } from "../../util/lazy"

const ExecutorToolInfo = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

const ExecutorInfo = z.object({
  id: z.enum(["opencode", "codex", "claude-code"]),
  label: z.string(),
  registered: z.boolean(),
  discovered: z.boolean(),
  selectable: z.boolean(),
  protocol: z.string(),
  protocolVersion: z.string(),
  transport: z.enum(["inproc", "stdio", "ws", "http"]),
  features: z.record(z.string(), z.any()),
  tools: ExecutorToolInfo.array(),
  detail: z.string(),
  version: z.string().optional(),
})

export const ExecutorRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "List executors",
      description: "Get executor availability, local discovery state, and whether each executor is selectable for new tasks.",
      operationId: "executor.list",
      responses: {
        200: {
          description: "Executor status",
          content: {
            "application/json": {
              schema: resolver(ExecutorInfo.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      await ExecutorBootstrap.autoRegister(true).catch(() => undefined)
      const found = await ExecutorDiscovery.scan()
      const opencode = protocolInfo("opencode")
      const codex = protocolInfo("codex")
      const claude = protocolInfo("claude-code")
      const tools = {
        opencode: await ToolAdapterRegistry.declare(ToolAdapterRegistry.context({ provider: "opencode", capabilities: opencode.capabilities })),
        codex: await ToolAdapterRegistry.declare(ToolAdapterRegistry.context({ provider: "codex", capabilities: codex.capabilities })),
        claude: await ToolAdapterRegistry.declare(ToolAdapterRegistry.context({ provider: "claude-code", capabilities: claude.capabilities })),
      }
      return c.json([
        {
          id: "opencode",
          label: "Opencode",
          registered: ExecutorRegistry.has("opencode"),
          discovered: found.opencode.available,
          selectable: ExecutorRegistry.has("opencode"),
          protocol: opencode.protocol,
          protocolVersion: opencode.version,
          transport: opencode.transport.kind,
          features: opencode.capabilities,
          tools: tools.opencode,
          detail: found.opencode.detail,
          version: found.opencode.version,
        },
        {
          id: "codex",
          label: "Codex",
          registered: ExecutorRegistry.has("codex"),
          discovered: found.codex.available,
          selectable: ExecutorRegistry.has("codex"),
          protocol: codex.protocol,
          protocolVersion: codex.version,
          transport: codex.transport.kind,
          features: codex.capabilities,
          tools: tools.codex,
          detail: found.codex.detail,
          version: found.codex.version,
        },
        {
          id: "claude-code",
          label: "Claude Code",
          registered: ExecutorRegistry.has("claude-code"),
          discovered: found["claude-code"].available,
          selectable: ExecutorRegistry.has("claude-code"),
          protocol: claude.protocol,
          protocolVersion: claude.version,
          transport: claude.transport.kind,
          features: claude.capabilities,
          tools: tools.claude,
          detail: found["claude-code"].detail,
          version: found["claude-code"].version,
        },
      ])
    },
  ),
)
