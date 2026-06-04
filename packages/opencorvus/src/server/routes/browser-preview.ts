import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { requireTask } from "@/engine/store"
import { findBrowserPreviewTargetByID, persistBrowserPreviewTarget } from "../../browser-preview/persist"
import { BrowserPreviewTarget, normalizeBrowserPreviewUrl, resolveBrowserPreviewTarget } from "../../browser-preview/target"
import { BrowserPreviewVerification, verifyBrowserPreview } from "../../browser-preview/verification"
import { BrowserPreviewViewportID } from "../../browser-preview/viewport"

export const BrowserPreviewRoutes = lazy(() =>
  new Hono()
    .get(
      "/task/:taskID/browser-preview",
      describeRoute({
        summary: "Resolve task browser preview target",
        description:
          "Return the task-scoped browser preview target. Saved task artifacts are authoritative; package.json metadata is only used when the task has no saved target.",
        operationId: "browserPreview.taskTarget",
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
        "param",
        z.object({
          taskID: z.string().min(1),
        }),
      ),
      async (c) => {
        const { taskID } = c.req.valid("param")
        requireTask(taskID)
        const target = await resolveBrowserPreviewTarget({
          projectRoot: Instance.directory,
          taskID,
        })
        return c.json(target)
      },
    )
    .put(
      "/task/:taskID/browser-preview/target",
      describeRoute({
        summary: "Save task browser preview target",
        description:
          "Persist the explicit browser preview URL as the task's preview target artifact. The overlay must use this route instead of local storage or query overrides.",
        operationId: "browserPreview.saveTaskTarget",
        responses: {
          200: {
            description: "Persisted browser preview target",
            content: {
              "application/json": {
                schema: resolver(BrowserPreviewTarget),
              },
            },
          },
        },
      }),
      validator("param", z.object({ taskID: z.string().min(1) })),
      validator("json", z.object({ url: z.string().min(1) })),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const { url: rawUrl } = c.req.valid("json")
        requireTask(taskID)
        const url = normalizeBrowserPreviewUrl(rawUrl)
        if (!url) {
          return c.json(await resolveBrowserPreviewTarget({ projectRoot: Instance.directory, explicitUrl: rawUrl }), 400)
        }
        const persisted = persistBrowserPreviewTarget({ taskID, url })
        return c.json({
          id: persisted.id,
          taskID,
          kind: "task-url",
          status: "ready",
          projectRoot: Instance.directory,
          url: persisted.url,
          viewports: (await resolveBrowserPreviewTarget({ projectRoot: Instance.directory, explicitUrl: url })).viewports,
          diagnostics: [`Saved task browser preview target ${persisted.id}.`],
          source: "task-artifact",
        } satisfies BrowserPreviewTarget)
      },
    )
    .post(
      "/task/:taskID/browser-preview/capture",
      describeRoute({
        summary: "Capture browser preview verification evidence",
        description:
          "Capture Playwright-backed screenshot evidence for the task-scoped browser preview target and persist the evidence artifact.",
        operationId: "browserPreview.captureTaskTarget",
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
      validator("param", z.object({ taskID: z.string().min(1) })),
      validator(
        "json",
        z.object({
          targetID: z.string().optional(),
          viewportID: BrowserPreviewViewportID.default("desktop"),
        }),
      ),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const body = c.req.valid("json")
        requireTask(taskID)
        const persisted = body.targetID ? findBrowserPreviewTargetByID({ taskID, targetID: body.targetID }) : undefined
        const target = persisted
          ? {
              id: persisted.id,
              taskID,
              kind: "task-url" as const,
              status: "ready" as const,
              projectRoot: Instance.directory,
              url: persisted.url,
              viewports: (await resolveBrowserPreviewTarget({ projectRoot: Instance.directory, explicitUrl: persisted.url })).viewports,
              diagnostics: [`Using task browser preview target ${persisted.id}.`],
              source: "task-artifact" as const,
            }
          : await resolveBrowserPreviewTarget({
              projectRoot: Instance.directory,
              taskID,
            })
        const verification = await verifyBrowserPreview({
          projectRoot: Instance.directory,
          target,
          taskID,
          targetID: body.targetID,
          viewportID: body.viewportID,
          signal: c.req.raw.signal,
        })
        return c.json(verification)
      },
    ),
)
