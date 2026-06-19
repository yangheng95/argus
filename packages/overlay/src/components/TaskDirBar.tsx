// ── TaskDirBar ──
// Solid components for the project directory cluster used by both Panel and
// Mission. The cwd control owns the breadcrumb, path actions, and
// recent-directory popup trigger; project worktree management, the git branch badge, and
// workspace launchers are siblings in the same project bar so there is one
// workspace chrome implementation.

import * as DropdownMenu from "@kobalte/core/dropdown-menu"
import * as Popover from "@kobalte/core/popover"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { boardStore, loadBoard } from "../store/board"
import { pathBreadcrumb } from "../utils/dom-utils"
import {
  activeDirectory,
  browseDirectory,
  loadRecentDirectories,
  openDirectory,
  removeRecentDirectory,
  setDirectory,
  type DiscoveredProject,
} from "../services/workspace"
import { loadWorkspaceOnboardingDiscovery } from "../services/workspace-onboarding-discovery"
import { t } from "../utils/i18n"
import { AppLog } from "../utils/log"
import { canInitGit, initGitCurrent } from "../utils/git"
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
  let cwdShellRef: HTMLElement | undefined
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
  const [recentDirs, setRecentDirs] = createSignal<string[]>([])
  const [discoveredRoot, setDiscoveredRoot] = createSignal("")
  const [discoveredProjects, setDiscoveredProjects] = createSignal<DiscoveredProject[]>([])
  const [discoveryError, setDiscoveryError] = createSignal("")
  const [pathDraft, setPathDraft] = createSignal("")
  const [recentPanelInlineSize, setRecentPanelInlineSize] = createSignal("")

  function syncRecentDirs(): void {
    setRecentDirs(loadRecentDirectories())
  }

  async function syncDiscoveredProjects(): Promise<void> {
    const discovery = await loadWorkspaceOnboardingDiscovery()
    if (discovery.status === "ready") {
      setDiscoveredRoot(discovery.root)
      setDiscoveredProjects(discovery.projects)
      setDiscoveryError("")
      return
    }

    setDiscoveredRoot("")
    setDiscoveredProjects([])
    setDiscoveryError(discovery.message)
    AppLog.warn("ui", "Failed to discover local OpenCorvus projects", { error: discovery.message })
  }

  function syncPanelData(): void {
    syncRecentDirs()
    setPathDraft(dir())
    void syncDiscoveredProjects()
  }

  function syncRecentPanelGeometry(): void {
    if (!cwdShellRef) throw new Error("TaskDirBar recent panel anchor is not mounted.")
    const width = cwdShellRef.getBoundingClientRect().width
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error(`TaskDirBar recent panel anchor width is invalid: ${width}`)
    }
    setRecentPanelInlineSize(`${Math.round(width)}px`)
  }

  function closeRecentPanel(): void {
    setOpen(false)
  }

  function setRecentPanelOpen(nextOpen: boolean): void {
    if (nextOpen) {
      syncPanelData()
      syncRecentPanelGeometry()
    }
    setOpen(nextOpen)
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

  async function submitPath(event: Event): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    const next = pathDraft().trim()
    if (!next) return
    try {
      await setDirectory(next)
      syncPanelData()
      closeRecentPanel()
    } catch (err) {
      AppLog.error("ui", "Failed to set working directory from cwd editor", { directory: next, error: String(err) })
    }
  }

  return (
    <Popover.Root
      open={open()}
      onOpenChange={setRecentPanelOpen}
      anchorRef={() => cwdShellRef}
      placement="bottom-end"
      gutter={6}
      slide={false}
    >
      <div
        ref={(element) => {
          cwdShellRef = element
        }}
        class="task-dir-shell task-cwd-dropdown"
        data-open={open() ? "true" : "false"}
        title={dirTitle()}
      >
        <span
          class="task-dir"
          title={dirTitle()}
          data-empty={dirEmpty()}
          innerHTML={breadcrumbHtml()}
          onClick={(event) => void handlePathAction(event)}
        />
        <div class="task-dir-menu-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-chrome="icon-action"
            data-ui="cwd-recent-trigger"
            data-open={open() ? "true" : "false"}
            aria-haspopup="dialog"
            aria-expanded={open()}
            aria-controls={open() ? "cwd-recent-panel" : undefined}
            aria-label={t("cwd.recent")}
            title={t("cwd.recent")}
            onClick={() => setRecentPanelOpen(!open())}
          >
            <Icon name="caret-down" size={12} class="task-cwd-caret" />
          </Button>
        </div>
      </div>
      <Popover.Portal>
        <Popover.Content
          id="cwd-recent-panel"
          class="recent-dir-panel"
          role="dialog"
          aria-label={t("cwd.recent")}
          style={{ width: recentPanelInlineSize(), "max-width": recentPanelInlineSize() }}
        >
          <div class="recent-dir-panel-shell">
            <div class="recent-dir-panel-head">
              <div class="recent-dir-panel-title">{t("cwd.recent")}</div>
              <Show when={dir()}>
                <div class="recent-dir-panel-meta" title={dir()}>
                  {recentPathLabel(dir())}
                </div>
              </Show>
            </div>
            <form class="recent-dir-edit-form" onSubmit={(event) => void submitPath(event)}>
              <label class="recent-dir-edit-label">
                <span>{t("cwd.path_label")}</span>
                <input
                  value={pathDraft()}
                  onInput={(event) => setPathDraft(event.currentTarget.value)}
                  placeholder={t("workspace_onboarding.browser_path_placeholder")}
                  data-ui="cwd-path-input"
                  autocomplete="off"
                  spellcheck={false}
                />
              </label>
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                tone="neutral"
                data-chrome="icon-action"
                data-ui="recent-dir-edit-submit"
                disabled={!pathDraft().trim()}
                title={t("common.save")}
                aria-label={t("common.save")}
              >
                <Icon name="folder-open" size={14} />
              </Button>
            </form>
            <Show when={discoveryError()}>
              <div class="recent-dir-discovery-error" data-testid="cwd-discovery-error" role="status">
                <Icon name="status-failed" size={14} />
                <span>{discoveryError()}</span>
              </div>
            </Show>
            <Show when={discoveredProjects().length > 0}>
              <div class="recent-dir-section">
                <div class="recent-dir-section-title" title={discoveredRoot()}>
                  {t("cwd.detected_projects")}
                </div>
                <div class="recent-dir-list" role="list">
                  <For each={discoveredProjects()}>
                    {(project) => {
                      const isActive = () => !!dir() && project.directory.toLowerCase() === dir().toLowerCase()
                      return (
                        <div class="recent-dir-row" data-active={isActive() ? "true" : "false"} role="listitem">
                          <button
                            type="button"
                            class="recent-dir-item"
                            title={project.directory}
                            aria-current={isActive() ? "location" : undefined}
                            onClick={() => void chooseRecentDirectory(project.directory)}
                          >
                            <span class="recent-dir-copy">
                              <span class="recent-dir-label">{project.name}</span>
                              <span class="recent-dir-path">{project.directory}</span>
                            </span>
                            <Show when={isActive()}>
                              <span class="recent-dir-state" aria-hidden="true">
                                •
                              </span>
                            </Show>
                          </button>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            </Show>
            <Show when={recentDirs().length > 0} fallback={<div class="recent-dir-empty">{t("cwd.recent_empty")}</div>}>
              <div class="recent-dir-list" data-kind="recent" role="list">
                <For each={recentDirs()}>
                  {(recent) => {
                    const isActive = () => !!dir() && recent.toLowerCase() === dir().toLowerCase()
                    return (
                      <div class="recent-dir-row" data-active={isActive() ? "true" : "false"} role="listitem">
                        <button
                          type="button"
                          class="recent-dir-item"
                          title={recent}
                          aria-current={isActive() ? "location" : undefined}
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          tone="danger"
                          data-chrome="icon-action"
                          data-ui="recent-dir-remove"
                          title={t("common.delete")}
                          aria-label={t("common.delete")}
                          onClick={(event) => {
                            event.stopPropagation()
                            removeRecent(recent)
                          }}
                        >
                          <Icon name="close" size={11} />
                        </Button>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ProjectWorktreeDropdown() {
  const dir = createMemo(directoryMemo)
  const [open, setOpen] = createSignal(false)
  const [worktrees, setWorktrees] = createSignal<ProjectWorktreeInfo[]>([])
  const [error, setError] = createSignal("")
  const visibleWorktrees = createMemo(() => worktrees().filter((item) => item.status !== "primary"))
  const activeWorktrees = createMemo(() => worktrees().filter((item) => item.status === "active"))
  const expiredWorktrees = createMemo(() => worktrees().filter((item) => item.status === "expired"))

  async function syncWorktrees(): Promise<void> {
    const projectDirectory = dir().trim()
    if (!projectDirectory) {
      setWorktrees([])
      setError("")
      return
    }
    try {
      const items = await loadProjectWorktrees(projectDirectory)
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

  function setWorktreePanelOpen(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) void syncWorktrees()
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
      await deleteProjectWorktree(dir(), item.directory)
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

  return (
    <DropdownMenu.Root open={open()} onOpenChange={setWorktreePanelOpen} placement="bottom-end" gutter={6} fitViewport>
      <DropdownMenu.Trigger
        as={Button}
        type="button"
        variant="outline"
        size="sm"
        tone="neutral"
        data-ui="project-worktree-dropdown"
        title={t("worktree.summary", { active: activeWorktrees().length, expired: expiredWorktrees().length })}
        aria-label={t("worktree.summary", { active: activeWorktrees().length, expired: expiredWorktrees().length })}
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
                        <DropdownMenu.Item
                          as="button"
                          type="button"
                          class="project-worktree-item"
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
                          title={item.status === "expired" ? t("worktree.cleanup_expired") : t("worktree.delete")}
                          aria-label={item.status === "expired" ? t("worktree.cleanup_expired") : t("worktree.delete")}
                          disabled={!item.removable}
                          onClick={(event) => void removeWorktree(item, event)}
                        >
                          <Icon name="close" size={12} />
                        </Button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function ProjectDirectoryBar() {
  return (
    <div class="task-meta">
      <div class="task-cwd">
        <div class="task-project-cluster">
          <TaskDirContent />
          <ProjectWorktreeDropdown />
          <InitGitButton />
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

export function InitGitButton() {
  const [busy, setBusy] = createSignal(false)
  const visible = createMemo(() => canInitGit())

  async function handleInitGit(): Promise<void> {
    if (!visible() || busy()) return
    setBusy(true)
    try {
      await initGitCurrent()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={visible()}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        tone="accent"
        data-ui="project-init-git"
        disabled={busy()}
        title={t("git.init")}
        aria-label={t("git.init")}
        onClick={() => void handleInitGit()}
      >
        <Icon name="github" size={14} />
        <span class="project-init-git-label">{busy() ? t("common.loading") : t("git.init")}</span>
      </Button>
    </Show>
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
