import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { resolveFrontendPreview } from "@/preview/frontend"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"

const FrontendPreviewQuery = z.object({
  ports: z.string().optional(),
  allowUnowned: z.enum(["true", "false"]).optional(),
})

const FrontendPreviewResponse = z.object({
  url: z.string().nullable(),
  source: z.enum(["port_probe"]).nullable(),
  port: z.number().int().nullable(),
  checkedPorts: z.number().int().array(),
  reason: z.string().optional(),
})

export function PreviewRoutes() {
  return new Hono()
    .get(
      "/frontend",
      describeRoute({
        summary: "Resolve live frontend preview URL",
        description: "Resolve a loopback HTTP frontend page for the active project without serving static HTML.",
        operationId: "preview.frontend",
        responses: {
          200: {
            description: "Frontend preview resolution",
            content: {
              "application/json": {
                schema: resolver(FrontendPreviewResponse),
              },
            },
          },
        },
      }),
      validator("query", FrontendPreviewQuery),
      async (c) => {
        const query = c.req.valid("query")
        const config = await Config.get()
        const current = new URL(c.req.url)
        const ownPort = Number(current.port)
        const result = await resolveFrontendPreview({
          directory: Instance.directory,
          configuredPorts: config.preview?.ports,
          queryPorts: query.ports,
          excludePorts: Number.isInteger(ownPort) && ownPort > 0 ? [ownPort] : [],
          requireOwnedProcess: query.allowUnowned === "true" ? false : true,
        })
        return c.json(result)
      },
    )
}
