import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { requireTask } from "@/engine/store"
import { findBrowserPreviewTargetByID, persistBrowserPreviewTarget } from "../../browser-preview/persist"
import {
  BrowserPreviewTarget,
  failedBrowserPreviewTarget,
  normalizeBrowserPreviewUrl,
  resolveBrowserPreviewTarget,
  taskBrowserPreviewTarget,
} from "../../browser-preview/target"
import { BrowserPreviewVerification, verifyBrowserPreview } from "../../browser-preview/verification"
import { BrowserPreviewViewportID } from "../../browser-preview/viewport"

export const BrowserPreviewRoutes = lazy(() =>
  new Hono()
    .get(
      "/task/:taskID/browser-preview",
      describeRoute({
        summary: "Resolve task browser preview target",
        description:
          "Return the task-scoped browser preview target. Saved task artifacts are the only preview target source.",
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
          return c.json(
            failedBrowserPreviewTarget({
              projectRoot: Instance.directory,
              taskID,
              diagnostics: [`Invalid preview URL: ${rawUrl}`],
            }),
            400,
          )
        }
        const persisted = await persistBrowserPreviewTarget({ taskID, url })
        return c.json(
          taskBrowserPreviewTarget({
            id: persisted.id,
            taskID,
            projectRoot: Instance.directory,
            url: persisted.url,
            diagnostics: [`Saved task browser preview target ${persisted.id}.`],
          }) satisfies BrowserPreviewTarget,
        )
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
          targetID: z.string().min(1),
          viewportID: BrowserPreviewViewportID.default("desktop"),
        }),
      ),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const body = c.req.valid("json")
        requireTask(taskID)
        const persisted = findBrowserPreviewTargetByID({ taskID, targetID: body.targetID })
        const target = persisted
          ? taskBrowserPreviewTarget({
              id: persisted.id,
              taskID,
              projectRoot: Instance.directory,
              url: persisted.url,
              diagnostics: [`Using task browser preview target ${persisted.id}.`],
            })
          : failedBrowserPreviewTarget({
              projectRoot: Instance.directory,
              taskID,
              diagnostics: [`Browser preview target not found: ${body.targetID}`],
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
