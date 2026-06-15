import z from "zod"
import { persistBrowserPreviewTarget } from "@/browser-preview/persist"
import { deriveBrowserPreviewUrlsFromDevServerCommand } from "@/browser-preview/dev-server-command"
import { extractBrowserPreviewUrlsFromText } from "@/browser-preview/extract"
import { waitForBrowserPreviewUrlReachable } from "@/browser-preview/liveness"
import { normalizeBrowserPreviewUrl, resolveBrowserPreviewTarget } from "@/browser-preview/target"
import { Instance } from "@/project/instance"
import { BashTool } from "./bash"
import { Tool } from "./tool"

const DEFAULT_PREVIEW_SERVICE_DESCRIPTION = "Start browser preview service"
const DEFAULT_STARTUP_OBSERVER_IDLE_MS = 2_000
const DEFAULT_STARTUP_OBSERVER_MAX_MS = 10_000
const MAX_STARTUP_OBSERVER_MS = 60_000

type BrowserPreviewStartupCandidateSource = "explicit" | "process-output" | "command"
type BrowserPreviewStartupCandidate = {
  source: BrowserPreviewStartupCandidateSource
  url: string
  reachable?: boolean
  persistedTargetID?: string
  skipReason?: string
}
type BrowserPreviewStartupTarget = {
  id: string
  url: string
  source: BrowserPreviewStartupCandidateSource
}

class BrowserPreviewStartupObserver {
  private readonly seen = new Set<string>()
  private readonly startupCandidates: BrowserPreviewStartupCandidate[] = []
  private readonly startupTargets: BrowserPreviewStartupTarget[] = []
  private queue = Promise.resolve()
  private lastActivity = Date.now()
  private closed = false

  constructor(
    private readonly input: {
      taskID: string
      explicitUrl?: string
    },
  ) {}

  observe(text: string) {
    if (this.closed) return
    this.lastActivity = Date.now()
    for (const url of extractBrowserPreviewUrlsFromText(text)) {
      const key = url.toLowerCase()
      if (this.seen.has(key)) continue
      this.seen.add(key)
      if (this.input.explicitUrl) {
        this.startupCandidates.push({
          source: "process-output",
          url,
          skipReason: "explicit preview URL owns target selection",
        })
        continue
      }
      this.queue = this.queue.then(() => this.persistProcessOutputUrl(url))
    }
  }

  close() {
    this.closed = true
  }

  async waitForIdle(input: { idleMs: number; maxMs: number }) {
    const startedAt = Date.now()
    for (;;) {
      await this.queue
      if (this.startupTargets.length > 0) return
      const idleFor = Date.now() - this.lastActivity
      const elapsed = Date.now() - startedAt
      if (idleFor >= input.idleMs || elapsed >= input.maxMs) return
      await Bun.sleep(Math.min(100, input.idleMs - idleFor, input.maxMs - elapsed))
    }
  }

  candidates(): BrowserPreviewStartupCandidate[] {
    return [...this.startupCandidates]
  }

  targets(): BrowserPreviewStartupTarget[] {
    return [...this.startupTargets]
  }

  private async persistProcessOutputUrl(url: string) {
    const reachable = await waitForBrowserPreviewUrlReachable(url)
    if (!reachable) {
      this.startupCandidates.push({
        source: "process-output",
        url,
        reachable,
        skipReason: "process output preview URL was not reachable",
      })
      return
    }
    const persisted = await persistBrowserPreviewTarget({ taskID: this.input.taskID, url })
    this.startupCandidates.push({
      source: "process-output",
      url,
      reachable,
      persistedTargetID: persisted.id,
    })
    this.startupTargets.push({ id: persisted.id, url, source: "process-output" })
  }
}

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
  timeout: z.number().describe("Optional startup readiness wait in milliseconds before this tool returns.").optional(),
  leaseTimeout: z
    .number()
    .describe("Optional background service lease in milliseconds. Defaults to the bash background lease.")
    .optional(),
  description: z.string().describe("Optional concise label for the service startup command.").optional(),
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
        throw new Error(
          "browser_preview requires a task context so the preview target can be saved as a task artifact.",
        )
      }

      const explicitUrl = normalizeBrowserPreviewUrl(params.url)
      if (params.url && !explicitUrl) {
        throw new Error(`Invalid browser preview URL: ${params.url}`)
      }

      const startupObserver = new BrowserPreviewStartupObserver({ taskID, explicitUrl })
      const startup = await bash.execute(
        {
          command: params.command,
          workdir: params.workdir,
          timeout: params.timeout,
          leaseTimeout: params.leaseTimeout,
          description: params.description ?? DEFAULT_PREVIEW_SERVICE_DESCRIPTION,
          background: true,
        },
        {
          ...ctx,
          extra: {
            ...ctx.extra,
            bashOutputObserver: (input: { output: string }) => startupObserver.observe(input.output),
          },
        },
      )

      let explicitUrlPersisted = false
      const startupCandidates: BrowserPreviewStartupCandidate[] = []
      const startupTargets: BrowserPreviewStartupTarget[] = []
      if (explicitUrl) {
        const reachable = await waitForBrowserPreviewUrlReachable(explicitUrl)
        if (reachable) {
          const persisted = await persistBrowserPreviewTarget({ taskID, url: explicitUrl })
          explicitUrlPersisted = true
          startupTargets.push({ id: persisted.id, url: explicitUrl, source: "explicit" })
          startupCandidates.push({
            source: "explicit",
            url: explicitUrl,
            reachable,
            persistedTargetID: persisted.id,
          })
        } else {
          startupCandidates.push({
            source: "explicit",
            url: explicitUrl,
            reachable,
            skipReason: "explicit preview URL was not reachable",
          })
        }
      }
      const observerMaxMs =
        typeof params.timeout === "number"
          ? Math.max(0, Math.min(params.timeout, MAX_STARTUP_OBSERVER_MS))
          : DEFAULT_STARTUP_OBSERVER_MAX_MS
      await startupObserver.waitForIdle({
        idleMs: Math.min(DEFAULT_STARTUP_OBSERVER_IDLE_MS, Math.max(observerMaxMs, 0)),
        maxMs: observerMaxMs,
      })
      startupObserver.close()
      startupCandidates.push(...startupObserver.candidates())
      startupTargets.push(...startupObserver.targets())
      for (const url of deriveBrowserPreviewUrlsFromDevServerCommand(params.command)) {
        const reachable = await waitForBrowserPreviewUrlReachable(url)
        startupCandidates.push({
          source: "command",
          url,
          reachable,
          skipReason: "command-derived URL is diagnostic only; pass url to persist it",
        })
      }

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
        startupCandidates,
        startupTargets,
        diagnostics: [
          ...target.diagnostics,
          ...(startupTargets.length === 0 ? ["No browser_preview_target was persisted for this service startup."] : []),
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
          startupCandidates,
        },
      }
    },
  }
})
