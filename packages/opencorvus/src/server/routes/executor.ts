import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ExecutorName } from "@/executor/contract"
import { ToolAdapterRegistry, protocolInfo } from "@/executor/protocol"
import { ExecutorDiscovery } from "@/executor/discovery"
import { ExecutorRegistry } from "@/executor/registry"
import { envKeyFor, getModelOverride, setModelOverride } from "@/executor/runtime-env"
import { NotFoundError } from "../../storage/db"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

const ExecutorToolInfo = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const ExecutorInfo = z.object({
  id: z.enum(["opencorvus", "codex", "claude-code"]),
  label: z.string(),
  registered: z.boolean(),
  discovered: z.boolean(),
  selectable: z.boolean(),
  protocol: z.string(),
  protocolVersion: z.string(),
  transport: z.enum(["inproc", "stdio", "ws", "http"]),
  features: z.record(z.string(), z.unknown()),
  tools: ExecutorToolInfo.array(),
  detail: z.string(),
  version: z.string().optional(),
  model: z.string().optional(),
})

const ExecutorSetModelInput = z
  .object({
    model: z.string().meta({
      description: "Native executor model value. An empty string clears the executor model override.",
    }),
  })
  .strict()

function executorNameParam(value: string) {
  const parsed = ExecutorName.safeParse(value)
  if (!parsed.success) throw new NotFoundError({ message: `unknown executor: ${value}` })
  return parsed.data
}

export const ExecutorRoutes = lazy(() => {
  const app = new Hono()

  app.get(
    "/",
    describeRoute({
      summary: "List executors",
      description:
        "Get executor availability, local discovery state, and whether each executor is selectable for new tasks.",
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
      await ExecutorBootstrap.autoRegister(true)
      const found = await ExecutorDiscovery.scan()
      const opencorvus = protocolInfo("opencorvus")
      const codex = protocolInfo("codex")
      const claude = protocolInfo("claude-code")
      const tools = {
        opencorvus: await ToolAdapterRegistry.declare(
          ToolAdapterRegistry.context({ provider: "opencorvus", capabilities: opencorvus.capabilities }),
        ),
        codex: await ToolAdapterRegistry.declare(
          ToolAdapterRegistry.context({ provider: "codex", capabilities: codex.capabilities }),
        ),
        claude: await ToolAdapterRegistry.declare(
          ToolAdapterRegistry.context({ provider: "claude-code", capabilities: claude.capabilities }),
        ),
      }
      return c.json([
        {
          id: "opencorvus",
          label: "OpenCorvus",
          registered: ExecutorRegistry.has("opencorvus"),
          discovered: found.opencorvus.available,
          selectable: ExecutorRegistry.has("opencorvus"),
          protocol: opencorvus.protocol,
          protocolVersion: opencorvus.version,
          transport: opencorvus.transport.kind,
          features: opencorvus.capabilities,
          tools: tools.opencorvus,
          detail: found.opencorvus.detail,
          version: found.opencorvus.version,
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
          model: getModelOverride("codex"),
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
          model: getModelOverride("claude-code"),
        },
      ])
    },
  )

  app.get(
    "/:executorID/model",
    describeRoute({
      summary: "Get executor model",
      description: "Get the active LLM model for a coding executor.",
      operationId: "executor.getModel",
      responses: {
        200: {
          description: "Current model",
          content: {
            "application/json": {
              schema: resolver(z.object({ model: z.string().optional() })),
            },
          },
        },
      },
    }),
    async (c) => {
      const executorID = executorNameParam(c.req.param("executorID"))
      return c.json({ model: getModelOverride(executorID) })
    },
  )

  app.patch(
    "/:executorID/model",
    describeRoute({
      summary: "Set executor model",
      description: "Set the active LLM model for a coding executor.",
      operationId: "executor.setModel",
      responses: {
        200: {
          description: "Model updated",
          content: {
            "application/json": {
              schema: resolver(z.object({ ok: z.boolean() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("json", ExecutorSetModelInput),
    async (c) => {
      const executorID = executorNameParam(c.req.param("executorID"))
      if (!envKeyFor(executorID)) {
        throw new NotFoundError({ message: `executor does not support model switching: ${executorID}` })
      }
      const body = c.req.valid("json")
      const model = body.model.trim()
      setModelOverride(executorID, model || null)
      return c.json({ ok: true })
    },
  )

  return app
})
