import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { BrowserPreviewTarget, resolveBrowserPreviewTarget } from "../../browser-preview/target"
import { BrowserPreviewVerification, verifyBrowserPreview } from "../../browser-preview/verification"
import { BrowserPreviewViewportID } from "../../browser-preview/viewport"

export const BrowserPreviewRoutes = lazy(() =>
  new Hono()
    .get(
      "/target",
      describeRoute({
        summary: "Resolve browser preview target",
        description:
          "Return the single project-scoped browser preview target. The route uses an explicit URL query or package.json opencorvus.browserPreview metadata; it never guesses ports or package roots.",
        operationId: "browserPreview.target",
        responses: {
          200: {
            description: "Browser preview target",
            content: {
              "application/json": {
                schema: resolver(BrowserPreviewTarget),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          url: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const target = await resolveBrowserPreviewTarget({
          projectRoot: Instance.directory,
          explicitUrl: query.url,
        })
        return c.json(target)
      },
    )
    .post(
      "/verify",
      describeRoute({
        summary: "Capture browser preview verification evidence",
        description:
          "Resolve the project-scoped preview target and capture Playwright-backed screenshot evidence for one shared viewport preset.",
        operationId: "browserPreview.verify",
        responses: {
          200: {
            description: "Browser preview verification result",
            content: {
              "application/json": {
                schema: resolver(BrowserPreviewVerification),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          url: z.string().optional(),
          viewportID: BrowserPreviewViewportID.default("desktop"),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const target = await resolveBrowserPreviewTarget({
          projectRoot: Instance.directory,
          explicitUrl: body.url,
        })
        const verification = await verifyBrowserPreview({
          projectRoot: Instance.directory,
          target,
          viewportID: body.viewportID,
        })
        return c.json(verification)
      },
    ),
)
