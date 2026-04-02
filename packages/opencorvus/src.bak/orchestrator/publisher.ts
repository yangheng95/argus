import path from "path"
import { createTwoFilesPatch } from "diff"
import { buildSessionTraceHtml } from "@/cli/cmd/export-html"
import { Global } from "@/global"
import { LLMTrace } from "@/session/llm-trace"
import { Session } from "@/session"
import { Vcs } from "@/project/vcs"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import type { TaskRow, RunRow, DeliveryRow } from "./store"

const log = Log.create({ service: "orchestrator-delivery" })

// ---------------------------------------------------------------------------
// Delivery Adapter 接口 — 可插拔的交付步骤
// ---------------------------------------------------------------------------

export type DeliveryArtifact = {
  kind: "patch" | "report" | "html_trace" | "link" | "git_ref" | "pr"
  label: string
  payload: Record<string, unknown>
}

export type DeliveryAdapterResult = {
  id: string
  status: "delivered" | "skipped"
  summary: string
  detail?: string
  artifacts: DeliveryArtifact[]
}

export type DeliveryContext = {
  task: TaskRow
  run: RunRow
  delivery: DeliveryRow
}

export type DeliveryAdapter = {
  id: string
  /** 执行交付步骤，返回产出的 artifacts 和状态 */
  execute(ctx: DeliveryContext): Promise<DeliveryAdapterResult>
}

type DeliveryPublish = {
  mode: "manual"
  adapters: Array<{
    id: string
    status: "delivered" | "skipped"
    summary: string
    detail?: string
  }>
}

// ---------------------------------------------------------------------------
// Adapter Registry — 注册/注销交付适配器
// ---------------------------------------------------------------------------

const registry: DeliveryAdapter[] = []

export namespace DeliveryPipeline {
  export function register(adapter: DeliveryAdapter) {
    const idx = registry.findIndex((a) => a.id === adapter.id)
    if (idx >= 0) {
      registry.splice(idx, 1, adapter)
    } else {
      registry.push(adapter)
    }
  }

  export function unregister(id: string) {
    const idx = registry.findIndex((a) => a.id === id)
    if (idx >= 0) registry.splice(idx, 1)
  }

  export function list() {
    return [...registry]
  }

  export function reset() {
    registry.length = 0
    registerDefaults()
  }
}

// ---------------------------------------------------------------------------
// 内置适配器
// ---------------------------------------------------------------------------

const workspaceExportAdapter: DeliveryAdapter = {
  id: "workspace_export",
  async execute(ctx) {
    const result = ctx.delivery.result ?? {}
    const diffs = Array.isArray(result.diffs) ? result.diffs : []
    const changedFiles = Array.isArray(result.changed_files)
      ? result.changed_files.filter((item): item is string => typeof item === "string")
      : []
    const patch = diffs
      .map((item) =>
        createTwoFilesPatch(item.file, item.file, item.before ?? "", item.after ?? "", "before", "after"),
      )
      .join("\n")
    const out = path.join(Global.Path.data, "delivery", `${ctx.delivery.id}.patch`)
    await Filesystem.write(out, patch || "")
    return {
      id: "workspace_export",
      status: "delivered",
      summary: "Workspace patch and changed-file summary exported.",
      artifacts: [
        {
          kind: "patch" as const,
          label: "delivery.patch",
          payload: { file: out, changed_files: changedFiles, patch },
        },
        {
          kind: "report" as const,
          label: "delivery.export",
          payload: { changed_files: changedFiles, summary: ctx.delivery.summary },
        },
      ],
    }
  },
}

const artifactExportAdapter: DeliveryAdapter = {
  id: "artifact_export",
  async execute(ctx) {
    if (!ctx.run.session_id) {
      return { id: "artifact_export", status: "skipped", summary: "No session for HTML trace.", artifacts: [] }
    }
    const session = await Session.get(ctx.run.session_id)
    const messages = await Session.messages({ sessionID: ctx.run.session_id })
    const calls = await LLMTrace.read(ctx.run.session_id)
    const report = await buildSessionTraceHtml({
      session: { id: session.id, title: session.title, time: session.time },
      messages,
      calls,
    })
    const out = path.join(Global.Path.data, "delivery", `${ctx.delivery.id}.html`)
    await Filesystem.write(out, report)
    return {
      id: "artifact_export",
      status: "delivered",
      summary: "HTML trace report exported.",
      artifacts: [{ kind: "html_trace" as const, label: "delivery.trace", payload: { file: out } }],
    }
  },
}

const gitPreviewAdapter: DeliveryAdapter = {
  id: "git_publish",
  async execute() {
    const vcs = await Vcs.info()
    if (!vcs.branch) {
      return { id: "git_publish", status: "skipped", summary: "No git branch available.", artifacts: [] }
    }
    return {
      id: "git_publish",
      status: "delivered",
      summary: "Git branch and working tree preview recorded.",
      artifacts: [
        {
          kind: "git_ref" as const,
          label: "git.preview",
          payload: {
            branch: vcs.branch,
            clean: vcs.clean,
            dirty: vcs.dirty,
            ahead: vcs.ahead,
            behind: vcs.behind,
            staged: vcs.staged,
            modified: vcs.modified,
            untracked: vcs.untracked,
            conflicts: vcs.conflicts,
          },
        },
      ],
    }
  },
}

function registerDefaults() {
  DeliveryPipeline.register(workspaceExportAdapter)
  DeliveryPipeline.register(artifactExportAdapter)
  DeliveryPipeline.register(gitPreviewAdapter)
}

// 启动时注册内置适配器
registerDefaults()

// ---------------------------------------------------------------------------
// Publisher — 遍历 pipeline 执行所有适配器
// ---------------------------------------------------------------------------

const ADAPTER_TIMEOUT_MS = 30_000 // 30 seconds per adapter

export namespace Publisher {
  export async function deliver(input: DeliveryContext) {
    const artifacts: DeliveryArtifact[] = []
    const publish: DeliveryPublish = { mode: "manual", adapters: [] }

    for (const adapter of registry) {
      try {
        const result = await Promise.race([
          adapter.execute(input),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`adapter ${adapter.id} timeout (${ADAPTER_TIMEOUT_MS}ms)`)), ADAPTER_TIMEOUT_MS),
          ),
        ])
        artifacts.push(...result.artifacts)
        publish.adapters.push({
          id: result.id,
          status: result.status,
          summary: result.summary,
          detail: result.detail,
        })
      } catch (error) {
        log.warn("delivery adapter failed or timed out", { adapter: adapter.id, error: String(error) })
        publish.adapters.push({
          id: adapter.id,
          status: "skipped",
          summary: `${adapter.id} failed.`,
          detail: String(error),
        })
      }
    }

    return {
      status: "delivered" as const,
      summary:
        artifacts.length > 0
          ? `Delivery finalized with ${artifacts.length} exported artifact${artifacts.length > 1 ? "s" : ""}.`
          : "Delivery finalized.",
      artifacts,
      publish,
    }
  }
}
