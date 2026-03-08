import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ExecutorDiscovery } from "@/executor/discovery"
import { ExecutorRegistry } from "@/executor/registry"
import { lazy } from "../../util/lazy"

const ExecutorInfo = z.object({
  id: z.enum(["opencode", "codex", "claude-code"]),
  label: z.string(),
  registered: z.boolean(),
  discovered: z.boolean(),
  selectable: z.boolean(),
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
      return c.json([
        {
          id: "opencode",
          label: "Opencode",
          registered: ExecutorRegistry.has("opencode"),
          discovered: found.opencode.available,
          selectable: ExecutorRegistry.has("opencode"),
          detail: found.opencode.detail,
          version: found.opencode.version,
        },
        {
          id: "codex",
          label: "Codex",
          registered: ExecutorRegistry.has("codex"),
          discovered: found.codex.available,
          selectable: ExecutorRegistry.has("codex"),
          detail: found.codex.detail,
          version: found.codex.version,
        },
        {
          id: "claude-code",
          label: "Claude Code",
          registered: ExecutorRegistry.has("claude-code"),
          discovered: found["claude-code"].available,
          selectable: ExecutorRegistry.has("claude-code"),
          detail: found["claude-code"].detail,
          version: found["claude-code"].version,
        },
      ])
    },
  ),
)
