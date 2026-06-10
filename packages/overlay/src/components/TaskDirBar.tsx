// ── TaskDirBar ──
// Solid components for the project directory cluster used by both Panel and
// Mission. The cwd dropdown owns the breadcrumb, recent-directory popup, and
// path actions; project worktree management, the git branch badge, and
// workspace launchers are siblings in the same project bar so there is one
// workspace chrome implementation.

import { createEffect, createMemo, createSignal, For, Show, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { boardStore, loadBoard } from "../store/board"
import { pathBreadcrumb } from "../utils/dom-utils"
import {
  activeDirectory,
  browseDirectory,
  loadRecentDirectories,
  openDirectory,
  removeRecentDirectory,
  setDirectory,
} from "../services/workspace"
import { t } from "../utils/i18n"
import { AppLog } from "../utils/log"
import { deleteProjectWorktree, loadProjectWorktrees, type ProjectWorktreeInfo } from "../services/worktree"
import { showAppDialog } from "../services/app-dialog"
import { getHostTransport } from "../services/host-transport"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { WorkspaceCodingCliLaunchers } from "./WorkspaceCodingCliLaunchers"
import { WorkspaceEditorLaunchers } from "./WorkspaceEditorLaunchers"
import { WorkspaceLayoutControls } from "./WorkspaceLayoutControls"

const directoryMemo = () => activeDirectory()

function recentPathLabel(value: string): string {
  return value || ""
}

function actionTarget(event: Event): HTMLElement | null {
  const target = event.target as HTMLElement | null
  return target?.closest?.("[data-path-action],[data-path-open],[data-path-set]") ?? null
}

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

export function TaskDirContent() {
  const nativeCommands = getHostTransport().capabilities.nativeCommands
  const dir = createMemo(directoryMemo)
  const breadcrumbHtml = createMemo(() =>
    pathBreadcrumb(dir(), {
      browseDirectory: nativeCommands["workspace.pickDir"],
      openDirectory: nativeCommands["open-path"],
    }),
  )
  const dirTitle = createMemo(() => dir() || t("cwd.unavailable"))
  const dirEmpty = createMemo(() => (dir() ? "false" : "true"))
  const [open, setOpen] = createSignal(false)
  const [panelStyle, setPanelStyle] = createSignal<Record<string, string>>({})
  const [recentDirs, setRecentDirs] = createSignal<string[]>([])
  let dropdownRef: HTMLDivElement | undefined

  function syncRecentDirs(): void {
    setRecentDirs(loadRecentDirectories())
  }

  function closeRecentPanel(): void {
    setOpen(false)
  }

  function openRecentPanel(): void {
    syncRecentDirs()
    if (dropdownRef) {
      const rect = dropdownRef.getBoundingClientRect()
      setPanelStyle({
        top: `${Math.round(rect.bottom + 6)}px`,
        left: `${Math.round(Math.max(4, rect.left))}px`,
        width: `${Math.round(rect.width)}px`,
      })
    }
    setOpen(true)
  }

  function toggleRecentPanel(): void {
    if (open()) closeRecentPanel()
    else openRecentPanel()
  }

  async function handlePathAction(event: MouseEvent): Promise<void> {
    const button = actionTarget(event)
    if (!button || (button as HTMLButtonElement).disabled) return
    event.stopPropagation()
    const action = button.dataset.pathAction || ""
    if (action === "browse") {
      if (!nativeCommands["workspace.pickDir"]) return
      await browseDirectory()
      syncRecentDirs()
      return
    }
    if (button.dataset.pathOpen) {
      if (!nativeCommands["open-path"]) return
      await openDirectory(button.dataset.pathOpen)
      return
    }
    const target = button.dataset.pathSet || ""
    if (!target) return
    try {
      await setDirectory(target)
      syncRecentDirs()
    } catch (err) {
      AppLog.error("ui", "Failed to set working directory", { error: String(err) })
    }
  }

  async function chooseRecentDirectory(dir: string): Promise<void> {
    closeRecentPanel()
    try {
      await setDirectory(dir)
      syncRecentDirs()
    } catch (err) {
      AppLog.error("ui", "Failed to switch to recent directory", { dir, error: String(err) })
    }
  }

  function removeRecent(dir: string): void {
    removeRecentDirectory(dir)
    syncRecentDirs()
    if (!loadRecentDirectories().length) closeRecentPanel()
  }

  onMount(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest?.(".task-cwd-dropdown,.recent-dir-panel")) return
      closeRecentPanel()
    }
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (!open()) return
      event.preventDefault()
      closeRecentPanel()
    }
    document.addEventListener("click", onDocumentClick)
    document.addEventListener("keydown", onDocumentKeyDown)
    onCleanup(() => {
      document.removeEventListener("click", onDocumentClick)
      document.removeEventListener("keydown", onDocumentKeyDown)
    })
  })

  return (
    <>
      <div
        ref={(el) => {
          dropdownRef = el
        }}
        class="task-dir-shell task-cwd-dropdown"
        data-open={open() ? "true" : "false"}
        role="button"
        tabindex={0}
        aria-haspopup="listbox"
        aria-expanded={open() ? "true" : "false"}
        aria-label={t("cwd.recent")}
        title={t("cwd.recent")}
        onClick={(event) => {
          if (actionTarget(event)) return
          event.stopPropagation()
          toggleRecentPanel()
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          if (actionTarget(event)) return
          event.preventDefault()
          toggleRecentPanel()
        }}
      >
        <span
          class="task-dir"
          title={dirTitle()}
          data-empty={dirEmpty()}
          innerHTML={breadcrumbHtml()}
          onClick={(event) => void handlePathAction(event)}
        />
        <div class="task-dir-actions">
          <span class="task-cwd-caret" aria-hidden="true">
            ▾
          </span>
        </div>
      </div>
      <Portal mount={document.body}>
        <Show when={open()}>
          <div class="recent-dir-panel" style={panelStyle()} role="listbox">
            <div class="recent-dir-panel-shell">
              <div class="recent-dir-panel-head">
                <div class="recent-dir-panel-title">{t("cwd.recent")}</div>
                <Show when={dir()}>
                  <div class="recent-dir-panel-meta" title={dir()}>
                    {recentPathLabel(dir())}
                  </div>
                </Show>
              </div>
              <Show
                when={recentDirs().length > 0}
                fallback={<div class="recent-dir-empty">{t("cwd.recent_empty")}</div>}
              >
                <div class="recent-dir-list">
                  <For each={recentDirs()}>
                    {(recent) => {
                      const isActive = () => !!dir() && recent.toLowerCase() === dir().toLowerCase()
                      return (
                        <div class="recent-dir-row" data-active={isActive() ? "true" : "false"}>
                          <button
                            type="button"
                            class="recent-dir-item"
                            title={recent}
                            onClick={() => void chooseRecentDirectory(recent)}
                          >
                            <span class="recent-dir-copy">
                              <span class="recent-dir-label">{recentPathLabel(recent)}</span>
                              <span class="recent-dir-path">{recent}</span>
                            </span>
                            <Show when={isActive()}>
                              <span class="recent-dir-state" aria-hidden="true">
                                •
                              </span>
                            </Show>
                          </button>
                          <button
                            type="button"
                            class="recent-dir-remove"
                            title={t("common.delete")}
                            aria-label={t("common.delete")}
                            onClick={(event) => {
                              event.stopPropagation()
                              removeRecent(recent)
                            }}
                          >
                            <Icon name="close" size={11} />
                          </button>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </Portal>
    </>
  )
}

export function ProjectWorktreeDropdown() {
  const panelMinWidth = 340
  const panelViewportGap = 4
  const dir = createMemo(directoryMemo)
  const [open, setOpen] = createSignal(false)
  const [panelStyle, setPanelStyle] = createSignal<Record<string, string>>({})
  const [worktrees, setWorktrees] = createSignal<ProjectWorktreeInfo[]>([])
  const [error, setError] = createSignal("")
  const visibleWorktrees = createMemo(() => worktrees().filter((item) => item.status !== "primary"))
  const activeWorktrees = createMemo(() => worktrees().filter((item) => item.status === "active"))
  const expiredWorktrees = createMemo(() => worktrees().filter((item) => item.status === "expired"))
  let dropdownRef: HTMLButtonElement | undefined

  async function syncWorktrees(): Promise<void> {
    try {
      const items = await loadProjectWorktrees()
      setWorktrees(items)
      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setWorktrees([])
      setError(message)
      AppLog.warn("ui", "Failed to load project worktrees", { error: message })
    }
  }

  function closePanel(): void {
    setOpen(false)
  }

  function openPanel(): void {
    if (dropdownRef) {
      const rect = dropdownRef.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth
      const width = Math.min(Math.max(rect.width, panelMinWidth), Math.max(0, viewportWidth - panelViewportGap * 2))
      const left = Math.min(
        Math.max(panelViewportGap, rect.left),
        Math.max(panelViewportGap, viewportWidth - width - panelViewportGap),
      )
      setPanelStyle({
        top: `${Math.round(rect.bottom + 6)}px`,
        left: `${Math.round(left)}px`,
        width: `${Math.round(width)}px`,
      })
    }
    setOpen(true)
    void syncWorktrees()
  }

  function togglePanel(): void {
    if (open()) closePanel()
    else openPanel()
  }

  async function removeWorktree(item: ProjectWorktreeInfo, event: MouseEvent): Promise<void> {
    event.stopPropagation()
    if (!item.removable) return
    const confirmed = await showAppDialog({
      title: t("worktree.delete"),
      message: t("worktree.delete_confirm", { path: item.directory }),
      cancel: true,
      okLabel: t("common.delete"),
    })
    if (!confirmed.confirmed) return
    try {
      await deleteProjectWorktree(item.directory)
      await syncWorktrees()
      await loadBoard({ sync: true }).catch(() => undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      AppLog.error("ui", "Failed to delete project worktree", { directory: item.directory, error: message })
    }
  }

  createEffect(() => {
    dir()
    void syncWorktrees()
  })

  onMount(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest?.('[data-ui="project-worktree-dropdown"],.project-worktree-panel')) return
      closePanel()
    }
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (!open()) return
      event.preventDefault()
      closePanel()
    }
    document.addEventListener("click", onDocumentClick)
    document.addEventListener("keydown", onDocumentKeyDown)
    onCleanup(() => {
      document.removeEventListener("click", onDocumentClick)
      document.removeEventListener("keydown", onDocumentKeyDown)
    })
  })

  return (
    <>
      <Button
        ref={(el) => {
          dropdownRef = el
        }}
        type="button"
        variant="outline"
        size="sm"
        tone="neutral"
        data-ui="project-worktree-dropdown"
        data-open={open() ? "true" : "false"}
        title={t("worktree.summary", { active: activeWorktrees().length, expired: expiredWorktrees().length })}
        aria-label={t("worktree.summary", { active: activeWorktrees().length, expired: expiredWorktrees().length })}
        aria-haspopup="listbox"
        aria-expanded={open() ? "true" : "false"}
        onClick={(event) => {
          event.stopPropagation()
          togglePanel()
        }}
      >
        <Icon name="folder-open" size={14} />
        <span class="project-worktree-count" data-kind="active">
          {t("worktree.active")} {activeWorktrees().length}
        </span>
        <Show when={expiredWorktrees().length > 0}>
          <span class="project-worktree-count" data-kind="expired">
            {t("worktree.expired")} {expiredWorktrees().length}
          </span>
        </Show>
        <Icon name="caret-down" size={12} class="project-worktree-caret" />
      </Button>
      <Portal mount={document.body}>
        <Show when={open()}>
          <div class="project-worktree-panel" style={panelStyle()} role="listbox">
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
                  <span class="project-worktree-cleanup-hint">{t("worktree.cleanup_expired")}</span>
                </Show>
              </div>
              <Show when={!error()} fallback={<div class="project-worktree-empty">{error()}</div>}>
                <Show
                  when={visibleWorktrees().length > 0}
                  fallback={<div class="project-worktree-empty">{t("worktree.empty")}</div>}
                >
                  <div class="project-worktree-list">
                    <For each={visibleWorktrees()}>
                      {(item) => (
                        <div class="project-worktree-row" data-status={item.status}>
                          <button
                            type="button"
                            class="project-worktree-item"
                            title={item.directory}
                            onClick={() => void openDirectory(item.directory)}
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
                          </button>
                          <button
                            type="button"
                            class="project-worktree-remove"
                            title={item.status === "expired" ? t("worktree.cleanup_expired") : t("worktree.delete")}
                            aria-label={
                              item.status === "expired" ? t("worktree.cleanup_expired") : t("worktree.delete")
                            }
                            disabled={!item.removable}
                            onClick={(event) => void removeWorktree(item, event)}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </Show>
      </Portal>
    </>
  )
}

export function ProjectDirectoryBar() {
  return (
    <div class="task-meta">
      <div class="task-cwd">
        <div class="task-project-cluster">
          <TaskDirContent />
          <ProjectWorktreeDropdown />
          <VcsBadge />
        </div>
        <div class="workspace-command-dock" data-no-drag="true">
          <WorkspaceEditorLaunchers />
          <div class="workspace-command-divider" aria-hidden="true" />
          <WorkspaceCodingCliLaunchers />
          <div class="workspace-command-divider" aria-hidden="true" />
          <WorkspaceLayoutControls />
        </div>
      </div>
    </div>
  )
}

// VcsBadge — surfaces the current branch + dirty/ahead/behind count next to
// the cwd dropdown. Pulls from boardStore.vcs (populated by services/meta.ts
// via GET /vcs). Renders nothing when vcs.initialized is false so non-git
// projects stay silent. The underlying signals refresh every time meta.ts
// polls so the badge tracks branch switches without extra wiring.
export function VcsBadge() {
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
    <span class="vcs-badge" data-tone={tone()} hidden={!show()} title={title()}>
      <span class="vcs-badge-icon" aria-hidden="true">
        ⎇
      </span>
      <span class="vcs-badge-branch">{v()?.branch ?? ""}</span>
      <Show when={counts()}>
        <span class="vcs-badge-counts">{counts()}</span>
      </Show>
      <Show when={arrows()}>
        <span class="vcs-badge-arrows">{arrows()}</span>
      </Show>
    </span>
  )
}
