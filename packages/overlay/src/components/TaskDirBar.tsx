// ── TaskDirBar ──
// Solid components for project runtime controls hosted by the right activity
// toolbar.

import * as DropdownMenu from "@kobalte/core/dropdown-menu"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { boardStore, loadBoard } from "../store/board"
import { activeDirectory, openDirectory } from "../services/workspace"
import { t } from "../utils/i18n"
import { AppLog } from "../utils/log"
import { canInitGit, initGitCurrent } from "../utils/git"
import {
  deleteProjectWorktree,
  deleteProjectWorktrees,
  loadProjectWorktrees,
  type ProjectWorktreeInfo,
} from "../services/worktree"
import { showAppDialog } from "../services/app-dialog"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

const directoryMemo = () => activeDirectory()

function worktreeStateLabel(item: ProjectWorktreeInfo): string {
  if (item.status === "primary") return t("worktree.primary")
  if (item.status === "active" && item.goalID) return item.goalID
  return t("worktree.expired")
}

function compactPath(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length <= 2) return value
  return `.../${parts.slice(-2).join("/")}`
}

function compactBranch(value: string): string {
  if (value.length <= 26) return value
  const parts = value.split("/").filter(Boolean)
  if (parts.length >= 2) return `.../${parts.slice(-2).join("/")}`
  return `${value.slice(0, 23)}...`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// VCS (Version Control System) metadata projected by GET /vcs into boardStore.
interface ProjectVcsInfo {
  initialized?: boolean
  branch?: string
  commit?: string
  clean?: boolean
  dirty?: boolean
  staged?: number
  modified?: number
  untracked?: number
  conflicts?: number
  ahead?: number
  behind?: number
}

type ProjectVcsTone = "neutral" | "good" | "warn" | "bad"

function projectVcsInfo(): ProjectVcsInfo | null {
  return boardStore.vcs as ProjectVcsInfo | null
}

function vcsToneFor(value: ProjectVcsInfo | null): ProjectVcsTone {
  if (!value) return "neutral"
  if (!value.initialized) return "neutral"
  if ((value.conflicts ?? 0) > 0) return "bad"
  if (value.dirty) return "warn"
  return "good"
}

function vcsCountsFor(value: ProjectVcsInfo | null): string {
  if (!value?.initialized) return ""
  const parts: string[] = []
  if ((value.staged ?? 0) > 0) parts.push(`+${value.staged}`)
  if ((value.modified ?? 0) > 0) parts.push(`~${value.modified}`)
  if ((value.untracked ?? 0) > 0) parts.push(`?${value.untracked}`)
  if ((value.conflicts ?? 0) > 0) parts.push(`!${value.conflicts}`)
  return parts.join(" ")
}

function vcsArrowsFor(value: ProjectVcsInfo | null): string {
  if (!value?.initialized) return ""
  const ahead = value.ahead ?? 0
  const behind = value.behind ?? 0
  if (ahead === 0 && behind === 0) return ""
  return `${ahead > 0 ? `↑${ahead}` : ""}${behind > 0 ? `↓${behind}` : ""}`
}

function compactCommit(value: string): string {
  return value.length <= 10 ? value : value.slice(0, 10)
}

export function ProjectRuntimeStatusDropdown() {
  const dir = createMemo(directoryMemo)
  const [open, setOpen] = createSignal(false)
  const [gitBusy, setGitBusy] = createSignal(false)
  const [worktrees, setWorktrees] = createSignal<ProjectWorktreeInfo[]>([])
  const [worktreeDirectory, setWorktreeDirectory] = createSignal("")
  const [error, setError] = createSignal("")
  const [operationError, setOperationError] = createSignal("")
  const [deletingWorktrees, setDeletingWorktrees] = createSignal(new Set<string>())
  const [cleanupExpiredOperationDirectory, setCleanupExpiredOperationDirectory] = createSignal("")
  const visibleWorktrees = createMemo(() => worktrees().filter((item) => item.status !== "primary"))
  const activeWorktrees = createMemo(() => worktrees().filter((item) => item.status === "active"))
  const expiredWorktrees = createMemo(() => worktrees().filter((item) => item.status === "expired"))
  const removableExpiredWorktrees = createMemo(() => expiredWorktrees().filter((item) => item.removable))
  const cleanupExpiredBusy = createMemo(() => cleanupExpiredBusyFor(worktreeDirectory()))
  const canCleanupExpired = createMemo(() => removableExpiredWorktrees().length > 0 && !cleanupExpiredBusy())
  const vcs = createMemo(projectVcsInfo)
  const gitTone = createMemo(() => vcsToneFor(vcs()))
  const gitCounts = createMemo(() => vcsCountsFor(vcs()))
  const gitArrows = createMemo(() => vcsArrowsFor(vcs()))
  const gitStatusLabel = createMemo(() => {
    const value = vcs()
    if (!value) return t("project_runtime.git_unavailable")
    if (!value.initialized) return t("project_runtime.git_uninitialized")
    return value.dirty ? t("vcs.dirty") : t("vcs.clean")
  })
  const triggerBadge = createMemo(() => {
    const total = activeWorktrees().length + expiredWorktrees().length
    return total > 0 ? String(total) : ""
  })
  const triggerBadgeKind = createMemo(() => (expiredWorktrees().length > 0 ? "expired" : "active"))
  const triggerTitle = createMemo(() =>
    t("project_runtime.summary", {
      active: activeWorktrees().length,
      expired: expiredWorktrees().length,
      git: gitStatusLabel(),
    }),
  )

  function setDeleting(directories: string[], deleting: boolean): void {
    setDeletingWorktrees((current) => {
      const next = new Set(current)
      for (const directory of directories) {
        if (deleting) next.add(directory)
        else next.delete(directory)
      }
      return next
    })
  }

  async function syncWorktrees(options: { requireFresh?: boolean } = {}): Promise<void> {
    const projectDirectory = dir().trim()
    if (!projectDirectory) {
      setWorktrees([])
      setWorktreeDirectory("")
      setError("")
      return
    }
    try {
      const items = await loadProjectWorktrees(projectDirectory)
      if (dir().trim() !== projectDirectory) return
      setWorktrees(items)
      setWorktreeDirectory(projectDirectory)
      setError("")
    } catch (err) {
      if (dir().trim() !== projectDirectory) return
      const message = err instanceof Error ? err.message : String(err)
      if (worktreeDirectory() !== projectDirectory) {
        setWorktrees([])
        setWorktreeDirectory("")
      }
      setError(message)
      AppLog.warn("ui", "Failed to load project worktrees", { error: message })
      if (options.requireFresh) throw err
    }
  }

  function ownsWorktreeOperation(projectDirectory: string): boolean {
    return dir().trim() === projectDirectory && worktreeDirectory() === projectDirectory
  }

  function cleanupExpiredBusyFor(projectDirectory: string): boolean {
    const directory = projectDirectory.trim()
    return directory.length > 0 && cleanupExpiredOperationDirectory() === directory
  }

  function setRuntimePanelOpen(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) void syncWorktrees()
  }

  async function handleInitGit(event: MouseEvent): Promise<void> {
    event.stopPropagation()
    if (!canInitGit() || gitBusy()) return
    setGitBusy(true)
    try {
      await initGitCurrent()
    } catch (err) {
      AppLog.error("ui", "Failed to initialize git repository", { error: errorMessage(err) })
    } finally {
      setGitBusy(false)
    }
  }

  async function removeWorktree(item: ProjectWorktreeInfo, event: MouseEvent): Promise<void> {
    event.stopPropagation()
    const projectDirectory = worktreeDirectory() || dir().trim()
    if (!item.removable || deletingWorktrees().has(item.directory) || cleanupExpiredBusyFor(projectDirectory)) return
    if (!projectDirectory) return
    const confirmed = await showAppDialog({
      title: t("worktree.delete"),
      message: t("worktree.delete_confirm", { path: item.directory }),
      cancel: true,
      okLabel: t("common.delete"),
    })
    if (!confirmed.confirmed) return
    if (dir().trim() !== projectDirectory || worktreeDirectory() !== projectDirectory) return
    setDeleting([item.directory], true)
    setOperationError("")
    try {
      try {
        await deleteProjectWorktree(projectDirectory, item.directory)
        if (!ownsWorktreeOperation(projectDirectory)) return
        setWorktrees((current) => current.filter((candidate) => candidate.directory !== item.directory))
      } catch (err) {
        if (!ownsWorktreeOperation(projectDirectory)) return
        const message = errorMessage(err)
        setOperationError(t("worktree.delete_failed", { error: message }))
        setOpen(true)
        AppLog.error("ui", "Failed to delete project worktree", { directory: item.directory, error: message })
        return
      }
      try {
        await syncWorktrees({ requireFresh: true })
        if (!ownsWorktreeOperation(projectDirectory)) return
        await loadBoard({ sync: true, requireFresh: true })
        if (!ownsWorktreeOperation(projectDirectory)) return
      } catch (err) {
        if (!ownsWorktreeOperation(projectDirectory)) return
        const message = errorMessage(err)
        setOperationError(t("worktree.delete_reload_failed", { error: message }))
        setOpen(true)
        AppLog.error("ui", "Failed to reload project worktree state after delete", {
          directory: item.directory,
          error: message,
        })
      }
    } finally {
      setDeleting([item.directory], false)
    }
  }

  async function cleanupExpiredWorktrees(event: MouseEvent): Promise<void> {
    event.stopPropagation()
    const targets = removableExpiredWorktrees()
    const projectDirectory = worktreeDirectory() || dir().trim()
    if (!targets.length || !projectDirectory || cleanupExpiredBusyFor(projectDirectory)) return
    const confirmed = await showAppDialog({
      title: t("worktree.cleanup_expired"),
      message: t("worktree.cleanup_expired_confirm", { count: targets.length }),
      cancel: true,
      okLabel: t("common.delete"),
    })
    if (!confirmed.confirmed) return
    if (dir().trim() !== projectDirectory || worktreeDirectory() !== projectDirectory) return
    const directories = targets.map((item) => item.directory)
    setCleanupExpiredOperationDirectory(projectDirectory)
    setDeleting(directories, true)
    setOperationError("")
    try {
      try {
        await deleteProjectWorktrees(projectDirectory, directories)
      } catch (err) {
        if (!ownsWorktreeOperation(projectDirectory)) return
        let message = errorMessage(err)
        try {
          await syncWorktrees({ requireFresh: true })
        } catch (syncErr) {
          const syncMessage = errorMessage(syncErr)
          message = `${message}; ${syncMessage}`
          AppLog.error("ui", "Failed to reload project worktrees after cleanup failure", {
            directories,
            error: syncMessage,
          })
        }
        setOperationError(t("worktree.cleanup_failed", { error: message }))
        setOpen(true)
        AppLog.error("ui", "Failed to clean expired project worktrees", { directories, error: message })
        return
      }
      try {
        if (!ownsWorktreeOperation(projectDirectory)) return
        setWorktrees((current) => current.filter((candidate) => !directories.includes(candidate.directory)))
        await syncWorktrees({ requireFresh: true })
        if (!ownsWorktreeOperation(projectDirectory)) return
        await loadBoard({ sync: true, requireFresh: true })
        if (!ownsWorktreeOperation(projectDirectory)) return
      } catch (err) {
        if (!ownsWorktreeOperation(projectDirectory)) return
        const message = errorMessage(err)
        setOperationError(t("worktree.cleanup_reload_failed", { error: message }))
        setOpen(true)
        AppLog.error("ui", "Failed to reload project worktree state after cleanup", {
          directories,
          error: message,
        })
      }
    } finally {
      setDeleting(directories, false)
      if (cleanupExpiredOperationDirectory() === projectDirectory) setCleanupExpiredOperationDirectory("")
    }
  }

  createEffect(() => {
    dir()
    void syncWorktrees()
  })

  return (
    <DropdownMenu.Root open={open()} onOpenChange={setRuntimePanelOpen} placement="left-start" gutter={6} fitViewport>
      <DropdownMenu.Trigger
        as={Button}
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-chrome="icon-action"
        data-ui="project-runtime-status-dropdown"
        data-toolbar-compact="true"
        data-vcs-tone={gitTone()}
        title={triggerTitle()}
        aria-label={triggerTitle()}
      >
        <Icon name="git-worktree" size={16} />
        <Show when={triggerBadge()}>
          <span class="project-runtime-trigger-badge" data-kind={triggerBadgeKind()}>
            {triggerBadge()}
          </span>
        </Show>
        <span class="project-runtime-trigger-dot" data-tone={gitTone()} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="project-runtime-status-panel">
          <div class="project-runtime-panel-shell">
            <div class="project-runtime-panel-head">
              <div class="project-runtime-panel-title">
                <Icon name="git-worktree" size={15} />
                <span>{t("project_runtime.title")}</span>
              </div>
              <span class="project-worktree-head-count" data-kind="active">
                {t("worktree.active")} {activeWorktrees().length}
              </span>
              <span class="project-worktree-head-count" data-kind="expired">
                {t("worktree.expired")} {expiredWorktrees().length}
              </span>
              <Show when={expiredWorktrees().length > 0}>
                <Button
                  type="button"
                  variant="ghost"
                  size="mini"
                  tone="neutral"
                  data-ui="project-worktree-cleanup-expired"
                  data-busy={cleanupExpiredBusy() ? "true" : "false"}
                  title={t("worktree.cleanup_expired")}
                  aria-label={t("worktree.cleanup_expired")}
                  disabled={!canCleanupExpired()}
                  onClick={(event) => void cleanupExpiredWorktrees(event)}
                >
                  <Icon name="refresh" size={11} class="project-worktree-cleanup-icon" />
                  <span>{cleanupExpiredBusy() ? t("common.loading") : t("worktree.cleanup_expired")}</span>
                </Button>
              </Show>
            </div>
            <div class="project-runtime-git-section" data-tone={gitTone()}>
              <div class="project-runtime-section-head">
                <span class="project-runtime-section-title">
                  <Icon name="git-branch" size={14} />
                  <span>{t("project_runtime.git_title")}</span>
                </span>
                <span class="project-runtime-git-state">{gitStatusLabel()}</span>
              </div>
              <Show
                when={vcs()?.initialized}
                fallback={
                  <div class="project-runtime-git-empty" data-state={vcs() === null ? "unavailable" : "uninitialized"}>
                    <span>{gitStatusLabel()}</span>
                    <Show when={canInitGit()}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="mini"
                        tone="accent"
                        data-ui="project-init-git"
                        data-busy={gitBusy() ? "true" : "false"}
                        disabled={gitBusy()}
                        title={t("git.init")}
                        aria-label={t("git.init")}
                        onClick={(event) => void handleInitGit(event)}
                      >
                        <Icon name={gitBusy() ? "refresh" : "git-branch-plus"} size={12} />
                        <span>{gitBusy() ? t("common.loading") : t("git.init")}</span>
                      </Button>
                    </Show>
                  </div>
                }
              >
                <div class="project-runtime-git-grid">
                  <div class="project-runtime-git-row">
                    <Icon name="git-branch" size={13} />
                    <span class="project-runtime-git-label">{t("chat.git.branch")}</span>
                    <span class="project-runtime-git-value" title={vcs()?.branch ?? ""}>
                      {vcs()?.branch ?? ""}
                    </span>
                  </div>
                  <Show when={vcs()?.commit}>
                    <div class="project-runtime-git-row">
                      <Icon name="git-commit" size={13} />
                      <span class="project-runtime-git-label">{t("chat.git.commit")}</span>
                      <span class="project-runtime-git-value" title={vcs()?.commit ?? ""}>
                        {compactCommit(vcs()?.commit ?? "")}
                      </span>
                    </div>
                  </Show>
                  <Show when={gitCounts()}>
                    <div class="project-runtime-git-row">
                      <Icon name="files" size={13} />
                      <span class="project-runtime-git-label">{t("project_runtime.git_changes")}</span>
                      <span class="project-runtime-git-value">{gitCounts()}</span>
                    </div>
                  </Show>
                  <Show when={gitArrows()}>
                    <div class="project-runtime-git-row">
                      <Icon name="git-compare" size={13} />
                      <span class="project-runtime-git-label">{t("project_runtime.git_remote")}</span>
                      <span class="project-runtime-git-value">{gitArrows()}</span>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
            <Show when={operationError()}>
              <div class="project-worktree-error" data-ui="project-worktree-operation-error" role="status">
                <Icon name="status-failed" size={14} />
                <span>{operationError()}</span>
              </div>
            </Show>
            <Show when={error() && visibleWorktrees().length > 0}>
              <div class="project-worktree-error" data-ui="project-worktree-load-error" role="alert">
                <Icon name="status-failed" size={14} />
                <span>{error()}</span>
              </div>
            </Show>
            <div class="project-runtime-section-head">
              <span class="project-runtime-section-title">
                <Icon name="git-worktree" size={14} />
                <span>{t("worktree.title")}</span>
              </span>
            </div>
            <Show
              when={visibleWorktrees().length > 0}
              fallback={<div class="project-worktree-empty">{error() || t("worktree.empty")}</div>}
            >
              <div class="project-worktree-list">
                <For each={visibleWorktrees()}>
                  {(item) => (
                    <div class="project-worktree-row" data-status={item.status}>
                      <DropdownMenu.Item
                        as="button"
                        type="button"
                        class="project-worktree-item"
                        aria-busy={deletingWorktrees().has(item.directory) ? "true" : "false"}
                        title={item.directory}
                        onSelect={() => void openDirectory(item.directory)}
                      >
                        <span class="project-worktree-name">{item.name}</span>
                        <span class="project-worktree-state">{worktreeStateLabel(item)}</span>
                        <Show when={item.branch}>
                          <span class="project-worktree-branch" title={item.branch}>
                            <Icon name="git-branch" size={11} class="project-worktree-branch-icon" />
                            {compactBranch(item.branch ?? "")}
                          </span>
                        </Show>
                        <span class="project-worktree-path" title={item.directory}>
                          {compactPath(item.directory)}
                        </span>
                      </DropdownMenu.Item>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        tone="danger"
                        data-chrome="icon-action"
                        data-ui="project-worktree-remove"
                        data-busy={deletingWorktrees().has(item.directory) ? "true" : "false"}
                        title={
                          deletingWorktrees().has(item.directory)
                            ? t("common.loading")
                            : item.status === "expired"
                              ? t("worktree.cleanup_expired")
                              : t("worktree.delete")
                        }
                        aria-label={
                          deletingWorktrees().has(item.directory)
                            ? t("common.loading")
                            : item.status === "expired"
                              ? t("worktree.cleanup_expired")
                              : t("worktree.delete")
                        }
                        disabled={!item.removable || deletingWorktrees().has(item.directory) || cleanupExpiredBusy()}
                        onClick={(event) => void removeWorktree(item, event)}
                      >
                        <Icon name={deletingWorktrees().has(item.directory) ? "refresh" : "close"} size={12} />
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function ProjectRuntimeToolbarActions() {
  return (
    <div class="project-runtime-toolbar-actions" data-ui="project-runtime-toolbar-actions">
      <ProjectRuntimeStatusDropdown />
    </div>
  )
}
