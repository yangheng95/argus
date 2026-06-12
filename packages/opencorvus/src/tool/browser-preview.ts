import z from "zod"
import { persistBrowserPreviewTarget } from "@/browser-preview/persist"
import { deriveBrowserPreviewUrlsFromDevServerCommand } from "@/browser-preview/dev-server-command"
import { extractBrowserPreviewUrlsFromText, persistBrowserPreviewUrls } from "@/browser-preview/extract"
import { waitForBrowserPreviewUrlReachable } from "@/browser-preview/liveness"
import { normalizeBrowserPreviewUrl, resolveBrowserPreviewTarget } from "@/browser-preview/target"
import { Instance } from "@/project/instance"
import { BashTool } from "./bash"
import { Tool } from "./tool"

const DEFAULT_PREVIEW_SERVICE_DESCRIPTION = "Start browser preview service"

export const BrowserPreviewToolParameters = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      "Frontend dev/preview/serve command to keep running in the background, for example `npm run dev -- --host 127.0.0.1 --port 5173`.",
    ),
  workdir: z
    .string()
    .describe("Working directory for the service command. Defaults to the current project directory.")
    .optional(),
  url: z
    .string()
    .min(1)
    .describe(
      "Optional explicit preview URL (Uniform Resource Locator) to save after the service starts, for commands that do not print a local URL.",
    )
    .optional(),
  timeout: z
    .number()
    .describe("Optional startup readiness wait in milliseconds before this tool returns.")
    .optional(),
  leaseTimeout: z
    .number()
    .describe("Optional background service lease in milliseconds. Defaults to the bash background lease.")
    .optional(),
  description: z
    .string()
    .describe("Optional concise label for the service startup command.")
    .optional(),
})
export type BrowserPreviewToolParameters = z.infer<typeof BrowserPreviewToolParameters>

export const BrowserPreviewTool = Tool.define("browser_preview", async (initCtx) => {
  const bash = await BashTool.init(initCtx)

  return {
    description:
      "Start a long-lived frontend preview service for the current task and open the overlay Preview panel by saving a task-scoped browser preview target. Reuses the bash process supervisor and browser_preview_target artifacts; do not use this for one-shot commands or tests.",
    parameters: BrowserPreviewToolParameters,
    async execute(params: BrowserPreviewToolParameters, ctx: Tool.Context) {
      const taskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID.trim() : ""
      if (!taskID) {
        throw new Error("browser_preview requires a task context so the preview target can be saved as a task artifact.")
      }

      const startup = await bash.execute(
        {
          command: params.command,
          workdir: params.workdir,
          timeout: params.timeout,
          leaseTimeout: params.leaseTimeout,
          description: params.description ?? DEFAULT_PREVIEW_SERVICE_DESCRIPTION,
          background: true,
        },
        ctx,
      )

      let explicitUrlPersisted = false
      let explicitUrlDiagnostic: string | undefined
      const explicitUrl = normalizeBrowserPreviewUrl(params.url)
      if (params.url && !explicitUrl) {
        throw new Error(`Invalid browser preview URL: ${params.url}`)
      }
      if (explicitUrl) {
        if (await waitForBrowserPreviewUrlReachable(explicitUrl)) {
          await persistBrowserPreviewTarget({ taskID, url: explicitUrl })
          explicitUrlPersisted = true
        } else {
          explicitUrlDiagnostic = `Explicit preview URL was not reachable: ${explicitUrl}`
        }
      }
      const startupOutput = typeof startup.metadata.output === "string" ? startup.metadata.output : ""
      const startupTargets = await persistBrowserPreviewUrls({
        taskID,
        urls: [
          ...extractBrowserPreviewUrlsFromText(startupOutput),
          ...deriveBrowserPreviewUrlsFromDevServerCommand(params.command),
        ],
      })

      const target = await resolveBrowserPreviewTarget({
        projectRoot: Instance.directory,
        taskID,
      })
      const payload = {
        kind: "browser_preview_service",
        taskID,
        command: params.command,
        pid: typeof startup.metadata.pid === "number" ? startup.metadata.pid : null,
        background: startup.metadata.background === true,
        target: {
          id: target.id,
          status: target.status,
          url: target.url,
          source: target.source,
        },
        explicitUrlPersisted,
        startupTargets: startupTargets.map((item) => ({ id: item.id, url: item.url })),
        diagnostics: [
          ...target.diagnostics,
          ...(explicitUrlDiagnostic ? [explicitUrlDiagnostic] : []),
          "Overlay Preview opens from the task-scoped browser_preview_target artifact.",
        ],
      }

      return {
        title: target.status === "ready" ? "Preview service started" : "Preview service starting",
        output: JSON.stringify(payload, null, 2),
        metadata: {
          command: params.command,
          output: startup.metadata.output,
          pid: payload.pid,
          background: true as const,
          targetID: target.id,
          targetUrl: target.url,
          targetStatus: target.status,
          explicitUrlPersisted,
          startupTargets: startupTargets.map((item) => item.id),
        },
      }
    },
  }
})
