import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import fs from "node:fs/promises"
import z from "zod"
import { requireTask } from "@/engine/store"
import {
  findReadableBrowserPreviewEvidenceByID,
  findReadableBrowserPreviewEvidenceCapturePath,
  findBrowserPreviewTargetByID,
  promoteBrowserPreviewTarget,
  PersistedBrowserPreviewEvidence,
} from "../../browser-preview/persist"
import {
  BrowserPreviewTarget,
  failedBrowserPreviewTarget,
  resolveBrowserPreviewTarget,
  taskBrowserPreviewTarget,
} from "../../browser-preview/target"
import { BrowserPreviewVerification, verifyBrowserPreview } from "../../browser-preview/verification"
import { BrowserPreviewViewportID } from "../../browser-preview/viewport"
import { captureBrowserPreviewLiveSnapshot, interactBrowserPreviewLive } from "../../browser-preview/live"

const BrowserPreviewLiveRequest = z.object({
  targetID: z.string().min(1),
  viewportID: BrowserPreviewViewportID,
})

const BrowserPreviewLiveInputRequest = BrowserPreviewLiveRequest.extend({
  input: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("click"),
      x: z.number().finite().nonnegative(),
      y: z.number().finite().nonnegative(),
      button: z.enum(["left", "middle", "right"]).optional(),
    }),
    z.object({
      kind: z.literal("wheel"),
      x: z.number().finite().nonnegative(),
      y: z.number().finite().nonnegative(),
      deltaX: z.number().finite(),
      deltaY: z.number().finite(),
    }),
    z.object({
      kind: z.literal("key"),
      key: z.string().min(1).max(80),
    }),
  ]),
})

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
    .get(
      "/task/:taskID/browser-preview/evidence/:evidenceID",
      describeRoute({
        summary: "Read browser preview verification evidence",
        description: "Return the persisted Playwright evidence artifact for a task-scoped browser preview target.",
        operationId: "browserPreview.readTaskEvidence",
        responses: {
          200: {
            description: "Persisted browser preview evidence",
            content: {
              "application/json": {
                schema: resolver(PersistedBrowserPreviewEvidence),
              },
            },
          },
        },
      }),
      validator("param", z.object({ taskID: z.string().min(1), evidenceID: z.string().min(1) })),
      async (c) => {
        const { taskID, evidenceID } = c.req.valid("param")
        requireTask(taskID)
        const evidence = await findReadableBrowserPreviewEvidenceByID({ taskID, evidenceID })
        if (!evidence) return c.json({ message: `Browser preview evidence not found: ${evidenceID}` }, 404)
        return c.json(evidence)
      },
    )
    .get(
      "/task/:taskID/browser-preview/evidence/:evidenceID/capture.png",
      describeRoute({
        summary: "Read browser preview evidence screenshot",
        description: "Return the persisted Playwright PNG screenshot for task-scoped browser preview evidence.",
        operationId: "browserPreview.readTaskEvidenceCapture",
        responses: {
          200: {
            description: "Persisted browser preview PNG screenshot",
            content: {
              "image/png": {
                schema: resolver(z.string().meta({ format: "binary" })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ taskID: z.string().min(1), evidenceID: z.string().min(1) })),
      async (c) => {
        const { taskID, evidenceID } = c.req.valid("param")
        requireTask(taskID)
        const capturePath = await findReadableBrowserPreviewEvidenceCapturePath({ taskID, evidenceID })
        if (!capturePath) return c.json({ message: `Browser preview evidence capture not found: ${evidenceID}` }, 404)
        const bytes = await fs.readFile(capturePath)
        return new Response(bytes, {
          headers: {
            "content-type": "image/png",
            "cache-control": "no-store",
          },
        })
      },
    )
    .put(
      "/task/:taskID/browser-preview/target",
      describeRoute({
        summary: "Select task browser preview target",
        description:
          "Promote an existing task browser preview target artifact. Arbitrary operator URLs are not accepted as preview targets.",
        operationId: "browserPreview.selectTaskTarget",
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
      validator("json", z.object({ targetID: z.string().min(1) })),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const { targetID } = c.req.valid("json")
        requireTask(taskID)
        const persisted = await promoteBrowserPreviewTarget({ taskID, targetID })
        if (!persisted)
          return c.json(
            failedBrowserPreviewTarget({
              projectRoot: Instance.directory,
              taskID,
              diagnostics: [`Browser preview target not found: ${targetID}`],
            }),
            404,
          )
        return c.json(
          taskBrowserPreviewTarget({
            id: persisted.id,
            taskID,
            projectRoot: Instance.directory,
            url: persisted.url,
            diagnostics: [`Selected task browser preview target ${persisted.id}.`],
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
          viewportIDs: BrowserPreviewViewportID.array().min(1),
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
          viewportIDs: body.viewportIDs,
          signal: c.req.raw.signal,
        })
        return c.json(verification)
      },
    )
    .post(
      "/task/:taskID/browser-preview/live/snapshot",
      describeRoute({
        summary: "Capture interactive browser preview snapshot",
        description:
          "Return a PNG frame from the task-scoped Playwright live preview session for a persisted browser preview target.",
        operationId: "browserPreview.liveSnapshot",
        responses: {
          200: {
            description: "Interactive browser preview PNG frame",
            content: {
              "image/png": {
                schema: resolver(z.string().meta({ format: "binary" })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ taskID: z.string().min(1) })),
      validator("json", BrowserPreviewLiveRequest),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const body = c.req.valid("json")
        requireTask(taskID)
        const target = findBrowserPreviewTargetByID({ taskID, targetID: body.targetID })
        if (!target) return c.json({ message: `Browser preview target not found: ${body.targetID}` }, 404)
        const bytes = await captureBrowserPreviewLiveSnapshot({
          taskID,
          targetID: body.targetID,
          url: target.url,
          viewportID: body.viewportID,
          signal: c.req.raw.signal,
        })
        return new Response(bytes, {
          headers: {
            "content-type": "image/png",
            "cache-control": "no-store",
          },
        })
      },
    )
    .post(
      "/task/:taskID/browser-preview/live/input",
      describeRoute({
        summary: "Send input to interactive browser preview",
        description:
          "Apply pointer, wheel, or keyboard input to the task-scoped Playwright live preview session and return the next PNG frame.",
        operationId: "browserPreview.liveInput",
        responses: {
          200: {
            description: "Interactive browser preview PNG frame after input",
            content: {
              "image/png": {
                schema: resolver(z.string().meta({ format: "binary" })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ taskID: z.string().min(1) })),
      validator("json", BrowserPreviewLiveInputRequest),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const body = c.req.valid("json")
        requireTask(taskID)
        const target = findBrowserPreviewTargetByID({ taskID, targetID: body.targetID })
        if (!target) return c.json({ message: `Browser preview target not found: ${body.targetID}` }, 404)
        const bytes = await interactBrowserPreviewLive({
          taskID,
          targetID: body.targetID,
          url: target.url,
          viewportID: body.viewportID,
          input: body.input,
          signal: c.req.raw.signal,
        })
        return new Response(bytes, {
          headers: {
            "content-type": "image/png",
            "cache-control": "no-store",
          },
        })
      },
    ),
)
