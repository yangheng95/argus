import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { ComputerBackend } from "./backend"
import { HostComputerBackend } from "./host-client"
import { ComputerController, type ObservationBinding } from "./controller"
import { ComputerError, computerError } from "./errors"

const ok = <T extends Record<string, unknown>>(data: T) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: data,
})

const fail = (error: unknown) => {
  const normalized = computerError(error)
  const data = {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    },
  }
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  }
}

const bindingSchema = {
  computer_id: z.string().min(1),
  display_id: z.string().min(1),
  observation_id: z.string().min(1),
  observation_digest: z.string().regex(/^[a-f0-9]{64}$/),
}

const userAuthority =
  "Stop before any irreversible external effect and leave the final confirmation or control to the user through the guest viewer."

function binding(input: {
  computer_id: string
  display_id: string
  observation_id: string
  observation_digest: string
}): ObservationBinding {
  return {
    computerId: input.computer_id,
    displayId: input.display_id,
    observationId: input.observation_id,
    observationDigest: input.observation_digest,
  }
}

function withError<T extends Record<string, unknown>>(run: () => Promise<T>) {
  return run().then(ok, fail)
}

export function createComputerMcpServer(options: { backend?: ComputerBackend } = {}) {
  const server = new McpServer({ name: "opencorvus-computer", version: "1.0.0" })
  const controller = new ComputerController(options.backend ?? HostComputerBackend.fromEnvironment())

  server.registerTool(
    "session_create",
    {
      description:
        "Create one isolated Virtual Machine computer session from the configured self-contained runtime bundle. This never controls the host desktop. Human viewing and takeover remain in the authenticated native Computer surface and are not exposed to the model.",
      inputSchema: {},
    },
    async () =>
      withError(async () => {
        const created = await controller.create()
        return {
          ok: true,
          computer_id: created.computerId,
          display_id: created.displayId,
          runtime_bundle_id: created.bundleId,
        }
      }),
  )

  server.registerTool(
    "observe",
    {
      description:
        "Capture the current guest display. Later input must repeat the exact returned computer, display, observation, and digest identities.",
      inputSchema: {
        computer_id: z.string().min(1),
        display_id: z.string().min(1),
      },
    },
    async ({ computer_id, display_id }) => {
      try {
        const observed = await controller.observe({ computerId: computer_id, displayId: display_id })
        const structuredContent = {
          ok: true,
          computer_id: observed.computerId,
          display_id: observed.displayId,
          observation_id: observed.observationId,
          observation_digest: observed.observationDigest,
          width: observed.width,
          height: observed.height,
          mime_type: "image/png",
        }
        return {
          content: [
            { type: "image" as const, data: observed.pngBase64, mimeType: "image/png" as const },
            { type: "text" as const, text: JSON.stringify(structuredContent) },
          ],
          structuredContent,
        }
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    "click",
    {
      description: `Send exactly one click to the exact observed guest display. This does not observe or retry. ${userAuthority}`,
      inputSchema: {
        ...bindingSchema,
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        button: z.enum(["left", "right"]).default("left"),
      },
    },
    async (input) =>
      withError(async () => ({
        ok: true,
        ...(await controller.act(binding(input), {
          kind: "click",
          x: input.x,
          y: input.y,
          button: input.button,
        })),
      })),
  )

  server.registerTool(
    "type_text",
    {
      description: `Type exact text into the guest display bound to the exact latest observation. This does not observe or retry. ${userAuthority}`,
      inputSchema: { ...bindingSchema, text: z.string().max(100_000) },
    },
    async (input) =>
      withError(async () => ({
        ok: true,
        ...(await controller.act(binding(input), { kind: "type_text", text: input.text })),
      })),
  )

  server.registerTool(
    "keypress",
    {
      description: `Send one explicit key chord to the exact observed guest display. This does not observe or retry. ${userAuthority}`,
      inputSchema: { ...bindingSchema, keys: z.array(z.string().min(1)).min(1).max(8) },
    },
    async (input) =>
      withError(async () => ({
        ok: true,
        ...(await controller.act(binding(input), { kind: "keypress", keys: input.keys })),
      })),
  )

  server.registerTool(
    "scroll",
    {
      description: `Send one scroll delta to the exact observed guest display. This does not observe or retry. ${userAuthority}`,
      inputSchema: {
        ...bindingSchema,
        delta_x: z.number().int(),
        delta_y: z.number().int(),
      },
    },
    async (input) =>
      withError(async () => ({
        ok: true,
        ...(await controller.act(binding(input), {
          kind: "scroll",
          deltaX: input.delta_x,
          deltaY: input.delta_y,
        })),
      })),
  )

  server.registerTool(
    "drag",
    {
      description: `Send one bounded drag to the exact observed guest display. This does not observe or retry. ${userAuthority}`,
      inputSchema: {
        ...bindingSchema,
        from_x: z.number().int().nonnegative(),
        from_y: z.number().int().nonnegative(),
        to_x: z.number().int().nonnegative(),
        to_y: z.number().int().nonnegative(),
        duration_ms: z.number().int().min(50).max(10_000).default(500),
      },
    },
    async (input) =>
      withError(async () => ({
        ok: true,
        ...(await controller.act(binding(input), {
          kind: "drag",
          from: { x: input.from_x, y: input.from_y },
          to: { x: input.to_x, y: input.to_y },
          durationMs: input.duration_ms,
        })),
      })),
  )

  server.registerTool(
    "session_destroy",
    {
      description: "Destroy the exact isolated Computer session and release its guest resources.",
      inputSchema: { computer_id: z.string().min(1) },
    },
    async ({ computer_id }) =>
      withError(async () => ({ ok: true, ...(await controller.destroy({ computerId: computer_id })) })),
  )

  return { server, controller }
}

export function computerToolErrorCode(error: unknown): ComputerError["code"] {
  return computerError(error).code
}
