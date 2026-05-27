// ── Gateway ──
//
// Operator control room. A separate page (PRD §6.2) sitting beside the
// default conversation panel — switching modes uses the shared
// `pageMode` store (store/page-mode.ts) and does NOT clear or rewrite
// the panel's selected task.
//
// Layout (PRD §7):
//   header    : workspace, gateway health, channel runtime, counts, actions
//   ledger    : task list (project + global, filterable, queue-aware)
//   workbench : selected task summary + actions, OR mission launcher
//   channels  : channel catalog, runtime status, restart, selected-task
//               bindings
//
// Data sources (PRD §5 — single source of truth):
//   • boardStore.tasks          — task list from existing /global/tasks
//   • boardStore.board          — selected task detail
//   • GatewayStats              — gateway/stats endpoint (counts + project)
//   • Channel runtime + list    — existing channel routes
//   • /gateway/master/wake      — start or resume a mission supervisor
//                                 session (gateway-master agent)
//
// Errors are surfaced explicitly (PRD §14): no silent fallback, no
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
import { useArmedConfirm, type ArmedConfirm } from "../solid/armed-confirm"
import { boardStore, setBoardStore, isTaskInterruptable, isTaskTerminal, loadTasks, taskByID, visibleTasks,
  activeTaskID,
} from "../store/board"
import { clearMessages, setChatAttachments } from "../store/messages"
import { settingsStore, sanitizeExecutor } from "../store/settings"
import { isGatewayPage, setPageMode } from "../store/page-mode"
import {
  cancelTask,
  createTask,
  deleteTask,
  replanTask,
  retryTask,
  selectTask,
  submitMessage,
} from "../services/task"
import { reorderTaskQueue, startQueuedTaskNow } from "../services/task-queue"
import {
  loadChannelList,
  loadChannelRuntime,
  loadGatewayStats,
  loadTaskBindings,
  restartChannelRuntime,
  wakeMaster,
  type ChannelInfo,
  type ChannelRuntimeStatus,
  type GatewayStats,
} from "../services/gateway"
import { ApiError } from "../services/api"
import { loadConversation } from "../services/conversation"
import { startSSE, stopSSE } from "../services/sse"
import { resetWriter } from "../services/tree-writer"
import { t } from "../utils/i18n"
import { stamp } from "../utils/time"
import {
  compactDirectory,
  filterMatches,
  GATEWAY_REQUIREMENT_MAX_CHARS,
  humanizeApiError,
  pendingInteractions,
  runtimeLabel,
  statusIconFor,
  type LedgerFilter,
} from "../utils/gateway-helpers"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { ConversationAgentRail } from "./ConversationAgentRail"
import { Conversation } from "./Conversation"
import { ChatComposer } from "./ChatComposer"

// ── Status taxonomies ──
//
// PRD §9 distinguishes six operator-facing categories:
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
const INTERRUPTABLE_STATUSES = new Set(["queued", "active"])

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

// humanizeApiError now lives in utils/gateway-helpers.ts so the unit
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
// static analyser recognises `gateway.error.action.*` as referenced
// (script/check-panel-i18n.ts:76 — only literal template expressions
// inside t() are scanned; a `t(variable)` indirection is invisible to
// it and would flag the new locale entries as unused).
function actionVerbLabel(actionKey: string): string {
  const verb = String(actionKey || "").split(":", 1)[0] || actionKey
  const translated = t(`gateway.error.action.${verb}`)
  return translated === `gateway.error.action.${verb}` ? verb : translated
}

// Confirm window for armed-confirm destructive actions (cancel / delete).
// Mirrors the value used by TaskList's DeleteButton so the operator sees a
// consistent dwell time across panel and gateway (rule 8 single source).
const GATEWAY_CONFIRM_WINDOW_MS = 3000

// Gateway-scoped armed-confirm. The Gateway component stays mounted while
// the operator switches to Panel (CSS-driven page-mode toggle, no
// unmount), so the plain useArmedConfirm only disarms via 3s timeout or
// element blur — meaning a half-armed button can survive a quick
// Panel → … → Gateway round trip and commit on the next click. Wrapping
// the hook with a `createEffect` on `isGatewayPage()` disarms the moment
// the operator leaves Gateway, closing the round-3 design review's
// P1-1 escape hatch. The wrapper is the single source — every armed-
// confirm in this file goes through it so a future caller cannot
// accidentally use the bare hook and re-introduce the gap.
function useGatewayArmedConfirm(): ArmedConfirm {
  const confirm = useArmedConfirm(GATEWAY_CONFIRM_WINDOW_MS)
  createEffect(() => {
    if (!isGatewayPage()) confirm.disarm()
  })
  return confirm
}

function clip(value: string | undefined, limit = 80): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

function formatStamp(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "—"
  return stamp(ms)
}

// ── Top-level Gateway component ──

export function Gateway() {
  // ── Per-page state ─────────────────────────────────────────────────
  const [filter, setFilter] = createSignal<LedgerFilter>("all")
  const [searchQuery, setSearchQuery] = createSignal("")
  const [scope, setScope] = createSignal<"project" | "global">("global")
  const [composerOpen, setComposerOpen] = createSignal(false)
  const [actionBusy, setActionBusy] = createSignal<string>("")
  const [actionError, setActionError] = createSignal<{ action: string; error: string } | null>(null)
  const [messageDraft, setMessageDraft] = createSignal("")
  const [messageSending, setMessageSending] = createSignal(false)
  const [messageNotice, setMessageNotice] = createSignal<{ kind: "ok" | "error"; text: string } | null>(null)
  // Channel-restart errors get their own surface so they're visible
  // inside the channel side panel even when no task is selected and
  // the workbench-side actionError block isn't rendered (codex review:
  // P2 — restart errors were previously invisible from the composer or
  // empty-selection states).
  const [channelRestartError, setChannelRestartError] = createSignal<string>("")

  // ── Resources backed by gateway endpoints ──
  //
  // Every Gateway resource is project-scoped on the server, so it MUST
  // wait until `settingsStore.directory` is hydrated before firing —
  // otherwise the request lands without a `?directory=` query and the
  // server returns DirectoryRequiredError (visible to the operator as a
  // generic "Gateway 统计加载失败：API 400 …" banner). createResource's
  // source function gates the fetcher: returning a falsy value parks
  // the resource, and the call only fires once a real directory is in
  // place. The fetcher reads the same value so the URL also carries an
  // explicit `directory` parameter — belt-and-braces against any future
  // change to apiJson's auto-injection logic.

  // Resources fire only when (a) the Gateway page is the active mode AND
  // (b) `settingsStore.directory` is populated. (a) avoids wasted
  // server traffic from the always-mounted Gateway component while the
  // operator is using the Panel. (b) avoids DirectoryRequiredError on
  // project-scoped routes during cold boot before settings rehydrate.
  //
  // CRITICAL: read BOTH signals on every invocation so Solid tracks them
  // both, regardless of which branch produces the return value. A naive
  // `if (!isGatewayPage()) return null` short-circuit would skip the
  // directory read, so a later directory-set wouldn't re-trigger the
  // resource. Reading both up front avoids that reactivity hole.
  const gatewayDirectory = (): string | null => {
    const onGatewayPage = isGatewayPage()
    const dir = settingsStore.directory
    if (!onGatewayPage) return null
    return dir ? dir : null
  }

  const [stats, statsCtl] = createResource(
    gatewayDirectory,
    async (directory: string) => {
      try {
        return await loadGatewayStats({ directory })
      } catch (err) {
        throw new Error(errorMessage(err))
      }
    },
  )

  const [channels, channelsCtl] = createResource(
    gatewayDirectory,
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
    gatewayDirectory,
    async () => {
      try {
        return await loadChannelRuntime()
      } catch (err) {
        throw new Error(errorMessage(err))
      }
    },
  )

  // Bindings belong to Gateway's channel panel. The component stays
  // mounted while the conversation panel is active, so park this resource
  // outside Gateway mode instead of doing hidden selected-task work.
  const [bindings, bindingsCtl] = createResource(
    () => {
      const onGatewayPage = isGatewayPage()
      const taskID = activeTaskID()
      return onGatewayPage && taskID ? taskID : null
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
    // happened — Gateway can be the operator's first port of call after
    // app launch, and they need to see tasks immediately.
    if (!boardStore.tasksLoaded && !boardStore.tasksError) {
      void loadTasks().catch(() => undefined)
    }
  })

  // ── Derived task views ─────────────────────────────────────────────

  const activeDirectory = () => settingsStore.directory || ""
  const gatewayTasks = createMemo(() => (isGatewayPage() ? visibleTasks() : []))

  const filteredTasks = createMemo(() => {
    const list = gatewayTasks()
    const q = searchQuery().trim().toLowerCase()
    const f = filter()
    const s = scope()
    const dir = activeDirectory()
    return list.filter((item: any) => {
      const status = String(item?.task?.status ?? "idle")
      // Pass `item` so filterMatches can read pending_interactions — without
      // it, the "waiting" filter never matches and the "active" filter
      // wrongly includes tasks that have pending operator interactions
      // (PRD §9 strict status taxonomy). The helper unit test in
      // gateway-helpers.test.ts already exercises this signature; the bug
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

  // Single source for directory→queued-task ordering — sorted by the
  // backend's `task.queue.order` so the displayed `#n` badges and the
  // up/down move buttons agree about what "next" means after a reorder
  // (codex review: P3 — pre-fix, position came from creation-sorted
  // visibleTasks() and drifted away from the actual queue order).
  const queuedItemsByDir = createMemo(() => {
    const map = new Map<string, any[]>()
    for (const item of gatewayTasks()) {
      if (item?.task?.status !== "queued" || item?._pending) continue
      const dir = String(item?.task?.directory ?? "")
      if (!dir) continue
      const list = map.get(dir) ?? []
      list.push(item)
      map.set(dir, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ao = Number(a?.task?.queue?.order ?? Number.MAX_SAFE_INTEGER)
        const bo = Number(b?.task?.queue?.order ?? Number.MAX_SAFE_INTEGER)
        if (ao !== bo) return ao - bo
        return Number(a?.task?.time?.created ?? 0) - Number(b?.task?.time?.created ?? 0)
      })
    }
    return map
  })

  const queuePosition = (item: any): number | undefined => {
    const dir = String(item?.task?.directory ?? "")
    if (!dir) return undefined
    const list = queuedItemsByDir().get(dir)
    if (!list) return undefined
    const id = String(item?.task?.id ?? "")
    const idx = list.findIndex((it: any) => it?.task?.id === id)
    return idx >= 0 ? idx + 1 : undefined
  }
  const canMoveUp = (item: any): boolean => {
    const dir = String(item?.task?.directory ?? "")
    if (!dir) return false
    const list = queuedItemsByDir().get(dir)
    if (!list || list.length < 2) return false
    return list.findIndex((it) => it?.task?.id === item?.task?.id) > 0
  }
  const canMoveDown = (item: any): boolean => {
    const dir = String(item?.task?.directory ?? "")
    if (!dir) return false
    const list = queuedItemsByDir().get(dir)
    if (!list || list.length < 2) return false
    const idx = list.findIndex((it) => it?.task?.id === item?.task?.id)
    return idx >= 0 && idx < list.length - 1
  }
  async function moveQueuedTask(item: any, direction: -1 | 1): Promise<void> {
    const dir = String(item?.task?.directory ?? "")
    if (!dir) return
    const list = queuedItemsByDir().get(dir) ?? []
    const ids = list.map((it: any) => String(it?.task?.id ?? "")).filter(Boolean)
    const sourceID = String(item?.task?.id ?? "")
    const idx = ids.indexOf(sourceID)
    if (idx < 0) return
    const targetIdx = idx + direction
    if (targetIdx < 0 || targetIdx >= ids.length) return
    const next = [...ids]
    next.splice(idx, 1)
    next.splice(targetIdx, 0, sourceID)
    const revision = (() => {
      for (const it of list) {
        const rev = it?.task?.queue?.revision
        if (typeof rev === "string") return rev
      }
      return undefined
    })()
    await withBusy(`reorder:${sourceID}`, async () => {
      await reorderTaskQueue({ directory: dir, orderedTaskIDs: next, revision })
      await loadTasks()
    })
  }

  async function handleStartQueuedTask(item: any): Promise<void> {
    const taskID = String(item?.task?.id ?? "")
    if (!taskID) return
    await withBusy(`start:${taskID}`, async () => {
      await startQueuedTaskNow(taskID)
      await loadTasks()
    })
  }

  const counts = createMemo(() => {
    const list = gatewayTasks()
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
  // detail surface immediately. The `/task/:id/board` fetch can land
  // later and the per-task summary/goals/interactions sections will
  // populate when it does. Pre-fix this required BOTH selectedTaskID
  // AND a fully-loaded board, so a slow board fetch left the workbench
  // stuck on the empty placeholder even though the row was selected —
  // the visual loop captured this regression in screenshot 03 (round-2
  // P0-1). GatewaySelectedTask already reads task/* fields from item
  // when board is null, so the partial render is correct, not a fallback.
  const hasSelection = () =>
    !!activeTaskID() && (!!selectedItem() || !!selectedBoard())

  // ── Refresh / actions ──────────────────────────────────────────────

  async function refreshAll(): Promise<void> {
    setMessageNotice(null)
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
  async function handleRetryTask(taskID: string): Promise<void> {
    await withBusy(`retry:${taskID}`, async () => {
      await retryTask(taskID)
      await loadTasks()
    })
  }
  async function handleReplanTask(taskID: string): Promise<void> {
    await withBusy(`replan:${taskID}`, async () => {
      await replanTask(taskID)
      await loadTasks()
    })
  }
  async function handleDeleteTask(taskID: string): Promise<void> {
    await withBusy(`delete:${taskID}`, async () => {
      const ok = await deleteTask(taskID)
      if (!ok) throw new Error("delete task: server rejected the request")
    })
  }
  async function handleSendMessage(): Promise<void> {
    const taskID = activeTaskID()
    if (!taskID) return
    const text = messageDraft().trim()
    if (!text) return
    setMessageSending(true)
    setMessageNotice(null)
    try {
      // Force the stream onto the selected task: submitMessage reads
      // activeTaskID() for the destination so a panel-side
      // selection swap mid-await would mis-route. Selection guard is
      // upstream — submitMessage rejects if the route is wrong.
      await submitMessage(text, [], { metadata: { source: "gateway" } })
      setMessageDraft("")
      setMessageNotice({ kind: "ok", text: t("gateway.workbench.message_sent") })
    } catch (err) {
      setMessageNotice({
        kind: "error",
        text: t("gateway.workbench.error_message_failed", { error: humanizeApiError(err) }),
      })
    } finally {
      setMessageSending(false)
    }
  }

  function handleOpenInPanel(): void {
    setPageMode("panel")
  }

  async function handleMissionAwake(result: { sessionID: string }): Promise<void> {
    const source = { kind: "session" as const, id: result.sessionID }
    stopSSE()
    clearMessages()
    setChatAttachments([])
    resetWriter({ scrollIntent: "bottom", cause: "gateway-session-switch" })
    setBoardStore("selectedSource", source)
    await loadConversation(source, {
      scrollIntent: "bottom",
      resetCause: "gateway-session-hydrate",
    })
    startSSE(source, 0)
    setComposerOpen(false)
  }

  function handleCloseMission(): void {
    if (boardStore.selectedSource?.kind !== "session") return
    stopSSE()
    clearMessages()
    setChatAttachments([])
    resetWriter({ scrollIntent: "bottom", cause: "gateway-session-close" })
    setBoardStore("selectedSource", null)
    setBoardStore("board", null)
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div class="gateway" data-ui="gateway-page">
      <Show when={isGatewayPage()}>
        <GatewayHeader
          stats={stats()}
          statsError={stats.error ? humanizeApiError(stats.error) : ""}
          runtime={runtime()}
          runtimeError={runtime.error ? humanizeApiError(runtime.error) : ""}
          counts={counts()}
          directory={activeDirectory()}
          refreshing={stats.loading || runtime.loading || channels.loading}
          composerOpen={composerOpen()}
          onRefresh={() => void refreshAll()}
          onCompose={() => setComposerOpen(true)}
        />
      </Show>

      <Show when={isGatewayPage() && actionError()}>
        <div class="gateway-action-error" role="alert" data-ui="gateway-global-action-error">
          <span>
            {t("gateway.workbench.error_action_failed", {
              action: actionVerbLabel(actionError()!.action),
              error: actionError()!.error,
            })}
          </span>
          <button
            type="button"
            class="gateway-action-error-dismiss"
            aria-label={t("common.clear")}
            onClick={() => setActionError(null)}
          >
            <Icon name="close" size={10} />
          </button>
        </div>
      </Show>

      <div class="gateway-body">
        <Show when={isGatewayPage()}>
          <GatewayTaskLedger
            tasks={filteredTasks()}
            selectedTaskID={activeTaskID()}
            filter={filter()}
            onFilterChange={setFilter}
            scope={scope()}
            onScopeChange={setScope}
            searchQuery={searchQuery()}
            onSearchChange={setSearchQuery}
            tasksError={boardStore.tasksError}
            tasksLoaded={boardStore.tasksLoaded}
            actionBusy={actionBusy()}
            queuePosition={queuePosition}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveTask={(item, direction) => void moveQueuedTask(item, direction)}
            onStartTask={(item) => void handleStartQueuedTask(item)}
            onSelectTask={(id) => {
              setMessageNotice(null)
              void selectTask(id)
            }}
            onCancelTask={(id) => void handleCancelTask(id)}
            onRetryTask={(id) => void handleRetryTask(id)}
            onDeleteTask={(id) => void handleDeleteTask(id)}
            onRetryLoad={() => void loadTasks().catch(() => undefined)}
          />
        </Show>

        <GatewayWorkbench
          active={isGatewayPage()}
          composerOpen={composerOpen()}
          onCloseComposer={() => setComposerOpen(false)}
          hasSelection={hasSelection()}
          selectedItem={selectedItem()}
          board={selectedBoard()}
          messageDraft={messageDraft()}
          onMessageDraftChange={setMessageDraft}
          messageSending={messageSending()}
          messageNotice={messageNotice()}
          actionBusy={actionBusy()}
          actionError={actionError()}
          selectedSource={boardStore.selectedSource}
          onSendMessage={() => void handleSendMessage()}
          onCancelTask={(id) => void handleCancelTask(id)}
          onRetryTask={(id) => void handleRetryTask(id)}
          onReplanTask={(id) => void handleReplanTask(id)}
          onOpenInPanel={handleOpenInPanel}
          onCloseMission={handleCloseMission}
          onMissionAwake={(result) => void handleMissionAwake(result)}
        />

        <Show when={isGatewayPage()}>
          <GatewayChannelPanel
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

function GatewayHeader(props: {
  stats: GatewayStats | null | undefined
  statsError: string
  runtime: ChannelRuntimeStatus | null | undefined
  runtimeError: string
  counts: { active: number; queued: number; waiting: number; failed: number; completed: number; cancelled: number; total: number }
  directory: string
  refreshing: boolean
  composerOpen: boolean
  onRefresh: () => void
  onCompose: () => void
}) {
  const runtimeStatusLabel = () => {
    const r = props.runtime
    if (!r) return t("gateway.runtime.disabled")
    return runtimeLabel(r.status)
  }
  const healthStatus = () => {
    if (props.statsError) return "error"
    if (!props.stats) return "unknown"
    return "healthy"
  }
  return (
    <header class="gateway-header" data-ui="gateway-header">
      <div class="gateway-header-row gateway-header-row--meta">
        <div class="gateway-header-cluster">
          <span class="gateway-header-eyebrow">{t("gateway.title")}</span>
          <span class="gateway-header-subtitle">{t("gateway.subtitle")}</span>
        </div>
        <div class="gateway-header-actions" role="toolbar" aria-label={t("gateway.title")}>
          <Button
            type="button"
            variant="solid"
            size="md"
            tone="accent"
            data-ui="gateway-new-requirement"
            disabled={props.composerOpen}
            title={t("gateway.new_requirement_title")}
            onClick={props.onCompose}
          >
            <Icon name="plus" size={12} />
            <span>{t("gateway.new_requirement")}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            tone="neutral"
            data-ui="gateway-refresh"
            disabled={props.refreshing}
            title={t("gateway.refresh_title")}
            onClick={props.onRefresh}
          >
            <Icon name="refresh" size={12} />
            <span>{props.refreshing ? t("gateway.refreshing") : t("gateway.refresh")}</span>
          </Button>
          {/* Page-mode toggle lives in the titlebar Gateway button now —
              one button, one stable position across both modes. The
              in-page back affordance was removed because keeping two
              navigation surfaces meant the operator's eye had to relearn
              the toggle position when crossing pages. */}
        </div>
      </div>
      <div class="gateway-header-row gateway-header-row--stats">
        <span class="gateway-stat" data-stat="workspace" title={props.directory || ""}>
          <span class="gateway-stat-label">{t("gateway.workspace_label")}</span>
          <span class="gateway-stat-value">{compactDirectory(props.directory) || "—"}</span>
        </span>
        <span class="gateway-stat" data-stat="health" data-status={healthStatus()}>
          <span class="gateway-stat-label">{t("gateway.health_label")}</span>
          <span class="gateway-stat-value">
            {props.statsError
              ? t("gateway.health.error")
              : props.stats
                ? t("gateway.health.healthy")
                : t("gateway.health.unknown")}
          </span>
        </span>
        <span class="gateway-stat" data-stat="runtime" data-status={props.runtime?.status ?? "disabled"}>
          <span class="gateway-stat-label">{t("gateway.runtime_label")}</span>
          <span class="gateway-stat-value">
            {props.runtimeError ? t("gateway.runtime.error") : runtimeStatusLabel()}
          </span>
        </span>
        <span class="gateway-stat" data-stat="counts">
          <span class="gateway-stat-label">{t("gateway.counts.total", { count: String(props.counts.total) })}</span>
          <span class="gateway-stat-value">
            <span class="gateway-count" data-status="active">
              {t("gateway.counts.active", { count: String(props.counts.active) })}
            </span>
            <span class="gateway-count" data-status="queued">
              {t("gateway.counts.queued", { count: String(props.counts.queued) })}
            </span>
            <span class="gateway-count" data-status="waiting">
              {t("gateway.counts.waiting", { count: String(props.counts.waiting) })}
            </span>
            <span class="gateway-count" data-status="failed">
              {t("gateway.counts.failed", { count: String(props.counts.failed) })}
            </span>
            <span class="gateway-count" data-status="completed">
              {t("gateway.counts.completed", { count: String(props.counts.completed) })}
            </span>
            <span class="gateway-count" data-status="cancelled">
              {t("gateway.counts.cancelled", { count: String(props.counts.cancelled) })}
            </span>
          </span>
        </span>
      </div>
      <Show when={props.statsError}>
        <div class="gateway-error" role="alert" data-ui="gateway-stats-error">
          <Icon name="status-failed" size={12} />
          <span>{t("gateway.error.stats_failed", { error: props.statsError })}</span>
        </div>
      </Show>
    </header>
  )
}

// ── Task ledger (left column) ─────────────────────────────────────────

function GatewayTaskLedger(props: {
  tasks: any[]
  selectedTaskID: string
  filter: LedgerFilter
  onFilterChange: (next: LedgerFilter) => void
  scope: "project" | "global"
  onScopeChange: (next: "project" | "global") => void
  searchQuery: string
  onSearchChange: (next: string) => void
  tasksError: string
  tasksLoaded: boolean
  actionBusy: string
  queuePosition: (item: any) => number | undefined
  canMoveUp: (item: any) => boolean
  canMoveDown: (item: any) => boolean
  onMoveTask: (item: any, direction: -1 | 1) => void
  onStartTask: (item: any) => void
  onSelectTask: (id: string) => void
  onCancelTask: (id: string) => void
  onRetryTask: (id: string) => void
  onDeleteTask: (id: string) => void
  onRetryLoad: () => void
}) {
  // Filter order matches PRD §9: queued → active → waiting → failed →
  // completed → cancelled → all. "All" lives at the end as the escape
  // hatch when the operator wants to see everything regardless of state.
  const FILTERS: LedgerFilter[] = ["queued", "active", "waiting", "failed", "completed", "cancelled", "all"]
  return (
    <aside class="gateway-ledger" data-ui="gateway-ledger">
      <header class="gateway-ledger-header">
        <span class="gateway-ledger-title">{t("gateway.ledger.title")}</span>
        <div class="gateway-scope-toggle" role="tablist" aria-label={t("gateway.ledger.title")}>
          <button
            type="button"
            class="gateway-scope-button"
            role="tab"
            aria-selected={props.scope === "project"}
            data-active={props.scope === "project" ? "true" : undefined}
            onClick={() => props.onScopeChange("project")}
          >
            {t("gateway.ledger.scope.project")}
          </button>
          <button
            type="button"
            class="gateway-scope-button"
            role="tab"
            aria-selected={props.scope === "global"}
            data-active={props.scope === "global" ? "true" : undefined}
            onClick={() => props.onScopeChange("global")}
          >
            {t("gateway.ledger.scope.global")}
          </button>
        </div>
      </header>

      <div class="gateway-ledger-search">
        <Icon name="search" size={12} class="gateway-ledger-search-icon" />
        <input
          type="search"
          class="gateway-ledger-search-input"
          placeholder={t("gateway.ledger.search_placeholder")}
          value={props.searchQuery}
          onInput={(e) => props.onSearchChange(e.currentTarget.value)}
          aria-label={t("gateway.ledger.search_placeholder")}
          data-ui="gateway-search"
        />
        <Show when={props.searchQuery}>
          <button
            type="button"
            class="gateway-ledger-search-clear"
            aria-label={t("gateway.ledger.search_clear")}
            title={t("gateway.ledger.search_clear")}
            onClick={() => props.onSearchChange("")}
          >
            <Icon name="close" size={10} />
          </button>
        </Show>
      </div>

      <div class="gateway-filter-bar" role="tablist" aria-label={t("gateway.ledger.filter_label")}>
        <For each={FILTERS}>
          {(value) => (
            <button
              type="button"
              role="tab"
              class="gateway-filter-button"
              data-active={props.filter === value ? "true" : undefined}
              aria-selected={props.filter === value}
              onClick={() => props.onFilterChange(value)}
            >
              {t(`gateway.ledger.filter.${value}`)}
            </button>
          )}
        </For>
      </div>

      <Show when={props.tasksError}>
        <div class="gateway-error" role="alert" data-ui="gateway-tasks-error">
          <span>{t("gateway.ledger.error_load_failed", { error: props.tasksError })}</span>
          <Button type="button" variant="outline" size="sm" tone="danger" onClick={props.onRetryLoad}>
            {t("gateway.ledger.error_retry")}
          </Button>
        </div>
      </Show>

      <div class="gateway-ledger-list" role="list">
        <Show
          when={props.tasks.length > 0}
          fallback={
            <Show when={!props.tasksError}>
              <Show
                when={props.tasksLoaded}
                fallback={
                  <div class="gateway-ledger-skeleton" aria-hidden="true">
                    <div class="gateway-ledger-skeleton-row" />
                    <div class="gateway-ledger-skeleton-row" />
                    <div class="gateway-ledger-skeleton-row" />
                  </div>
                }
              >
                <div class="gateway-ledger-empty">
                  {props.searchQuery || props.filter !== "all"
                    ? t("gateway.ledger.empty_filtered")
                    : t("gateway.ledger.empty")}
                </div>
              </Show>
            </Show>
          }
        >
          <For each={props.tasks}>
            {(item) => (
              <GatewayLedgerRow
                item={item}
                selected={props.selectedTaskID === item?.task?.id}
                queuePos={props.queuePosition(item)}
                canMoveUp={props.canMoveUp(item)}
                canMoveDown={props.canMoveDown(item)}
                onMoveUp={() => props.onMoveTask(item, -1)}
                onMoveDown={() => props.onMoveTask(item, 1)}
                onStartNow={() => props.onStartTask(item)}
                actionBusy={props.actionBusy}
                onSelectTask={props.onSelectTask}
                onCancelTask={props.onCancelTask}
                onRetryTask={props.onRetryTask}
                onDeleteTask={props.onDeleteTask}
              />
            )}
          </For>
        </Show>
      </div>
    </aside>
  )
}

function GatewayLedgerRow(props: {
  item: any
  selected: boolean
  queuePos?: number
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onStartNow: () => void
  actionBusy: string
  onSelectTask: (id: string) => void
  onCancelTask: (id: string) => void
  onRetryTask: (id: string) => void
  onDeleteTask: (id: string) => void
}) {
  const id = () => String(props.item?.task?.id ?? "")
  const status = () => String(props.item?.task?.status ?? "idle")
  const title = () => clip(props.item?.task?.title || props.item?.overview?.headline || id(), 80)
  const directory = () => compactDirectory(String(props.item?.task?.directory ?? ""))
  const updatedAt = () =>
    Number(props.item?.updated_at ?? props.item?.task?.time?.updated ?? props.item?.task?.time?.created ?? 0)
  const canCancel = () => INTERRUPTABLE_STATUSES.has(status())
  const canStartNow = () => status() === "queued"
  const canRetry = () => status() === "failed" || status() === "completed" || status() === "cancelled"
  const canDelete = () => !INTERRUPTABLE_STATUSES.has(status())
  const isBusy = (key: string) => props.actionBusy === `${key}:${id()}`
  // Destructive actions in the ledger row are gated by armed-confirm so a
  // single misclick can't lose work — the panel's DeleteButton uses the
  // same hook, so the operator sees one consistent two-step pattern
  // across surfaces (rule 8 single source).
  //
  // retry is included on the same footing as cancel/delete because for
  // a task that has already produced artifacts (failed / completed /
  // cancelled), pushing it through the executor again can overwrite
  // those artifacts — round-2 design review P0-1.
  const confirmCancel = useGatewayArmedConfirm()
  const confirmDelete = useGatewayArmedConfirm()
  const confirmLedgerRetry = useGatewayArmedConfirm()
  return (
    <div
      class="gateway-ledger-row"
      role="listitem"
      data-active={props.selected ? "true" : undefined}
      data-status={status()}
      data-task-id={id()}
    >
      <button
        type="button"
        class="gateway-ledger-row-main"
        onClick={() => props.onSelectTask(id())}
        title={title()}
        aria-current={props.selected ? "page" : undefined}
        data-ui="gateway-ledger-select"
      >
        <Icon name={statusIconFor(status())} size={12} class="gateway-ledger-row-status-icon" />
        <span class="gateway-ledger-row-text">
          <span class="gateway-ledger-row-title">{title()}</span>
          <span class="gateway-ledger-row-meta">
            <span class="gateway-ledger-row-status" data-status={status()}>
              {t(`task.status.${status()}`) === `task.status.${status()}`
                ? status()
                : t(`task.status.${status()}`)}
            </span>
            <Show when={typeof props.queuePos === "number" && status() === "queued"}>
              <span class="gateway-ledger-row-queue-pos">
                {t("gateway.ledger.queue_pos", { n: String(props.queuePos) })}
              </span>
            </Show>
            <Show when={directory()}>
              <span class="gateway-ledger-row-dir">{directory()}</span>
            </Show>
            <Show when={updatedAt() > 0}>
              <span class="gateway-ledger-row-stamp">{formatStamp(updatedAt())}</span>
            </Show>
          </span>
        </span>
      </button>
      <div class="gateway-ledger-row-actions">
        <Show when={props.canMoveUp}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-ui="gateway-ledger-move-up"
            data-task-id={id()}
            disabled={props.actionBusy === `reorder:${id()}`}
            title={t("gateway.ledger.action.move_up")}
            aria-label={t("gateway.ledger.action.move_up")}
            onClick={(e) => {
              e.stopPropagation()
              props.onMoveUp()
            }}
          >
            <Icon name="chevron-up" size={11} />
          </Button>
        </Show>
        <Show when={props.canMoveDown}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-ui="gateway-ledger-move-down"
            data-task-id={id()}
            disabled={props.actionBusy === `reorder:${id()}`}
            title={t("gateway.ledger.action.move_down")}
            aria-label={t("gateway.ledger.action.move_down")}
            onClick={(e) => {
              e.stopPropagation()
              props.onMoveDown()
            }}
          >
            <Icon name="chevron-down" size={11} />
          </Button>
        </Show>
        <Show when={canStartNow()}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="accent"
            data-ui="gateway-ledger-start-now"
            data-task-id={id()}
            disabled={isBusy("start")}
            title={t("gateway.ledger.action.start_now")}
            aria-label={t("gateway.ledger.action.start_now")}
            onClick={(e) => {
              e.stopPropagation()
              props.onStartNow()
            }}
          >
            <Icon name="send" size={11} />
          </Button>
        </Show>
        <Show when={canCancel()}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-ui="gateway-ledger-cancel"
            data-confirm={confirmCancel.armed() ? "true" : undefined}
            disabled={isBusy("cancel")}
            title={confirmCancel.armed()
              ? t("gateway.ledger.action.cancel_confirm")
              : t("gateway.ledger.action.cancel")}
            aria-label={confirmCancel.armed()
              ? t("gateway.ledger.action.cancel_confirm")
              : t("gateway.ledger.action.cancel")}
            onClick={(e) => {
              e.stopPropagation()
              confirmCancel.confirm(() => props.onCancelTask(id()))
            }}
            onBlur={confirmCancel.disarm}
          >
            <Icon name={confirmCancel.armed() ? "check" : "stop"} size={11} />
          </Button>
        </Show>
        <Show when={canRetry()}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-ui="gateway-ledger-retry"
            data-confirm={confirmLedgerRetry.armed() ? "true" : undefined}
            disabled={isBusy("retry")}
            title={confirmLedgerRetry.armed()
              ? t("gateway.ledger.action.retry_confirm")
              : t("gateway.ledger.action.retry")}
            aria-label={confirmLedgerRetry.armed()
              ? t("gateway.ledger.action.retry_confirm")
              : t("gateway.ledger.action.retry")}
            onClick={(e) => {
              e.stopPropagation()
              confirmLedgerRetry.confirm(() => props.onRetryTask(id()))
            }}
            onBlur={confirmLedgerRetry.disarm}
          >
            <Icon name={confirmLedgerRetry.armed() ? "check" : "refresh"} size={11} />
          </Button>
        </Show>
        <Show when={canDelete()}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="danger"
            data-ui="gateway-ledger-delete"
            data-confirm={confirmDelete.armed() ? "true" : undefined}
            disabled={isBusy("delete")}
            title={confirmDelete.armed()
              ? t("gateway.ledger.action.delete_confirm")
              : t("gateway.ledger.action.delete")}
            aria-label={confirmDelete.armed()
              ? t("gateway.ledger.action.delete_confirm")
              : t("gateway.ledger.action.delete")}
            onClick={(e) => {
              e.stopPropagation()
              confirmDelete.confirm(() => props.onDeleteTask(id()))
            }}
            onBlur={confirmDelete.disarm}
          >
            <Icon name={confirmDelete.armed() ? "check" : "close"} size={11} />
          </Button>
        </Show>
      </div>
    </div>
  )
}

// ── Workbench (center column) ─────────────────────────────────────────

function GatewayWorkbench(props: {
  active: boolean
  composerOpen: boolean
  onCloseComposer: () => void
  hasSelection: boolean
  selectedItem: any
  board: any
  messageDraft: string
  onMessageDraftChange: (next: string) => void
  messageSending: boolean
  messageNotice: { kind: "ok" | "error"; text: string } | null
  actionBusy: string
  actionError: { action: string; error: string } | null
  selectedSource: { kind: "task" | "session"; id: string } | null
  onSendMessage: () => void
  onCancelTask: (id: string) => void
  onRetryTask: (id: string) => void
  onReplanTask: (id: string) => void
  onOpenInPanel: () => void
  onCloseMission: () => void
  onMissionAwake: (result: { sessionID: string }) => void
}) {
  return (
    <section class="gateway-workbench" data-ui="gateway-workbench">
      <Show
        when={props.composerOpen}
        fallback={
          <Show when={props.active}>
            <Show when={props.selectedSource?.kind === "session"} fallback={
              <Show
                when={props.hasSelection}
                fallback={<GatewayEmptyWorkbench />}
              >
                <GatewaySelectedTask
                  item={props.selectedItem}
                  board={props.board}
                  messageDraft={props.messageDraft}
                  onMessageDraftChange={props.onMessageDraftChange}
                  messageSending={props.messageSending}
                  messageNotice={props.messageNotice}
                  actionBusy={props.actionBusy}
                  actionError={props.actionError}
                  onSendMessage={props.onSendMessage}
                  onCancelTask={props.onCancelTask}
                  onRetryTask={props.onRetryTask}
                  onReplanTask={props.onReplanTask}
                  onOpenInPanel={props.onOpenInPanel}
                />
              </Show>
            }>
              <GatewayMissionConversation onClose={props.onCloseMission} />
            </Show>
          </Show>
        }
      >
        <GatewayComposer onClose={props.onCloseComposer} onAwake={props.onMissionAwake} />
      </Show>
    </section>
  )
}

function GatewayEmptyWorkbench() {
  return (
    <div class="gateway-workbench-empty" data-ui="gateway-workbench-empty">
      <Icon name="gateway" size={28} class="gateway-workbench-empty-icon" />
      <h2 class="gateway-workbench-empty-title">{t("gateway.workbench.no_selection_title")}</h2>
      <p class="gateway-workbench-empty-body">{t("gateway.workbench.no_selection_body")}</p>
    </div>
  )
}

function GatewayMissionConversation(props: { onClose: () => void }) {
  let conversationContainer!: HTMLDivElement
  return (
    <div class="gateway-mission-conversation" data-ui="gateway-mission-conversation">
      <header class="gateway-mission-conversation-header">
        <h2 class="gateway-mission-conversation-title">{t("gateway.master.conversation_title")}</h2>
        <Button
          type="button"
          variant="ghost"
          size="md"
          tone="neutral"
          data-ui="gateway-mission-close"
          title={t("common.close")}
          onClick={props.onClose}
        >
          <Icon name="close" size={12} />
        </Button>
      </header>
      <div class="gateway-mission-conversation-body" ref={conversationContainer}>
        <Conversation container={conversationContainer} />
      </div>
      <div class="gateway-mission-conversation-composer">
        <ChatComposer
          enabled={true}
          busy={false}
          onSubmit={async (text, attachments) => {
            await submitMessage(text, attachments, { metadata: { source: "gateway" } })
          }}
        />
      </div>
    </div>
  )
}

function GatewaySelectedTask(props: {
  item: any
  board: any
  messageDraft: string
  onMessageDraftChange: (next: string) => void
  messageSending: boolean
  messageNotice: { kind: "ok" | "error"; text: string } | null
  actionBusy: string
  actionError: { action: string; error: string } | null
  onSendMessage: () => void
  onCancelTask: (id: string) => void
  onRetryTask: (id: string) => void
  onReplanTask: (id: string) => void
  onOpenInPanel: () => void
}) {
  const task = () => props.board?.task ?? props.item?.task ?? {}
  const id = () => String(task()?.id ?? "")
  const status = () => String(task()?.status ?? "idle")
  const directory = () => String(task()?.directory ?? "")
  const executor = () => String(task()?.executor ?? "")
  const priority = () => String(task()?.priority ?? "")
  const created = () => Number(task()?.time?.created ?? 0)
  const updated = () => Number(task()?.time?.updated ?? 0)
  const goals = () => {
    const list = props.board?.goalWorkflows ?? props.board?.goals ?? []
    return Array.isArray(list) ? list : []
  }
  const interactions = () => {
    const list = props.board?.interactions ?? []
    return Array.isArray(list) ? list.filter((it: any) => it?.status === "pending") : []
  }
  const summary = () => {
    return String(props.board?.overview?.headline ?? props.item?.overview?.headline ?? "").trim()
  }
  const isBusy = (key: string) => props.actionBusy === `${key}:${id()}`
  const messageBusy = () => props.messageSending || isBusy("cancel") || isBusy("retry") || isBusy("replan")
  // Wide "Cancel task" button mirrors the ledger row's armed-confirm so a
  // misclick on the workbench doesn't kill a running task without warning.
  // retry / replan use the same gating: replan re-runs the architect agent
  // (the most expensive LLM call in the system, PRD §11) and retry
  // re-executes a finished task on top of its existing artifacts. Both are
  // destructive enough to warrant the same two-step affordance as cancel.
  const confirmWorkbenchCancel = useGatewayArmedConfirm()
  const confirmWorkbenchRetry = useGatewayArmedConfirm()
  const confirmWorkbenchReplan = useGatewayArmedConfirm()

  return (
    <div class="gateway-workbench-detail">
      <header class="gateway-workbench-header">
        <div class="gateway-workbench-title-row">
          <Icon name={statusIconFor(status())} size={14} />
          <h2 class="gateway-workbench-title">{clip(task()?.title || id(), 120)}</h2>
        </div>
        <dl class="gateway-workbench-meta">
          <div class="gateway-workbench-meta-row">
            <dt>{t("gateway.workbench.task_id")}</dt>
            <dd><code>{id()}</code></dd>
          </div>
          <Show when={directory()}>
            <div class="gateway-workbench-meta-row">
              <dt>{t("gateway.workbench.directory")}</dt>
              <dd title={directory()}>{compactDirectory(directory())}</dd>
            </div>
          </Show>
          <Show when={executor()}>
            <div class="gateway-workbench-meta-row">
              <dt>{t("gateway.workbench.executor")}</dt>
              <dd>{executor()}</dd>
            </div>
          </Show>
          <Show when={priority()}>
            <div class="gateway-workbench-meta-row">
              <dt>{t("gateway.workbench.priority")}</dt>
              <dd>{priority()}</dd>
            </div>
          </Show>
          <div class="gateway-workbench-meta-row">
            <dt>{t("gateway.workbench.status")}</dt>
            <dd>
              {t(`task.status.${status()}`) === `task.status.${status()}` ? status() : t(`task.status.${status()}`)}
            </dd>
          </div>
          <Show when={created() > 0}>
            <div class="gateway-workbench-meta-row">
              <dt>{t("gateway.workbench.created")}</dt>
              <dd>{formatStamp(created())}</dd>
            </div>
          </Show>
          <Show when={updated() > 0}>
            <div class="gateway-workbench-meta-row">
              <dt>{t("gateway.workbench.updated")}</dt>
              <dd>{formatStamp(updated())}</dd>
            </div>
          </Show>
        </dl>
        <div class="gateway-workbench-actions" role="toolbar" aria-label={t("gateway.workbench.actions_label")}>
          <Button
            type="button"
            variant="outline"
            size="md"
            tone="neutral"
            data-ui="gateway-workbench-cancel"
            data-confirm={confirmWorkbenchCancel.armed() ? "true" : undefined}
            disabled={!INTERRUPTABLE_STATUSES.has(status()) || isBusy("cancel")}
            onClick={() => confirmWorkbenchCancel.confirm(() => props.onCancelTask(id()))}
            onBlur={confirmWorkbenchCancel.disarm}
          >
            {isBusy("cancel")
              ? t("gateway.workbench.actions.busy")
              : confirmWorkbenchCancel.armed()
                ? t("gateway.workbench.actions.cancel_confirm")
                : t("gateway.workbench.actions.cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            tone="neutral"
            data-ui="gateway-workbench-retry"
            data-confirm={confirmWorkbenchRetry.armed() ? "true" : undefined}
            disabled={INTERRUPTABLE_STATUSES.has(status()) || isBusy("retry")}
            onClick={() => confirmWorkbenchRetry.confirm(() => props.onRetryTask(id()))}
            onBlur={confirmWorkbenchRetry.disarm}
          >
            {isBusy("retry")
              ? t("gateway.workbench.actions.busy")
              : confirmWorkbenchRetry.armed()
                ? t("gateway.workbench.actions.retry_confirm")
                : t("gateway.workbench.actions.retry")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            tone="neutral"
            data-ui="gateway-workbench-replan"
            data-confirm={confirmWorkbenchReplan.armed() ? "true" : undefined}
            disabled={INTERRUPTABLE_STATUSES.has(status()) || isBusy("replan")}
            onClick={() => confirmWorkbenchReplan.confirm(() => props.onReplanTask(id()))}
            onBlur={confirmWorkbenchReplan.disarm}
          >
            {isBusy("replan")
              ? t("gateway.workbench.actions.busy")
              : confirmWorkbenchReplan.armed()
                ? t("gateway.workbench.actions.replan_confirm")
                : t("gateway.workbench.actions.replan")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            tone="accent"
            data-ui="gateway-workbench-open-panel"
            onClick={props.onOpenInPanel}
          >
            {t("gateway.workbench.actions.open_in_panel")}
          </Button>
        </div>
        {/* actionError now lives at the page level so it is visible from
            every Gateway state, not only when a task is selected (codex
            round-3 P2). The header banner is the single source of truth. */}
      </header>

      <div class="gateway-workbench-rail conversation-agent-rail-host" data-ui="gateway-workbench-rail">
        <ConversationAgentRail />
      </div>

      <section class="gateway-workbench-section" data-section="summary">
        <h3 class="gateway-workbench-section-title">{t("gateway.workbench.summary_label")}</h3>
        <Show when={summary()} fallback={<p class="gateway-workbench-section-empty">{t("gateway.workbench.summary_empty")}</p>}>
          <p class="gateway-workbench-summary">{summary()}</p>
        </Show>
      </section>

      <section class="gateway-workbench-section" data-section="goals">
        <h3 class="gateway-workbench-section-title">{t("gateway.workbench.goals_heading")}</h3>
        <Show when={goals().length > 0} fallback={<p class="gateway-workbench-section-empty">{t("gateway.workbench.goals_empty")}</p>}>
          <ul class="gateway-workbench-goals">
            <For each={goals()}>
              {(goal: any) => (
                <li class="gateway-workbench-goal" data-status={String(goal?.status ?? "")}>
                  <span class="gateway-workbench-goal-title">
                    {clip(goal?.title || goal?.objective || goal?.id || "—", 80)}
                  </span>
                  <Show when={goal?.status}>
                    <span class="gateway-workbench-goal-status">{String(goal?.status)}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class="gateway-workbench-section" data-section="interactions">
        <h3 class="gateway-workbench-section-title">{t("gateway.workbench.interactions_heading")}</h3>
        <Show
          when={interactions().length > 0}
          fallback={<p class="gateway-workbench-section-empty">{t("gateway.workbench.interactions_empty")}</p>}
        >
          <ul class="gateway-workbench-interactions">
            <For each={interactions()}>
              {(it: any) => (
                <li class="gateway-workbench-interaction">
                  <span class="gateway-workbench-interaction-type">{String(it?.type ?? "")}</span>
                  <span class="gateway-workbench-interaction-text">{clip(it?.prompt || it?.message || it?.id, 200)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class="gateway-workbench-message">
        <textarea
          class="gateway-workbench-message-input"
          rows={3}
          placeholder={t("gateway.workbench.message_placeholder")}
          value={props.messageDraft}
          onInput={(e) => props.onMessageDraftChange(e.currentTarget.value)}
          disabled={messageBusy()}
          data-ui="gateway-message-input"
        />
        <div class="gateway-workbench-message-actions">
          <Show when={props.messageNotice}>
            <span
              class="gateway-workbench-message-notice"
              data-tone={props.messageNotice!.kind}
              role={props.messageNotice!.kind === "error" ? "alert" : undefined}
            >
              {props.messageNotice!.text}
            </span>
          </Show>
          <Button
            type="button"
            variant="solid"
            size="md"
            tone="accent"
            data-ui="gateway-message-send"
            disabled={!props.messageDraft.trim() || props.messageSending}
            title={t("gateway.workbench.message_send_title")}
            onClick={props.onSendMessage}
          >
            {props.messageSending ? t("gateway.workbench.actions.busy") : t("gateway.workbench.message_send")}
          </Button>
        </div>
      </section>
    </div>
  )
}

// ── Decomposition composer ────────────────────────────────────────────

function GatewayComposer(props: {
  onClose: () => void
  onAwake: (result: { missionID: string; sessionID: string; created: boolean }) => void
}) {
  // ── MissionLauncher — supervisor wake surface ─────────────────────────
  //
  // Single textarea + optional missionID input. Submitting POSTs to
  // /gateway/master/wake which either starts a new gateway-master
  // session (no missionID) or resumes an existing one (operator-typed
  // missionID). Once wake returns, the operator's mission is owned by
  // the supervisor LLM — no proposal preview / candidate selection here.
  //
  // The previous GatewayComposer surfaced a decomposition proposal +
  // per-candidate review UI; that workflow is superseded by the
  // supervisor (specs/gateway-master-supervisor-2026-05-26.md §2.7).
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
      const result = await wakeMaster({
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
    <div class="gateway-composer" data-ui="gateway-composer">
      <header class="gateway-composer-header">
        <h2 class="gateway-composer-title">{t("gateway.master.title")}</h2>
        <Button
          type="button"
          variant="ghost"
          size="md"
          tone="neutral"
          data-ui="gateway-composer-discard"
          title={t("gateway.master.discard_title")}
          onClick={handleDiscard}
        >
          <Icon name="close" size={12} />
          <span>{t("gateway.master.discard")}</span>
        </Button>
      </header>
      <textarea
        class="gateway-composer-textarea"
        rows={8}
        placeholder={t("gateway.master.placeholder")}
        value={text()}
        maxLength={GATEWAY_REQUIREMENT_MAX_CHARS}
        onInput={(e) => setText(e.currentTarget.value)}
        disabled={submitting()}
        data-ui="gateway-composer-input"
      />
      <div class="gateway-composer-counter" data-ui="gateway-composer-counter">
        <span
          data-near-limit={text().length >= GATEWAY_REQUIREMENT_MAX_CHARS - 200 ? "true" : undefined}
          data-at-limit={text().length >= GATEWAY_REQUIREMENT_MAX_CHARS ? "true" : undefined}
        >
          {t("gateway.master.length_counter", {
            count: String(text().length),
            max: String(GATEWAY_REQUIREMENT_MAX_CHARS),
          })}
        </span>
      </div>
      <div class="gateway-composer-controls">
        <label class="gateway-composer-mission-id">
          <span>{t("gateway.master.mission_id_label")}</span>
          <input
            type="text"
            class="gateway-composer-mission-id-input"
            placeholder={t("gateway.master.mission_id_placeholder")}
            value={missionID()}
            disabled={submitting()}
            onInput={(e) => setMissionID(e.currentTarget.value)}
            data-ui="gateway-composer-mission-id"
          />
        </label>
        <Button
          type="button"
          variant="solid"
          size="md"
          tone="accent"
          data-ui="gateway-composer-submit"
          disabled={!text().trim() || submitting()}
          onClick={() => void handleSubmit()}
        >
          {submitting()
            ? t("gateway.master.submitting")
            : missionID().trim()
              ? t("gateway.master.resume")
              : t("gateway.master.start")}
        </Button>
      </div>
      <Show when={error()}>
        <div class="gateway-error" role="alert" data-ui="gateway-composer-error">
          <span>{t("gateway.master.error", { error: error() })}</span>
        </div>
      </Show>
      <Show when={lastResult()}>
        {(result) => (
          <div class="gateway-master-result" role="status" data-ui="gateway-master-result">
            <p>
              {result().created
                ? t("gateway.master.result_created", { missionID: result().missionID })
                : t("gateway.master.result_resumed", { missionID: result().missionID })}
            </p>
            <p class="gateway-master-result-session">
              <code>{result().sessionID}</code>
            </p>
          </div>
        )}
      </Show>
    </div>
  )
}

// ── Channel side panel (right column, Phase 4) ────────────────────────

function GatewayChannelPanel(props: {
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
    <aside class="gateway-channels" data-ui="gateway-channels">
      <header class="gateway-channels-header">
        <h2 class="gateway-channels-heading">{t("gateway.channels.heading")}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tone="neutral"
          data-ui="gateway-channels-refresh"
          title={t("gateway.refresh_title")}
          onClick={props.onRefreshChannels}
        >
          <Icon name="refresh" size={12} />
        </Button>
      </header>

      <section class="gateway-channels-runtime" data-ui="gateway-channels-runtime">
        <h3>{t("gateway.channels.runtime_heading")}</h3>
        <Show when={props.runtimeError}>
          <div class="gateway-error" role="alert">
            <span>{t("gateway.error.channel_runtime_failed", { error: props.runtimeError })}</span>
          </div>
        </Show>
        <Show when={props.runtime}>
          <dl class="gateway-channels-runtime-meta">
            <div>
              <dt>{t("gateway.channels.runtime_status")}</dt>
              <dd data-status={props.runtime!.status}>{runtimeLabel(props.runtime!.status)}</dd>
            </div>
            <Show when={props.runtime!.detail}>
              <div>
                <dt>{t("gateway.channels.runtime_detail")}</dt>
                <dd>{props.runtime!.detail}</dd>
              </div>
            </Show>
            <Show when={props.runtime!.channels.length > 0}>
              <div>
                <dt>{t("gateway.channels.runtime_channels")}</dt>
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
          data-ui="gateway-channels-restart"
          disabled={restarting()}
          title={t("gateway.channels.restart_title")}
          onClick={props.onRestartRuntime}
        >
          {restarting() ? t("gateway.channels.restarting") : t("gateway.channels.restart")}
        </Button>
        <Show when={props.restartError}>
          <div class="gateway-error" role="alert" data-ui="gateway-channels-restart-error">
            <span>{t("gateway.error.restart_failed", { error: props.restartError })}</span>
          </div>
        </Show>
      </section>

      <section class="gateway-channels-list" data-ui="gateway-channels-list">
        <Show when={props.channelsError}>
          <div class="gateway-error" role="alert">
            <span>{t("gateway.error.channels_failed", { error: props.channelsError })}</span>
          </div>
        </Show>
        <Show
          when={props.channels.length > 0}
          fallback={
            <Show when={!props.channelsError}>
              <p class="gateway-channels-empty">{t("gateway.channels.empty")}</p>
            </Show>
          }
        >
          <ul class="gateway-channels-rows">
            <For each={props.channels}>
              {(c) => (
                <li class="gateway-channel-row" data-channel-id={c.id} data-status={c.status} data-runtime={c.runtime_status ?? "disabled"}>
                  <div class="gateway-channel-row-head">
                    <span class="gateway-channel-row-name">{c.name}</span>
                    <span class="gateway-channel-row-status" data-status={c.status}>
                      {channelStatusLabel(c.status)}
                    </span>
                  </div>
                  <Show when={c.summary}>
                    <p class="gateway-channel-row-summary">{c.summary}</p>
                  </Show>
                  <Show when={c.runtime_detail}>
                    <p class="gateway-channel-row-detail">{c.runtime_detail}</p>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class="gateway-channels-bindings" data-ui="gateway-channels-bindings">
        <h3>{t("gateway.channels.bindings_heading")}</h3>
        <Show when={props.bindingsError}>
          <div class="gateway-error" role="alert">
            <span>{t("gateway.workbench.bindings_load_failed", { error: props.bindingsError })}</span>
          </div>
        </Show>
        <Show
          when={props.selectedTaskID}
          fallback={<p class="gateway-channels-empty">{t("gateway.channels.bindings_empty_no_task")}</p>}
        >
          <Show
            when={props.bindings.length > 0}
            fallback={
              <Show when={!props.bindingsError}>
                <p class="gateway-channels-empty">{t("gateway.channels.bindings_empty")}</p>
              </Show>
            }
          >
            <ul class="gateway-channels-binding-list">
              <For each={props.bindings}>
                {(b: any) => (
                  <li class="gateway-channels-binding" data-binding-id={String(b?.id ?? "")}>
                    <Icon name="channel-link" size={12} />
                    <span><strong>{String(b?.platform ?? "")}</strong></span>
                    <span class="gateway-channels-binding-channel">{String(b?.channel ?? "")}</span>
                    <span class="gateway-channels-binding-thread">{String(b?.thread ?? "")}</span>
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
