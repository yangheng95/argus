import path from "path"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Vcs } from "@/project/vcs"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { collectMainWorktreeDiff, readBaselineCommitFromMetadata } from "./workspace-export"
import type { TaskRow, RunRow, AcceptanceRow } from "./store"

const log = Log.create({ service: "engine-acceptance" })

// ---------------------------------------------------------------------------
// Acceptance Adapter 接口 — 可插拔的交付步骤
// ---------------------------------------------------------------------------

type AcceptanceArtifact = {
  kind: "patch" | "report" | "link" | "git_ref" | "pr"
  label: string
  payload: Record<string, unknown>
}

type AcceptanceAdapterResult = {
  id: string
  status: "delivered" | "skipped"
  summary: string
  detail?: string
  artifacts: AcceptanceArtifact[]
}

type AcceptanceContext = {
  task: TaskRow
  run: RunRow
  acceptance: AcceptanceRow
}

type AcceptanceAdapter = {
  id: string
  /** 执行交付步骤，返回产出的 artifacts 和状态 */
  execute(ctx: AcceptanceContext): Promise<AcceptanceAdapterResult>
}

type AcceptancePublish = {
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

const registry: AcceptanceAdapter[] = []

namespace AcceptancePipeline {
  export function register(adapter: AcceptanceAdapter) {
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
// read `ctx.acceptance.result.{changed_files,diffs}`, a snapshot captured at
// goal-merge time. The aborted-recovery path never populated it (resulting in
// `changed_files: []` published over real work) and even on the happy path it
// missed every edit the acceptance picky loop committed per round (P0-C.1).
const workspaceExportAdapter: AcceptanceAdapter = {
  id: "workspace_export",
  async execute(ctx) {
    const baseRef = readBaselineCommit(ctx.task)
    const cwd = Instance.directory
    const { changedFiles, patch } = await collectMainWorktreeDiff(cwd, baseRef)
    const out = path.join(
      ProjectRuntimePaths.acceptancePaths(Instance.directory, ctx.task.id).root,
      `${Identifier.shortPath(ctx.acceptance.id)}.patch`,
    )
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
          label: "acceptance.patch",
          payload: { file: out, changed_files: changedFiles, patch, base_ref: baseRef },
        },
        {
          kind: "report" as const,
          label: "acceptance.export",
          payload: { changed_files: changedFiles, summary: ctx.acceptance.summary, base_ref: baseRef },
        },
      ],
    }
  },
}

function readBaselineCommit(task: TaskRow): string | undefined {
  return readBaselineCommitFromMetadata(task.metadata)
}

const gitPreviewAdapter: AcceptanceAdapter = {
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
  AcceptancePipeline.register(workspaceExportAdapter)
  AcceptancePipeline.register(gitPreviewAdapter)
}

// 启动时注册内置适配器
registerDefaults()

// ---------------------------------------------------------------------------
// Publisher — 遍历 pipeline 执行所有适配器
// ---------------------------------------------------------------------------

const ADAPTER_TIMEOUT_MS = 30_000 // 30 seconds per adapter

export namespace Publisher {
  export async function deliver(input: AcceptanceContext) {
    const artifacts: AcceptanceArtifact[] = []
    const publish: AcceptancePublish = { mode: "manual", adapters: [] }

    for (const adapter of registry) {
      try {
        const result = await Promise.race([
          adapter.execute(input),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`adapter ${adapter.id} timeout (${ADAPTER_TIMEOUT_MS}ms)`)),
              ADAPTER_TIMEOUT_MS,
            ),
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
        log.warn("acceptance adapter failed or timed out", { adapter: adapter.id, error: String(error) })
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
          ? `Acceptance finalized with ${artifacts.length} exported artifact${artifacts.length > 1 ? "s" : ""}.`
          : "Acceptance finalized.",
      artifacts,
      publish,
    }
  }
}
