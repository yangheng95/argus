import path from "path"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Vcs } from "@/project/vcs"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { collectMainWorktreeDiff, readBaselineCommitFromMetadata } from "./workspace-export"
import type { TaskRow, RunRow, DeliveryRow } from "./store"

const log = Log.create({ service: "engine-delivery" })

// ---------------------------------------------------------------------------
// Delivery Adapter 接口 — 可插拔的交付步骤
// ---------------------------------------------------------------------------

type DeliveryArtifact = {
  kind: "patch" | "report" | "link" | "git_ref" | "pr"
  label: string
  payload: Record<string, unknown>
}

type DeliveryAdapterResult = {
  id: string
  status: "delivered" | "skipped"
  summary: string
  detail?: string
  artifacts: DeliveryArtifact[]
}

type DeliveryContext = {
  task: TaskRow
  run: RunRow
  delivery: DeliveryRow
}

type DeliveryAdapter = {
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

namespace DeliveryPipeline {
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

// P0-C.3 — single source of truth for the patch + changed-file list is
// `git diff <baseRef>..HEAD` against the main worktree. The previous version
// read `ctx.delivery.result.{changed_files,diffs}`, a snapshot captured at
// goal-merge time. The aborted-recovery path never populated it (resulting in
// `changed_files: []` published over real work) and even on the happy path it
// missed every edit the delivery picky loop committed per round (P0-C.1).
const workspaceExportAdapter: DeliveryAdapter = {
  id: "workspace_export",
  async execute(ctx) {
    const baseRef = readBaselineCommit(ctx.task)
    const cwd = Instance.directory
    const { changedFiles, patch } = await collectMainWorktreeDiff(cwd, baseRef)
    const out = path.join(ProjectRuntimePaths.deliveryPaths(Instance.directory, ctx.task.id).root, `${Identifier.shortPath(ctx.delivery.id)}.patch`)
    await Filesystem.write(out, patch || "")
    const summary =
      changedFiles.length > 0
        ? `Exported workspace patch (${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} since baseline ${baseRef ?? "n/a"}).`
        : "Workspace clean since baseline; empty patch exported."
    return {
      id: "workspace_export",
      status: "delivered",
      summary,
      artifacts: [
        {
          kind: "patch" as const,
          label: "delivery.patch",
          payload: { file: out, changed_files: changedFiles, patch, base_ref: baseRef },
        },
        {
          kind: "report" as const,
          label: "delivery.export",
          payload: { changed_files: changedFiles, summary: ctx.delivery.summary, base_ref: baseRef },
        },
      ],
    }
  },
}

function readBaselineCommit(task: TaskRow): string | undefined {
  return readBaselineCommitFromMetadata(task.metadata)
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
        return {
          status: "failed" as const,
          summary: `${adapter.id} failed: ${String(error)}`,
          artifacts,
          publish,
        }
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
