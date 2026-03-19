import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ToolAdapterRegistry, protocolInfo } from "@/executor/protocol"
import { ExecutorDiscovery } from "@/executor/discovery"
import { ExecutorRegistry } from "@/executor/registry"
import { MCPServe } from "@/mcp/serve"
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
  model: z.string().optional(),
})

const EXECUTOR_MODEL_ENV: Record<string, string> = {
  codex: "OPENCORVUS_EXECUTOR_CODEX_MODEL",
  "claude-code": "OPENCORVUS_EXECUTOR_CLAUDE_MODEL",
}

function executorModel(id: string): string {
  const envKey = EXECUTOR_MODEL_ENV[id]
  return envKey ? (process.env[envKey] || "") : ""
}

export const ExecutorRoutes = lazy(() =>
  new Hono()
  .get(
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
      // Auto-register is best-effort — discovery continues regardless
      await ExecutorBootstrap.autoRegister(true).catch(() => undefined)
      const found = await ExecutorDiscovery.scan()
      const opencode = protocolInfo("opencode")
      const codex = protocolInfo("codex")
      const claude = protocolInfo("claude-code")
      const mcpTools = await MCPServe.toolDefinitions("executor")
      const tools = {
        opencode: await ToolAdapterRegistry.declare(ToolAdapterRegistry.context({ provider: "opencode", capabilities: opencode.capabilities })),
        codex: [
          ...mcpTools,
          ...(codex.capabilities.structured_output
            ? [{
                name: "structured_output",
                description: "Return the final response as structured JSON matching the requested schema.",
                inputSchema: {
                  type: "object",
                  properties: {},
                  additionalProperties: true,
                },
                metadata: {
                  surface: "native",
                },
              }]
            : []),
        ],
        claude: mcpTools,
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
          model: executorModel("codex"),
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
          model: executorModel("claude-code"),
        },
      ])
    },
  )
  .patch(
    "/:executorID/model",
    describeRoute({
      summary: "Set executor model",
      description: "Set the model used by an external executor (codex or claude-code).",
      operationId: "executor.setModel",
      responses: {
        200: {
          description: "Model updated",
          content: {
            "application/json": {
              schema: resolver(z.object({ model: z.string() })),
            },
          },
        },
      },
    }),
    validator("param", z.object({ executorID: z.enum(["codex", "claude-code"]) })),
    validator("json", z.object({ model: z.string() })),
    async (c) => {
      const { executorID } = c.req.valid("param")
      const { model } = c.req.valid("json")
      const envKey = EXECUTOR_MODEL_ENV[executorID]
      if (envKey) {
        if (model) {
          process.env[envKey] = model
        } else {
          delete process.env[envKey]
        }
      }
      return c.json({ model: executorModel(executorID) })
    },
  ),
)
