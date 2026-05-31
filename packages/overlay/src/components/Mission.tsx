// ── Mission ──
//
// Operator control room for the user's long-running goals. A separate page
// (template §6.2) sitting beside the default conversation panel — switching modes
// uses the shared `pageMode` store (store/page-mode.ts) and does NOT clear or
// rewrite the panel's selected task.
//
// Layout (template §7):
//   header    : workspace, system health, channel runtime, counts, actions
//   ledger    : task list (project + global, filterable, queue-aware)
//   workbench : shared task/session conversation panel, OR mission launcher
//   channels  : channel catalog, runtime status, restart, selected-task
//               bindings (kept mission/channel infrastructure)
//
// Data sources (template §5 — single source of truth):
//   • boardStore.tasks          — task list from existing /global/tasks
//   • boardStore.board          — selected task detail
//   • MissionStats              — mission/stats infra endpoint (counts + project)
//   • Channel runtime + list    — existing channel infra routes
//   • /mission/wake             — start or resume the Mission agent session
//
// Errors are surfaced explicitly (template §14): no silent fallback, no
// degraded state. Each error block names the operation and the server
// message and offers a retry where retrying is meaningful.

import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js"
import { boardStore, setBoardStore, loadTasks, taskByID, visibleTasks,
  activeTaskID,
} from "../store/board"
import { clearMessages, setChatAttachments } from "../store/messages"
import { settingsStore, setSettingsStore, saveSettings } from "../store/settings"
import { initPaneResizers, renderPaneLayout, MISSION_PANE_CONFIG } from "../services/pane"
import { isMissionPage, setPageMode } from "../store/page-mode"
import {
  cancelTask,
  deleteTask,
  selectTask,
  submitMessage,
} from "../services/task"
import {
  loadChannelList,
  loadChannelRuntime,
  loadMissionStats,
  loadTaskBindings,
  restartChannelRuntime,
  wakeMission,
  type ChannelInfo,
  type ChannelRuntimeStatus,
  type MissionStats,
} from "../services/mission"
import { ApiError } from "../services/api"
import { loadConversation } from "../services/conversation"
import { startSSE, stopSSE } from "../services/sse"
import { resetWriter } from "../services/tree-writer"
import { t } from "../utils/i18n"
import {
  compactDirectory,
  filterMatches,
  MISSION_REQUIREMENT_MAX_CHARS,
  humanizeApiError,
  pendingInteractions,
  runtimeLabel,
  type LedgerFilter,
} from "../utils/mission-helpers"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { Conversation } from "./Conversation"
import { ChatComposer } from "./ChatComposer"
import { AutoGrowTextarea } from "./primitives/AutoGrowTextarea"
import { TaskList } from "./TaskList"

// ── Status taxonomies ──
//
// template §9 distinguishes six operator-facing categories:
//   queued · active running · waiting for user input · failed ·
//   cancelled · completed
//
// "active" here means strictly "running" — queued tasks have their own
// filter, and tasks with pending interactions surface under "waiting".
// Pre-fix, "active" also matched queued (a copy of the panel's
// "interruptable" set), which made the queue filter redundant and hid
// what was really running. (rule 8 — single source: the filter and the
// queue badge should agree on what each status means.)

// Statuses considered "interruptable" by the row-level cancel button.
// Used ONLY by the row action gate, not by the filter — keep the two
// concepts distinct.
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

// humanizeApiError now lives in utils/mission-helpers.ts so the unit
// test can exercise it directly with a real ApiError instance — round-2
// shipped a regex variant here that grepped only for `^<Class>:` and
// never matched the wrapped `API <code> <path>: <Class>: …` shape
// ApiError actually produces. The round-3 visual review caught the
// regression precisely because the test file only grepped for the
// function name's presence (rule 28 / 36 — tests must guard behaviour,
// not source structure).

// `actionBusy` and `actionError.action` carry an internal key of the form
// `<verb>:<id>` (e.g. `cancel:tsk_01HZ…`) or a verb-only key for
// surface-level actions (e.g. `restart:channel`). The page-level banner
// must show an operator-readable verb, not the raw key, so split the
// verb out and look it up in i18n. Falls back to the raw verb when an
// unknown action lands here so we never hide an error behind a missing
// key — that would itself be a fallback (rule 7).
//
// The t() call is inlined as a template literal so the panel-i18n
// static analyser recognises `mission.error.action.*` as referenced
// (script/check-panel-i18n.ts:76 — only literal template expressions
// inside t() are scanned; a `t(variable)` indirection is invisible to
// it and would flag the new locale entries as unused).
function actionVerbLabel(actionKey: string): string {
  const verb = String(actionKey || "").split(":", 1)[0] || actionKey
  const translated = t(`mission.error.action.${verb}`)
  return translated === `mission.error.action.${verb}` ? verb : translated
}

// ── Top-level Mission component ──

export function Mission() {
  // ── Per-page state ─────────────────────────────────────────────────
  const [filter, setFilter] = createSignal<LedgerFilter>("all")
  const [searchQuery, setSearchQuery] = createSignal("")
  const [scope, setScope] = createSignal<"project" | "global">("global")
  const [composerOpen, setComposerOpen] = createSignal(false)
  const [actionBusy, setActionBusy] = createSignal<string>("")
  const [actionError, setActionError] = createSignal<{ action: string; error: string } | null>(null)
  // Channel-restart errors get their own surface so they're visible
  // inside the channel side panel even when no task is selected and
  // the workbench-side actionError block isn't rendered (codex review:
  // P2 — restart errors were previously invisible from the composer or
  // empty-selection states).
  const [channelRestartError, setChannelRestartError] = createSignal<string>("")

  // ── Resources backed by mission endpoints ──
  //
  // Every Mission resource is project-scoped on the server, so it MUST
  // wait until `settingsStore.directory` is hydrated before firing —
  // otherwise the request lands without a `?directory=` query and the
  // server returns DirectoryRequiredError (visible to the operator as a
  // generic "Mission 统计加载失败：API 400 …" banner). createResource's
  // source function gates the fetcher: returning a falsy value parks
  // the resource, and the call only fires once a real directory is in
  // place. The fetcher reads the same value so the URL also carries an
  // explicit `directory` parameter — belt-and-braces against any future
  // change to apiJson's auto-injection logic.

  // Resources fire only when (a) the Mission page is the active mode AND
  // (b) `settingsStore.directory` is populated. (a) avoids wasted
  // server traffic from the always-mounted Mission component while the
  // operator is using the Panel. (b) avoids DirectoryRequiredError on
  // project-scoped routes during cold boot before settings rehydrate.
  //
  // CRITICAL: read BOTH signals on every invocation so Solid tracks them
  // both, regardless of which branch produces the return value. A naive
  // `if (!isMissionPage()) return null` short-circuit would skip the
  // directory read, so a later directory-set wouldn't re-trigger the
  // resource. Reading both up front avoids that reactivity hole.
  const missionDirectory = (): string | null => {
    const onMissionPage = isMissionPage()
    const dir = settingsStore.directory
    if (!onMissionPage) return null
    return dir ? dir : null
  }

  const [stats, statsCtl] = createResource(
    missionDirectory,
    async (directory: string) => {
      try {
        return await loadMissionStats({ directory })
      } catch (err) {
        throw new Error(errorMessage(err))
      }
    },
  )

  const [channels, channelsCtl] = createResource(
    missionDirectory,
    async () => {
      try {
        return await loadChannelList()
      } catch (err) {
        throw new Error(errorMessage(err))
      }
    },
    { initialValue: [] },
  )

  const [runtime, runtimeCtl] = createResource(
    missionDirectory,
    async () => {
      try {
        return await loadChannelRuntime()
      } catch (err) {
        throw new Error(errorMessage(err))
      }
    },
  )

  // Bindings belong to Mission's channel panel. The component stays
  // mounted while the conversation panel is active, so park this resource
  // outside Mission mode instead of doing hidden selected-task work.
  const [bindings, bindingsCtl] = createResource(
    () => {
      const onMissionPage = isMissionPage()
      const taskID = activeTaskID()
      return onMissionPage && taskID ? taskID : null
    },
    async (taskID) => {
      if (!taskID) return []
      try {
        return await loadTaskBindings(taskID)
      } catch (err) {
        throw new Error(errorMessage(err))
      }
    },
    { initialValue: [] },
  )

  onMount(() => {
    // Make sure the panel-driven /global/tasks call has actually
    // happened — Mission can be the operator's first port of call after
    // app launch, and they need to see tasks immediately.
    if (!boardStore.tasksLoaded && !boardStore.tasksError) {
      void loadTasks().catch(() => undefined)
    }
  })

  // ── Resizable three columns ────────────────────────────────────────
  //
  // Reuse the default Panel's drag service (services/pane.ts) instead of a
  // second implementation — Mission supplies its own DOM handles + CSS
  // variables via MISSION_PANE_CONFIG, and persists its own widths
  // (settings.missionLedgerWidth / missionChannelsWidth) so resizing
  // Mission never moves the Panel and vice-versa. Mission has no column
  // collapse affordance, so the collapse flags are always false.
  const missionPaneCallbacks = {
    getState: () => ({
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      sidebarWidth: settingsStore.missionLedgerWidth,
      sectionsWidth: settingsStore.missionChannelsWidth,
    }),
    onWidthsChanged: (sidebarWidth: number | null, sectionsWidth: number | null) => {
      setSettingsStore({
        ...(sidebarWidth != null ? { missionLedgerWidth: sidebarWidth } : {}),
        ...(sectionsWidth != null ? { missionChannelsWidth: sectionsWidth } : {}),
      })
      saveSettings()
    },
  }

  // Attach the pointer listeners once. The resize handles live in the DOM
  // unconditionally (siblings of the columns inside `.mission-body`, not
  // gated by isMissionPage) so they exist when onMount runs and stay valid
  // across page-mode toggles — mirroring how the Panel's static handles in
  // index.html are wired once at boot. Hidden with the rest of
  // `.mission-mount` (display:none) when Mission is not the active page.
  onMount(() => {
    const dispose = initPaneResizers(missionPaneCallbacks, MISSION_PANE_CONFIG)
    onCleanup(dispose)
  })

  // Apply (and re-apply) the persisted column widths as CSS custom
  // properties whenever they change while Mission is the active page —
  // mirrors the Panel's renderPaneLayout effect in main.tsx.
  //
  // Deferred one frame via requestAnimationFrame: `body[data-page-mode]`
  // (which flips `.mission-mount` from display:none to flex) is written by
  // a SEPARATE effect in main.tsx that is created AFTER this component
  // mounts, so it runs AFTER this effect in the same update batch. Without
  // the rAF, renderPaneLayout would measure `#missionBody` while it is
  // still display:none (clientWidth 0) and clamp every column to the rail
  // minimum. The rAF lets the display flip + layout settle first.
  createEffect(() => {
    if (!isMissionPage()) return
    const sidebarWidth = settingsStore.missionLedgerWidth
    const sectionsWidth = settingsStore.missionChannelsWidth
    requestAnimationFrame(() => {
      if (!isMissionPage()) return
      renderPaneLayout(
        { sidebarCollapsed: false, rightPanelCollapsed: false, sidebarWidth, sectionsWidth },
        MISSION_PANE_CONFIG,
      )
    })
  })

  // ── Derived task views ─────────────────────────────────────────────

  const activeDirectory = () => settingsStore.directory || ""
  const missionTasks = createMemo(() => (isMissionPage() ? visibleTasks() : []))

  const filteredTasks = createMemo(() => {
    const list = missionTasks()
    const q = searchQuery().trim().toLowerCase()
    const f = filter()
    const s = scope()
    const dir = activeDirectory()
    return list.filter((item: any) => {
      const status = String(item?.task?.status ?? "idle")
      // Pass `item` so filterMatches can read pending_interactions — without
      // it, the "waiting" filter never matches and the "active" filter
      // wrongly includes tasks that have pending operator interactions
      // (template §9 strict status taxonomy). The helper unit test in
      // mission-helpers.test.ts already exercises this signature; the bug
      // here was that the product-code call site dropped the third arg.
      if (!filterMatches(status, f, item)) return false
      if (s === "project") {
        const itemDir = String(item?.task?.directory ?? "")
        if (dir && itemDir && itemDir !== dir) return false
      }
      if (q) {
        const haystack = [
          item?.task?.title,
          item?.task?.id,
          item?.task?.directory,
          item?.task?.status,
          item?.overview?.headline,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  })

  const counts = createMemo(() => {
    const list = missionTasks()
    let active = 0
    let queued = 0
    let waiting = 0
    let failed = 0
    let completed = 0
    let cancelled = 0
    for (const item of list) {
      const status = String(item?.task?.status ?? "")
      const pending = pendingInteractions(item)
      if (pending > 0) waiting += 1
      // Active count excludes tasks already counted as waiting so the
      // header math doesn't double-count.
      if ((status === "active" && pending === 0) || item?._pending) active += 1
      if (status === "queued") queued += 1
      if (status === "failed") failed += 1
      if (status === "completed") completed += 1
      if (status === "cancelled") cancelled += 1
    }
    return { active, queued, waiting, failed, completed, cancelled, total: list.length }
  })

  const selectedItem = () => taskByID(activeTaskID())
  const selectedBoard = () => boardStore.board ?? null
  // Workbench shows progressively: if the operator selects a task we have
  // *any* data on (the ledger row from boardStore.tasks), render the
  // detail surface immediately. The shared conversation panel hydrates when
  // selectTask() completes, so Mission does not maintain a second task detail
  // or message surface.
  const hasSelection = () =>
    !!activeTaskID() && (!!selectedItem() || !!selectedBoard())

  // ── Refresh / actions ──────────────────────────────────────────────

  async function refreshAll(): Promise<void> {
    setActionError(null)
    await Promise.allSettled([
      loadTasks().catch(() => undefined),
      statsCtl.refetch(),
      channelsCtl.refetch(),
      runtimeCtl.refetch(),
      bindingsCtl.refetch(),
    ])
  }

  function reportActionError(action: string, err: unknown): void {
    setActionError({ action, error: humanizeApiError(err) })
  }

  async function withBusy<T>(actionKey: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (actionBusy()) return undefined
    setActionBusy(actionKey)
    setActionError(null)
    try {
      return await fn()
    } catch (err) {
      reportActionError(actionKey, err)
      return undefined
    } finally {
      setActionBusy("")
    }
  }

  async function handleCancelTask(taskID: string): Promise<void> {
    await withBusy(`cancel:${taskID}`, async () => {
      await cancelTask(taskID)
      await loadTasks()
    })
  }
  async function handleDeleteTask(taskID: string): Promise<void> {
    await withBusy(`delete:${taskID}`, async () => {
      const ok = await deleteTask(taskID)
      if (!ok) throw new Error("delete task: server rejected the request")
    })
  }
  function handleOpenInPanel(): void {
    setPageMode("panel")
  }

  async function handleMissionAwake(result: { sessionID: string }): Promise<void> {
    const source = { kind: "session" as const, id: result.sessionID }
    stopSSE()
    clearMessages()
    setChatAttachments([])
    resetWriter({ scrollIntent: "bottom", cause: "mission-session-switch" })
    setBoardStore("selectedSource", source)
    await loadConversation(source, {
      scrollIntent: "bottom",
      resetCause: "mission-session-hydrate",
    })
    startSSE(source, 0)
    setComposerOpen(false)
  }

  function handleCloseMission(): void {
    if (boardStore.selectedSource?.kind !== "session") return
    stopSSE()
    clearMessages()
    setChatAttachments([])
    resetWriter({ scrollIntent: "bottom", cause: "mission-session-close" })
    setBoardStore("selectedSource", null)
    setBoardStore("board", null)
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div class="mission" data-ui="mission-page">
      <Show when={isMissionPage()}>
        <MissionHeader
          stats={stats()}
          statsError={stats.error ? humanizeApiError(stats.error) : ""}
          runtime={runtime()}
          runtimeError={runtime.error ? humanizeApiError(runtime.error) : ""}
          counts={counts()}
          directory={activeDirectory()}
          refreshing={stats.loading || runtime.loading || channels.loading}
          composerOpen={composerOpen()}
          showComposeButton={hasSelection() || boardStore.selectedSource?.kind === "session"}
          onRefresh={() => void refreshAll()}
          onCompose={() => setComposerOpen(true)}
        />
      </Show>

      <Show when={isMissionPage() && actionError()}>
        <div class="mission-action-error" role="alert" data-ui="mission-global-action-error">
          <span>
            {t("mission.workbench.error_action_failed", {
              action: actionVerbLabel(actionError()!.action),
              error: actionError()!.error,
            })}
          </span>
          <button
            type="button"
            class="mission-action-error-dismiss"
            aria-label={t("common.clear")}
            onClick={() => setActionError(null)}
          >
            <Icon name="close" size={10} />
          </button>
        </div>
      </Show>

      <div class="mission-body" id="missionBody">
        <Show when={isMissionPage()}>
          <MissionTaskLedger
            tasks={filteredTasks()}
            filter={filter()}
            onFilterChange={setFilter}
            scope={scope()}
            onScopeChange={setScope}
            searchQuery={searchQuery()}
            onSearchChange={setSearchQuery}
            tasksError={boardStore.tasksError}
            onSelectTask={(id) => {
              void selectTask(id)
            }}
            onCancelTask={(id) => void handleCancelTask(id)}
            onDeleteTask={(id) => void handleDeleteTask(id)}
            onRetryLoad={() => void loadTasks().catch(() => undefined)}
          />
        </Show>

        {/* Resize handles are NOT gated by isMissionPage so they exist in
            the DOM when onMount wires them (and stay valid across page
            toggles). Hidden with `.mission-mount` when Mission is inactive,
            and at narrow breakpoints alongside their column. */}
        <div
          class="pane-resizer pane-resizer-left"
          id="missionLedgerResizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("mission.ledger.title")}
        />

        <MissionWorkbench
          active={isMissionPage()}
          composerOpen={composerOpen()}
          onCloseComposer={() => setComposerOpen(false)}
          hasSelection={hasSelection()}
          selectedSource={boardStore.selectedSource}
          onOpenInPanel={handleOpenInPanel}
          onCloseMission={handleCloseMission}
          onMissionAwake={(result) => void handleMissionAwake(result)}
        />

        <div
          class="pane-resizer pane-resizer-right"
          id="missionChannelsResizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("mission.channels.heading")}
        />

        <Show when={isMissionPage()}>
          <MissionChannelPanel
            channels={channels()}
            channelsError={channels.error ? humanizeApiError(channels.error) : ""}
            runtime={runtime()}
            runtimeError={runtime.error ? humanizeApiError(runtime.error) : ""}
            restartError={channelRestartError()}
            bindings={bindings()}
            bindingsError={bindings.error ? humanizeApiError(bindings.error) : ""}
            selectedTaskID={activeTaskID()}
            actionBusy={actionBusy()}
            onRestartRuntime={async () => {
              // Restart errors live in `channelRestartError` (rendered by
              // the channel panel itself) instead of the workbench
              // `actionError` block. The channel panel is the surface the
              // operator is looking at when they click Restart.
              if (actionBusy()) return
              // `<verb>:<scope>` so actionVerbLabel can map this to a
              // translated label. Pre-fix this was "channel:restart", which
              // pulled the noun out as the verb and produced the wrong i18n
              // lookup (rule 8 single source — actionBusy keys share one
              // grammar across the surface).
              setActionBusy("restart:channel")
              setChannelRestartError("")
              try {
                const next = await restartChannelRuntime()
                runtimeCtl.mutate(next)
              } catch (err) {
                setChannelRestartError(humanizeApiError(err))
              } finally {
                setActionBusy("")
              }
            }}
            onRefreshChannels={() => void Promise.allSettled([channelsCtl.refetch(), runtimeCtl.refetch(), bindingsCtl.refetch()])}
          />
        </Show>
      </div>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────

function MissionHeader(props: {
  stats: MissionStats | null | undefined
  statsError: string
  runtime: ChannelRuntimeStatus | null | undefined
  runtimeError: string
  counts: { active: number; queued: number; waiting: number; failed: number; completed: number; cancelled: number; total: number }
  directory: string
  refreshing: boolean
  composerOpen: boolean
  showComposeButton: boolean
  onRefresh: () => void
  onCompose: () => void
}) {
  const runtimeStatusLabel = () => {
    const r = props.runtime
    if (!r) return t("mission.runtime.disabled")
    return runtimeLabel(r.status)
  }
  const healthStatus = () => {
    if (props.statsError) return "error"
    if (!props.stats) return "unknown"
    return "healthy"
  }
  return (
    <header class="mission-header" data-ui="mission-header">
      <div class="mission-header-row mission-header-row--stats">
        <div class="mission-header-cluster">
          <span class="mission-header-eyebrow">
            <Icon name="mission" size={14} />
            <span>{t("mission.title")}</span>
          </span>
          <span class="mission-header-subtitle">{t("mission.subtitle")}</span>
        </div>
        <span class="mission-stat" data-stat="workspace" title={props.directory || ""}>
          <span class="mission-stat-label">{t("mission.workspace_label")}</span>
          <span class="mission-stat-value">{compactDirectory(props.directory) || "—"}</span>
        </span>
        <span class="mission-stat" data-stat="health" data-status={healthStatus()}>
          <span class="mission-stat-label">{t("mission.health_label")}</span>
          <span class="mission-stat-value">
            {props.statsError
              ? t("mission.health.error")
              : props.stats
                ? t("mission.health.healthy")
                : t("mission.health.unknown")}
          </span>
        </span>
        <span class="mission-stat" data-stat="runtime" data-status={props.runtime?.status ?? "disabled"}>
          <span class="mission-stat-label">{t("mission.runtime_label")}</span>
          <span class="mission-stat-value">
            {props.runtimeError ? t("mission.runtime.error") : runtimeStatusLabel()}
          </span>
        </span>
        <span class="mission-stat" data-stat="counts">
          <span class="mission-stat-label">{t("mission.counts.total", { count: String(props.counts.total) })}</span>
          <span class="mission-stat-value">
            <span class="mission-count" data-status="active">
              {t("mission.counts.active", { count: String(props.counts.active) })}
            </span>
            <span class="mission-count" data-status="queued">
              {t("mission.counts.queued", { count: String(props.counts.queued) })}
            </span>
            <span class="mission-count" data-status="waiting">
              {t("mission.counts.waiting", { count: String(props.counts.waiting) })}
            </span>
            <span class="mission-count" data-status="failed">
              {t("mission.counts.failed", { count: String(props.counts.failed) })}
            </span>
            <span class="mission-count" data-status="completed">
              {t("mission.counts.completed", { count: String(props.counts.completed) })}
            </span>
            <span class="mission-count" data-status="cancelled">
              {t("mission.counts.cancelled", { count: String(props.counts.cancelled) })}
            </span>
          </span>
        </span>
        <div class="mission-header-actions" role="toolbar" aria-label={t("mission.title")}>
          <Show when={props.showComposeButton}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tone="accent"
              data-ui="mission-new-requirement"
              disabled={props.composerOpen}
              title={t("mission.new_requirement_title")}
              aria-label={t("mission.new_requirement")}
              onClick={props.onCompose}
            >
              <Icon name="plus" size={13} />
            </Button>
          </Show>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-ui="mission-refresh"
            disabled={props.refreshing}
            title={t("mission.refresh_title")}
            aria-label={props.refreshing ? t("mission.refreshing") : t("mission.refresh")}
            onClick={props.onRefresh}
          >
            <Icon name="refresh" size={13} />
          </Button>
          {/* Page-mode toggle lives in the titlebar Mission button now —
              one button, one stable position across both modes. The
              in-page back affordance was removed because keeping two
              navigation surfaces meant the operator's eye had to relearn
              the toggle position when crossing pages. */}
        </div>
      </div>
      <Show when={props.statsError}>
        <div class="mission-error" role="alert" data-ui="mission-stats-error">
          <Icon name="status-failed" size={12} />
          <span>{t("mission.error.stats_failed", { error: props.statsError })}</span>
        </div>
      </Show>
    </header>
  )
}

// ── Task ledger (left column) ─────────────────────────────────────────

function MissionTaskLedger(props: {
  tasks: any[]
  filter: LedgerFilter
  onFilterChange: (next: LedgerFilter) => void
  scope: "project" | "global"
  onScopeChange: (next: "project" | "global") => void
  searchQuery: string
  onSearchChange: (next: string) => void
  tasksError: string
  onSelectTask: (id: string) => void
  onCancelTask: (id: string) => void
  onDeleteTask: (id: string) => void
  onRetryLoad: () => void
}) {
  // Filter order matches template §9: queued → active → waiting → failed →
  // completed → cancelled → all. "All" lives at the end as the escape
  // hatch when the operator wants to see everything regardless of state.
  const FILTERS: LedgerFilter[] = ["queued", "active", "waiting", "failed", "completed", "cancelled", "all"]
  return (
    <aside class="mission-ledger" data-ui="mission-ledger">
      <header class="mission-ledger-header oc-surface-header">
        <span class="mission-ledger-title oc-surface-header__title">{t("mission.ledger.title")}</span>
        <div class="oc-surface-header__actions">
          <div class="mission-scope-toggle" role="tablist" aria-label={t("mission.ledger.title")}>
            <button
              type="button"
              class="mission-scope-button"
              role="tab"
              aria-selected={props.scope === "project"}
              data-active={props.scope === "project" ? "true" : undefined}
              onClick={() => props.onScopeChange("project")}
            >
              {t("mission.ledger.scope.project")}
            </button>
            <button
              type="button"
              class="mission-scope-button"
              role="tab"
              aria-selected={props.scope === "global"}
              data-active={props.scope === "global" ? "true" : undefined}
              onClick={() => props.onScopeChange("global")}
            >
              {t("mission.ledger.scope.global")}
            </button>
          </div>
        </div>
      </header>

      <div class="mission-ledger-search">
        <Icon name="search" size={12} class="mission-ledger-search-icon" />
        <input
          type="search"
          class="mission-ledger-search-input"
          placeholder={t("mission.ledger.search_placeholder")}
          value={props.searchQuery}
          onInput={(e) => props.onSearchChange(e.currentTarget.value)}
          aria-label={t("mission.ledger.search_placeholder")}
          data-ui="mission-search"
        />
        <Show when={props.searchQuery}>
          <button
            type="button"
            class="mission-ledger-search-clear"
            aria-label={t("mission.ledger.search_clear")}
            title={t("mission.ledger.search_clear")}
            onClick={() => props.onSearchChange("")}
          >
            <Icon name="close" size={10} />
          </button>
        </Show>
      </div>

      <div class="mission-filter-bar" role="tablist" aria-label={t("mission.ledger.filter_label")}>
        <For each={FILTERS}>
          {(value) => (
            <button
              type="button"
              role="tab"
              class="mission-filter-button"
              data-active={props.filter === value ? "true" : undefined}
              aria-selected={props.filter === value}
              onClick={() => props.onFilterChange(value)}
            >
              {t(`mission.ledger.filter.${value}`)}
            </button>
          )}
        </For>
      </div>

      <Show when={props.tasksError}>
        <div class="mission-error" role="alert" data-ui="mission-tasks-error">
          <span>{t("mission.ledger.error_load_failed", { error: props.tasksError })}</span>
          <Button type="button" variant="outline" size="sm" tone="danger" onClick={props.onRetryLoad}>
            {t("mission.ledger.error_retry")}
          </Button>
        </div>
      </Show>

      <div class="mission-ledger-list">
        <TaskList
          items={props.tasks}
          showSearch={false}
          showError={false}
          emptyLabel={
            props.searchQuery || props.filter !== "all"
              ? t("mission.ledger.empty_filtered")
              : t("mission.ledger.empty")
          }
          onSelectTask={props.onSelectTask}
          onCancelTask={props.onCancelTask}
          onDeleteTask={props.onDeleteTask}
        />
      </div>
    </aside>
  )
}

function MissionWorkbench(props: {
  active: boolean
  composerOpen: boolean
  onCloseComposer: () => void
  hasSelection: boolean
  selectedSource: { kind: "task" | "session"; id: string } | null
  onOpenInPanel: () => void
  onCloseMission: () => void
  onMissionAwake: (result: { sessionID: string }) => void
}) {
  return (
    <section class="mission-workbench" id="missionWorkbench" data-ui="mission-workbench">
      <Show
        when={props.composerOpen}
        fallback={
          <Show when={props.active}>
            <Show
              when={props.selectedSource?.kind === "session"}
              fallback={
                <Show
                  when={props.hasSelection}
                  fallback={<MissionComposer onClose={props.onCloseComposer} onAwake={props.onMissionAwake} />}
                >
                  <MissionTaskConversation onOpenInPanel={props.onOpenInPanel} />
                </Show>
              }
            >
              <MissionConversation onClose={props.onCloseMission} />
            </Show>
          </Show>
        }
      >
        <MissionComposer onClose={props.onCloseComposer} onAwake={props.onMissionAwake} dismissible={true} />
      </Show>
    </section>
  )
}

function MissionTaskConversation(props: { onOpenInPanel: () => void }) {
  let conversationContainer!: HTMLDivElement
  return (
    <div class="mission-conversation" data-kind="task" data-ui="mission-task-conversation">
      <header class="mission-conversation-header oc-surface-header">
        <h2 class="mission-conversation-title oc-surface-header__title">{t("mission.workbench.task_conversation_title")}</h2>
        <div class="oc-surface-header__actions">
          <Button
            type="button"
            variant="ghost"
            size="md"
            tone="accent"
            data-ui="mission-workbench-open-panel"
            onClick={props.onOpenInPanel}
          >
            {t("mission.workbench.actions.open_in_panel")}
          </Button>
        </div>
      </header>
      <div class="mission-conversation-body chat-scroll" ref={conversationContainer}>
        <Conversation container={conversationContainer} />
      </div>
      <div class="mission-conversation-composer">
        <ChatComposer
          enabled={!!activeTaskID()}
          busy={false}
          onSubmit={async (text, attachments, webSearch) => {
            await submitMessage(text, attachments, {
              metadata: {
                source: "mission",
                ...(webSearch ? { web_search: true } : {}),
              },
            })
          }}
        />
      </div>
    </div>
  )
}

function MissionConversation(props: { onClose: () => void }) {
  let conversationContainer!: HTMLDivElement
  return (
    <div class="mission-conversation" data-kind="mission" data-ui="mission-conversation">
      <header class="mission-conversation-header oc-surface-header">
        <h2 class="mission-conversation-title oc-surface-header__title">{t("mission.launcher.conversation_title")}</h2>
        <div class="oc-surface-header__actions">
          <Button
            type="button"
            variant="ghost"
            size="md"
            tone="neutral"
            data-ui="mission-close"
            title={t("common.close")}
            onClick={props.onClose}
          >
            <Icon name="close" size={12} />
          </Button>
        </div>
      </header>
      <div class="mission-conversation-body chat-scroll" ref={conversationContainer}>
        <Conversation container={conversationContainer} />
      </div>
      <div class="mission-conversation-composer">
        <ChatComposer
          enabled={true}
          busy={false}
          onSubmit={async (text, attachments, webSearch) => {
            await submitMessage(text, attachments, {
              metadata: {
                source: "mission",
                ...(webSearch ? { web_search: true } : {}),
              },
            })
          }}
        />
      </div>
    </div>
  )
}

function MissionComposer(props: {
  onClose: () => void
  onAwake: (result: { missionID: string; sessionID: string; created: boolean }) => void
  dismissible?: boolean
}) {
  // ── Mission launcher — Mission agent wake surface ─────────────────────
  //
  // Single textarea + optional missionID input. Submitting POSTs to
  // /mission/wake which either starts a new mission session (no missionID)
  // or resumes an existing one (operator-typed missionID). Once wake returns,
  // the operator's goal is owned by the Mission agent — no proposal preview /
  // candidate selection here. See specs/gateway-mission-split-2026-05-28.md.
  const [text, setText] = createSignal("")
  const [missionID, setMissionID] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal("")
  const [lastResult, setLastResult] = createSignal<{ missionID: string; sessionID: string; created: boolean } | null>(null)

  let activeController: AbortController | null = null
  const cancelActive = (reason?: unknown): void => {
    if (!activeController) return
    activeController.abort(reason ?? new DOMException("Mission launcher dismissed", "AbortError"))
    activeController = null
  }
  onCleanup(() => cancelActive())

  async function handleSubmit() {
    const t = text().trim()
    if (!t) return
    setSubmitting(true)
    setError("")
    cancelActive()
    const controller = new AbortController()
    activeController = controller
    try {
      const result = await wakeMission({
        text: t,
        missionID: missionID().trim() || undefined,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setLastResult(result)
      setText("")
      props.onAwake(result)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(humanizeApiError(err))
      setLastResult(null)
    } finally {
      if (activeController === controller) activeController = null
      setSubmitting(false)
    }
  }

  function handleDiscard() {
    cancelActive()
    setText("")
    setMissionID("")
    setError("")
    setLastResult(null)
    props.onClose()
  }

  return (
    <div class="mission-composer" data-ui="mission-composer">
      <header class="mission-composer-header">
        <div class="mission-composer-title-block">
          <span class="mission-composer-kicker">{t("mission.title")}</span>
          <h2 class="mission-composer-title">{t("mission.launcher.title")}</h2>
        </div>
        <Show when={props.dismissible}>
          <Button
            type="button"
            variant="ghost"
            size="md"
            tone="neutral"
            data-ui="mission-composer-discard"
            title={t("mission.launcher.discard_title")}
            onClick={handleDiscard}
          >
            <Icon name="close" size={12} />
            <span>{t("mission.launcher.discard")}</span>
          </Button>
        </Show>
      </header>
      <div class="mission-composer-shell">
        <div class="mission-composer-input-head">
          <label class="mission-composer-input-label" for="missionText">
            {t("mission.launcher.title")}
          </label>
          <div class="mission-composer-counter" data-ui="mission-composer-counter">
            <span
              data-near-limit={text().length >= MISSION_REQUIREMENT_MAX_CHARS - 200 ? "true" : undefined}
              data-at-limit={text().length >= MISSION_REQUIREMENT_MAX_CHARS ? "true" : undefined}
            >
              {t("mission.launcher.length_counter", {
                count: String(text().length),
                max: String(MISSION_REQUIREMENT_MAX_CHARS),
              })}
            </span>
          </div>
        </div>
        <AutoGrowTextarea
          id="missionText"
          class="composer-textarea mission-composer-textarea"
          rows={10}
          maxLines={22}
          placeholder={t("mission.launcher.placeholder")}
          value={text()}
          maxLength={MISSION_REQUIREMENT_MAX_CHARS}
          onInput={(e) => setText(e.currentTarget.value)}
          disabled={submitting()}
          data-ui="mission-composer-input"
        />
        <div class="mission-composer-controls">
          <label class="mission-composer-mission-id">
            <span>{t("mission.launcher.mission_id_label")}</span>
            <input
              type="text"
              class="mission-composer-mission-id-input"
              placeholder={t("mission.launcher.mission_id_placeholder")}
              value={missionID()}
              disabled={submitting()}
              onInput={(e) => setMissionID(e.currentTarget.value)}
              data-ui="mission-composer-mission-id"
            />
          </label>
          <Button
            type="button"
            variant="solid"
            size="md"
            tone="accent"
            data-ui="mission-composer-submit"
            disabled={!text().trim() || submitting()}
            onClick={() => void handleSubmit()}
          >
            {submitting()
              ? t("mission.launcher.submitting")
              : missionID().trim()
                ? t("mission.launcher.resume")
                : t("mission.launcher.start")}
          </Button>
        </div>
      </div>
      <Show when={error()}>
        <div class="mission-error" role="alert" data-ui="mission-composer-error">
          <span>{t("mission.launcher.error", { error: error() })}</span>
        </div>
      </Show>
      <Show when={lastResult()}>
        {(result) => (
          <div class="mission-launcher-result" role="status" data-ui="mission-launcher-result">
            <p>
              {result().created
                ? t("mission.launcher.result_created", { missionID: result().missionID })
                : t("mission.launcher.result_resumed", { missionID: result().missionID })}
            </p>
            <p class="mission-launcher-result-session">
              <code>{result().sessionID}</code>
            </p>
          </div>
        )}
      </Show>
    </div>
  )
}

// ── Channel side panel (right column, Phase 4) ────────────────────────

function MissionChannelPanel(props: {
  channels: ChannelInfo[]
  channelsError: string
  runtime: ChannelRuntimeStatus | null | undefined
  runtimeError: string
  restartError: string
  bindings: any[]
  bindingsError: string
  selectedTaskID: string
  actionBusy: string
  onRestartRuntime: () => void
  onRefreshChannels: () => void
}) {
  const restarting = () => props.actionBusy === "restart:channel"
  return (
    <aside class="mission-channels" data-ui="mission-channels">
      <header class="mission-channels-header oc-surface-header">
        <h2 class="mission-channels-heading oc-surface-header__title">{t("mission.channels.heading")}</h2>
        <div class="oc-surface-header__actions">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-ui="mission-channels-refresh"
            title={t("mission.refresh_title")}
            onClick={props.onRefreshChannels}
          >
            <Icon name="refresh" size={12} />
          </Button>
        </div>
      </header>

      <section class="mission-channels-runtime" data-ui="mission-channels-runtime">
        <h3>{t("mission.channels.runtime_heading")}</h3>
        <Show when={props.runtimeError}>
          <div class="mission-error" role="alert">
            <span>{t("mission.error.channel_runtime_failed", { error: props.runtimeError })}</span>
          </div>
        </Show>
        <Show when={props.runtime}>
          <dl class="mission-channels-runtime-meta">
            <div>
              <dt>{t("mission.channels.runtime_status")}</dt>
              <dd data-status={props.runtime!.status}>{runtimeLabel(props.runtime!.status)}</dd>
            </div>
            <Show when={props.runtime!.detail}>
              <div>
                <dt>{t("mission.channels.runtime_detail")}</dt>
                <dd>{props.runtime!.detail}</dd>
              </div>
            </Show>
            <Show when={props.runtime!.channels.length > 0}>
              <div>
                <dt>{t("mission.channels.runtime_channels")}</dt>
                <dd>{props.runtime!.channels.join(", ")}</dd>
              </div>
            </Show>
          </dl>
        </Show>
        <Button
          type="button"
          variant="outline"
          size="sm"
          tone="neutral"
          data-ui="mission-channels-restart"
          disabled={restarting()}
          title={t("mission.channels.restart_title")}
          onClick={props.onRestartRuntime}
        >
          {restarting() ? t("mission.channels.restarting") : t("mission.channels.restart")}
        </Button>
        <Show when={props.restartError}>
          <div class="mission-error" role="alert" data-ui="mission-channels-restart-error">
            <span>{t("mission.error.restart_failed", { error: props.restartError })}</span>
          </div>
        </Show>
      </section>

      <section class="mission-channels-list" data-ui="mission-channels-list">
        <Show when={props.channelsError}>
          <div class="mission-error" role="alert">
            <span>{t("mission.error.channels_failed", { error: props.channelsError })}</span>
          </div>
        </Show>
        <Show
          when={props.channels.length > 0}
          fallback={
            <Show when={!props.channelsError}>
              <p class="mission-channels-empty">{t("mission.channels.empty")}</p>
            </Show>
          }
        >
          <ul class="mission-channels-rows">
            <For each={props.channels}>
              {(c) => (
                <li class="mission-channel-row" data-channel-id={c.id} data-status={c.status} data-runtime={c.runtime_status ?? "disabled"}>
                  <div class="mission-channel-row-head">
                    <span class="mission-channel-row-name">{c.name}</span>
                    <span class="mission-channel-row-status" data-status={c.status}>
                      {channelStatusLabel(c.status)}
                    </span>
                  </div>
                  <Show when={c.summary}>
                    <p class="mission-channel-row-summary">{c.summary}</p>
                  </Show>
                  <Show when={c.runtime_detail}>
                    <p class="mission-channel-row-detail">{c.runtime_detail}</p>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class="mission-channels-bindings" data-ui="mission-channels-bindings">
        <h3>{t("mission.channels.bindings_heading")}</h3>
        <Show when={props.bindingsError}>
          <div class="mission-error" role="alert">
            <span>{t("mission.workbench.bindings_load_failed", { error: props.bindingsError })}</span>
          </div>
        </Show>
        <Show
          when={props.selectedTaskID}
          fallback={<p class="mission-channels-empty">{t("mission.channels.bindings_empty_no_task")}</p>}
        >
          <Show
            when={props.bindings.length > 0}
            fallback={
              <Show when={!props.bindingsError}>
                <p class="mission-channels-empty">{t("mission.channels.bindings_empty")}</p>
              </Show>
            }
          >
            <ul class="mission-channels-binding-list">
              <For each={props.bindings}>
                {(b: any) => (
                  <li class="mission-channels-binding" data-binding-id={String(b?.id ?? "")}>
                    <Icon name="channel-link" size={12} />
                    <span><strong>{String(b?.platform ?? "")}</strong></span>
                    <span class="mission-channels-binding-channel">{String(b?.channel ?? "")}</span>
                    <span class="mission-channels-binding-thread">{String(b?.thread ?? "")}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </section>
    </aside>
  )
}

function channelStatusLabel(status: string): string {
  const value = t(`channel.status.${status}`)
  return value === `channel.status.${status}` ? status : value
}
