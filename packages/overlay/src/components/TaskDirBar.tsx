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

export interface ProjectWorktreeDropdownProps {
  compact?: boolean
}

export function ProjectWorktreeDropdown(props: ProjectWorktreeDropdownProps = {}) {
  const dir = createMemo(directoryMemo)
  const [open, setOpen] = createSignal(false)
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

  function closePanel(): void {
    setOpen(false)
  }

  function ownsWorktreeOperation(projectDirectory: string): boolean {
    return dir().trim() === projectDirectory && worktreeDirectory() === projectDirectory
  }

  function cleanupExpiredBusyFor(projectDirectory: string): boolean {
    const directory = projectDirectory.trim()
    return directory.length > 0 && cleanupExpiredOperationDirectory() === directory
  }

  function setWorktreePanelOpen(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) void syncWorktrees()
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
    <DropdownMenu.Root
      open={open()}
      onOpenChange={setWorktreePanelOpen}
      placement={props.compact ? "left-start" : "bottom-end"}
      gutter={6}
      fitViewport
    >
      <DropdownMenu.Trigger
        as={Button}
        type="button"
        variant={props.compact ? "ghost" : "outline"}
        size={props.compact ? "icon" : "sm"}
        tone="neutral"
        data-chrome={props.compact ? "icon-action" : undefined}
        data-ui="project-worktree-dropdown"
        data-toolbar-compact={props.compact ? "true" : undefined}
        title={t("worktree.summary", { active: activeWorktrees().length, expired: expiredWorktrees().length })}
        aria-label={t("worktree.summary", { active: activeWorktrees().length, expired: expiredWorktrees().length })}
      >
        <Icon name="folder-open" size={props.compact ? 16 : 14} />
        <Show when={!props.compact}>
          <span class="project-worktree-count" data-kind="active">
            {t("worktree.active")} {activeWorktrees().length}
          </span>
          <Show when={expiredWorktrees().length > 0}>
            <span class="project-worktree-count" data-kind="expired">
              {t("worktree.expired")} {expiredWorktrees().length}
            </span>
          </Show>
          <Icon name="caret-down" size={12} class="project-worktree-caret" />
        </Show>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="project-worktree-panel">
          <div class="project-worktree-panel-shell">
            <div class="project-worktree-panel-head">
              <div class="project-worktree-panel-title">{t("worktree.title")}</div>
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
                            ⎇ {compactBranch(item.branch ?? "")}
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

export interface InitGitButtonProps {
  compact?: boolean
}

export function InitGitButton(props: InitGitButtonProps = {}) {
  const [busy, setBusy] = createSignal(false)
  const visible = createMemo(() => canInitGit())

  async function handleInitGit(): Promise<void> {
    if (!visible() || busy()) return
    setBusy(true)
    try {
      await initGitCurrent()
    } catch (error) {
      AppLog.error("ui", "Failed to initialize git repository", { error: String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={visible()}>
      <Button
        type="button"
        variant={props.compact ? "ghost" : "outline"}
        size={props.compact ? "icon" : "sm"}
        tone="accent"
        data-chrome={props.compact ? "icon-action" : undefined}
        data-ui="project-init-git"
        data-toolbar-compact={props.compact ? "true" : undefined}
        disabled={busy()}
        title={t("git.init")}
        aria-label={t("git.init")}
        onClick={() => void handleInitGit()}
      >
        <Icon name="github" size={props.compact ? 16 : 14} />
        <Show when={!props.compact}>
          <span class="project-init-git-label">{busy() ? t("common.loading") : t("git.init")}</span>
        </Show>
      </Button>
    </Show>
  )
}

// VcsBadge — surfaces the current branch + dirty/ahead/behind count in the
// project runtime toolbar. Pulls from boardStore.vcs (populated by
// services/meta.ts via GET /vcs). Renders nothing when vcs.initialized is false
// so non-git projects stay silent. The underlying signals refresh every time
// meta.ts polls so the badge tracks branch switches without extra wiring.
export interface VcsBadgeProps {
  compact?: boolean
}

export function VcsBadge(props: VcsBadgeProps = {}) {
  const vcs = createMemo(
    () =>
      boardStore.vcs as null | {
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
      },
  )
  const v = createMemo(() => vcs())
  const show = createMemo(() => !!v()?.initialized && !!v()?.branch)
  const tone = createMemo(() => {
    const x = v()
    if (!x) return "neutral"
    if ((x.conflicts ?? 0) > 0) return "bad"
    if (x.dirty) return "warn"
    return "good"
  })
  const counts = createMemo(() => {
    const x = v()
    if (!x) return null
    const parts: string[] = []
    if ((x.staged ?? 0) > 0) parts.push(`+${x.staged}`)
    if ((x.modified ?? 0) > 0) parts.push(`~${x.modified}`)
    if ((x.untracked ?? 0) > 0) parts.push(`?${x.untracked}`)
    if ((x.conflicts ?? 0) > 0) parts.push(`!${x.conflicts}`)
    return parts.length > 0 ? parts.join(" ") : ""
  })
  const arrows = createMemo(() => {
    const x = v()
    if (!x) return ""
    const ahead = x.ahead ?? 0
    const behind = x.behind ?? 0
    if (ahead === 0 && behind === 0) return ""
    return `${ahead > 0 ? `↑${ahead}` : ""}${behind > 0 ? `↓${behind}` : ""}`
  })
  const title = createMemo(() => {
    const x = v()
    if (!x) return ""
    const lines = [
      `${t("chat.git.branch")}: ${x.branch ?? "—"}`,
      x.commit ? `${t("chat.git.commit")}: ${x.commit}` : "",
      x.dirty ? `${t("vcs.dirty")}` : `${t("vcs.clean")}`,
      counts() ? counts() : "",
      arrows() ? arrows() : "",
    ].filter(Boolean)
    return lines.join("\n")
  })

  return (
    <span
      class={props.compact ? "vcs-badge vcs-badge-compact" : "vcs-badge"}
      data-ui="project-vcs-badge"
      data-tone={tone()}
      hidden={!show()}
      title={title()}
    >
      <span class="vcs-badge-icon" aria-hidden="true">
        ⎇
      </span>
      <Show when={!props.compact}>
        <span class="vcs-badge-branch">{v()?.branch ?? ""}</span>
        <Show when={counts()}>
          <span class="vcs-badge-counts">{counts()}</span>
        </Show>
        <Show when={arrows()}>
          <span class="vcs-badge-arrows">{arrows()}</span>
        </Show>
      </Show>
    </span>
  )
}

export function ProjectRuntimeToolbarActions() {
  return (
    <div class="project-runtime-toolbar-actions" data-ui="project-runtime-toolbar-actions">
      <ProjectWorktreeDropdown compact />
      <InitGitButton compact />
      <VcsBadge compact />
    </div>
  )
}
