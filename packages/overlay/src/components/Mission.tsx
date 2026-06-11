// Mission
//
// Operator control room for the user's long-running goals. A separate page
// (template section 6.2) sitting beside the default conversation panel.
// Switching modes uses the shared `pageMode` store (store/page-mode.ts);
// opening a mission session hydrates the shared conversation store from that
// session.
//
// Layout (template section 7):
//   header    : workspace, system health, channel runtime, counts, actions
//   ledger    : mission list (project-scoped, searchable)
//   workbench : shared mission-session conversation panel, OR mission launcher
//   channels  : channel catalog, runtime status, restart
//
// Data sources (template section 5, single source of truth):
//   - /mission                  : mission session ledger records
//   - boardStore.board          : selected mission session detail
//   - Channel runtime + list    : existing channel infra routes
//   - /mission/wake             : start or resume the Mission agent session
//
// Errors are surfaced explicitly (template §14): no silent fallback, no
// degraded state. Each error block names the operation and the server
// message and offers a retry where retrying is meaningful.

import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { appStore } from "../store/app"
import { boardStore, setBoardStore } from "../store/board"
import { clearMessages, setChatAttachments } from "../store/messages"
import { settingsStore, setSettingsStore, saveSettings } from "../store/settings"
import { initPaneResizers, renderPaneLayout, MISSION_PANE_CONFIG } from "../services/pane"
import { isMissionPage, setPageMode } from "../store/page-mode"
import { submitMessage } from "../services/task"
import {
  loadChannelList,
  loadChannelRuntime,
  loadMissions,
  restartChannelRuntime,
  wakeMission,
  abortMission,
  deleteMission,
  renameMission,
  missionPage,
  type ChannelInfo,
  type ChannelRuntimeStatus,
  type MissionRecord,
  type MissionTaskStats,
} from "../services/mission"
import { ApiError } from "../services/api"
import { loadConversation } from "../services/conversation"
import type { DiffTarget } from "../services/diff"
import { startSSE, stopSSE } from "../services/sse"
import { resetWriter } from "../services/tree-writer"
import { t } from "../utils/i18n"
import { humanizeApiError, runtimeLabel } from "../utils/mission-helpers"
import { detailStamp, stamp } from "../utils/time"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { Conversation } from "./Conversation"
import { ConversationAgentRail } from "./ConversationAgentRail"
import { ChatComposer } from "./ChatComposer"
import { MissionList } from "./MissionList"
import { WorkspacePanel } from "./WorkspacePanel"
import { activeDirectory as activeProjectDirectory } from "../services/workspace"
import { clearComposerDraft, composerDraftKey } from "../services/composer-draft"

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

function emptyMissionTaskStats(): MissionTaskStats {
  return { total: 0, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 }
}

const MISSION_LIST_PAGE_SIZE = 10

function aggregateMissionTaskStats(missions: MissionRecord[]): MissionTaskStats {
  return missions.reduce((stats, mission) => {
    stats.total += mission.taskStats.total
    stats.queued += mission.taskStats.queued
    stats.active += mission.taskStats.active
    stats.completed += mission.taskStats.completed
    stats.failed += mission.taskStats.failed
    stats.cancelled += mission.taskStats.cancelled
    return stats
  }, emptyMissionTaskStats())
}

// ── Top-level Mission component ──

type MissionProps = {
  workspaceTarget: () => DiffTarget
  workspaceOpen: () => boolean
  closeWorkspace: () => void
}

export function Mission(props: MissionProps) {
  return (
    <Show when={appStore.i18nReady} fallback={<div class="mission-page" data-i18n-ready="false" />}>
      <MissionContent {...props} />
    </Show>
  )
}

function MissionContent(props: MissionProps) {
  // ── Per-page state ─────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = createSignal("")
  const [missionRefreshToken, setMissionRefreshToken] = createSignal(0)
  const [composerOpen, setComposerOpen] = createSignal(false)
  const [actionBusy, setActionBusy] = createSignal<string>("")
  const [actionError, setActionError] = createSignal<{ action: string; error: string } | null>(null)
  const [missionsLoadingMore, setMissionsLoadingMore] = createSignal(false)
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

  // Project-scoped Mission resources fire only when (a) the Mission page is
  // the active mode AND (b) `settingsStore.directory` is populated. (a)
  // avoids wasted server traffic from the always-mounted Mission component
  // while the operator is using the Panel. (b) avoids DirectoryRequiredError
  // on project-scoped routes during cold boot before settings rehydrate.
  // The Mission ledger itself is all-project and is gated only by page mode.
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

  const [missionRecords, missionRecordsCtl] = createResource(
    () => {
      const onMissionPage = isMissionPage()
      if (!onMissionPage) return null
      return { search: searchQuery().trim(), refresh: missionRefreshToken() }
    },
    async (input) => {
      try {
        const records = await loadMissions({
          search: input.search || undefined,
          limit: MISSION_LIST_PAGE_SIZE + 1,
        })
        return missionPage(records, MISSION_LIST_PAGE_SIZE)
      } catch (err) {
        throw new Error(errorMessage(err))
      }
    },
    { initialValue: { records: [], hasMore: false, cursor: null } },
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

  const [runtime, runtimeCtl] = createResource(missionDirectory, async () => {
    try {
      return await loadChannelRuntime()
    } catch (err) {
      throw new Error(errorMessage(err))
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

  // ── Derived mission views ──────────────────────────────────────────

  const selectedMissionSessionID = () =>
    boardStore.selectedSource?.kind === "session" ? boardStore.selectedSource.id : ""
  const selectedMissionRecord = createMemo(() => {
    const selected = selectedMissionSessionID()
    if (!selected) return undefined
    return (missionRecords()?.records ?? []).find((mission) => mission.sessionID === selected)
  })
  const missionChannelTaskStats = createMemo(
    () => selectedMissionRecord()?.taskStats ?? aggregateMissionTaskStats(missionRecords()?.records ?? []),
  )

  // ── Refresh / actions ──────────────────────────────────────────────

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

  async function openMissionSession(sessionID: string, directory?: string): Promise<void> {
    const source = { kind: "session" as const, id: sessionID }
    stopSSE()
    clearMessages()
    setChatAttachments([])
    resetWriter({ scrollIntent: "bottom", cause: "mission-session-switch" })
    setBoardStore("selectedSource", source)
    setBoardStore("board", null)
    await loadConversation(source, {
      scrollIntent: "bottom",
      resetCause: "mission-session-hydrate",
      directory,
    })
    startSSE(source, 0)
  }

  async function handleMissionSelect(mission: MissionRecord): Promise<void> {
    await withBusy(`mission:${mission.sessionID}`, async () => {
      await openMissionSession(mission.sessionID, mission.directory)
    })
  }

  function handleNewMission(): void {
    handleCloseMission()
    setComposerOpen(true)
    queueMicrotask(() => {
      document.querySelector<HTMLTextAreaElement>('[data-ui="mission-composer-input"]')?.focus()
    })
  }

  async function handleMissionAbort(mission: MissionRecord): Promise<void> {
    await withBusy(`abort:${mission.missionID}`, async () => {
      await abortMission(mission)
      setMissionRefreshToken((value) => value + 1)
    })
  }

  async function handleMissionDelete(mission: MissionRecord): Promise<void> {
    await withBusy(`delete:${mission.missionID}`, async () => {
      if (selectedMissionSessionID() === mission.sessionID) handleCloseMission()
      await deleteMission(mission)
      await missionRecordsCtl.refetch()
    })
  }

  async function handleMissionRename(mission: MissionRecord, title: string): Promise<void> {
    await withBusy(`rename:${mission.missionID}`, async () => {
      await renameMission(mission, title)
      await missionRecordsCtl.refetch()
    })
  }

  async function handleMissionAwake(result: { missionID: string; sessionID: string; created: boolean }): Promise<void> {
    await missionRecordsCtl.refetch()
    const mission = (missionRecords()?.records ?? []).find((record) => record.sessionID === result.sessionID)
    await openMissionSession(result.sessionID, mission?.directory ?? activeProjectDirectory())
    setComposerOpen(false)
  }

  function handleMissionMessageSubmitted(): void {
    setMissionRefreshToken((value) => value + 1)
  }

  async function handleMissionLoadMore(): Promise<void> {
    if (missionsLoadingMore()) return
    const current = missionRecords()
    const cursor = current?.cursor
    if (!current?.hasMore || !cursor) return
    const search = searchQuery().trim()
    setMissionsLoadingMore(true)
    try {
      const records = await loadMissions({
        search: search || undefined,
        limit: MISSION_LIST_PAGE_SIZE + 1,
        cursorUpdated: cursor.updated,
        cursorSessionID: cursor.sessionID,
      })
      const nextPage = missionPage(records, MISSION_LIST_PAGE_SIZE)
      const bySession = new Map(current.records.map((mission) => [mission.sessionID, mission]))
      for (const mission of nextPage.records) bySession.set(mission.sessionID, mission)
      missionRecordsCtl.mutate({
        records: [...bySession.values()].sort((a, b) => b.updated - a.updated || b.sessionID.localeCompare(a.sessionID)),
        hasMore: nextPage.hasMore,
        cursor: nextPage.cursor,
      })
    } catch (err) {
      reportActionError("load_more", err)
    } finally {
      setMissionsLoadingMore(false)
    }
  }

  const missionLauncherDraftKey = () => {
    const directory = activeProjectDirectory()
    return directory ? composerDraftKey("mission", "new", directory) : composerDraftKey("mission", "new")
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

  function handleBackToPanel(): void {
    handleCloseMission()
    setPageMode("panel")
  }

  createEffect(() => {
    if (!isMissionPage()) return
    if (searchQuery().trim()) return
    const selected = selectedMissionSessionID()
    if (!selected || missionRecords.loading) return
    const rows = missionRecords()?.records ?? []
    if (!rows.some((mission) => mission.sessionID === selected)) {
      handleCloseMission()
    }
  })

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div class="mission" data-ui="mission-page">
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
          <MissionList
            missions={missionRecords()?.records ?? []}
            selectedSessionID={selectedMissionSessionID()}
            loading={missionRecords.loading}
            error={
              missionRecords.error
                ? t("mission.ledger.error_load_failed", { error: humanizeApiError(missionRecords.error) })
                : ""
            }
            searchQuery={searchQuery()}
            onSearchChange={setSearchQuery}
            onSelectMission={(mission) => void handleMissionSelect(mission)}
            onAbortMission={(mission) => void handleMissionAbort(mission)}
            onDeleteMission={(mission) => void handleMissionDelete(mission)}
            onRenameMission={(mission, title) => void handleMissionRename(mission, title)}
            onBackToPanel={handleBackToPanel}
            onCreateMission={handleNewMission}
            onRetry={() => void missionRecordsCtl.refetch()}
            hasMore={missionRecords()?.hasMore}
            loadingMore={missionsLoadingMore()}
            onLoadMore={() => void handleMissionLoadMore()}
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
          selectedSource={boardStore.selectedSource}
          workspaceTarget={props.workspaceTarget}
          workspaceOpen={props.workspaceOpen}
          closeWorkspace={props.closeWorkspace}
          selectedMission={selectedMissionRecord()}
          missionLauncherDraftKey={missionLauncherDraftKey()}
          onMissionAwake={(result) => void handleMissionAwake(result)}
          onMissionMessageSubmitted={handleMissionMessageSubmitted}
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
            channels={channels() ?? []}
            channelsError={channels.error ? humanizeApiError(channels.error) : ""}
            runtime={runtime()}
            runtimeError={runtime.error ? humanizeApiError(runtime.error) : ""}
            taskStats={missionChannelTaskStats()}
            restartError={channelRestartError()}
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
            onRefreshChannels={() => void Promise.allSettled([channelsCtl.refetch(), runtimeCtl.refetch()])}
          />
        </Show>
      </div>
    </div>
  )
}

function MissionWorkbench(props: {
  active: boolean
  composerOpen: boolean
  onCloseComposer: () => void
  selectedSource: { kind: "task" | "session"; id: string } | null
  workspaceTarget: () => DiffTarget
  workspaceOpen: () => boolean
  closeWorkspace: () => void
  selectedMission?: MissionRecord
  missionLauncherDraftKey: string
  onMissionAwake: (result: { missionID: string; sessionID: string; created: boolean }) => void
  onMissionMessageSubmitted: () => void
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
                <MissionComposer
                  onClose={props.onCloseComposer}
                  onAwake={props.onMissionAwake}
                  draftKey={props.missionLauncherDraftKey}
                />
              }
            >
              <MissionConversation
                workspaceTarget={props.workspaceTarget}
                workspaceOpen={props.workspaceOpen}
                closeWorkspace={props.closeWorkspace}
                mission={props.selectedMission}
                sessionID={props.selectedSource?.kind === "session" ? props.selectedSource.id : ""}
                onSubmitted={props.onMissionMessageSubmitted}
              />
            </Show>
          </Show>
        }
      >
        <MissionComposer
          onClose={props.onCloseComposer}
          onAwake={props.onMissionAwake}
          dismissible={true}
          draftKey={props.missionLauncherDraftKey}
        />
      </Show>
    </section>
  )
}

function MissionConversation(props: {
  workspaceTarget: () => DiffTarget
  workspaceOpen: () => boolean
  closeWorkspace: () => void
  mission?: MissionRecord
  sessionID: string
  onSubmitted: () => void
}) {
  let conversationContainer!: HTMLDivElement
  const missionStartTimeText = createMemo(() => {
    const created = props.mission?.created
    if (!created) return ""
    return stamp(created)
  })
  return (
    <div class="mission-conversation" data-kind="mission" data-ui="mission-conversation">
      <header class="mission-conversation-header chat-header oc-surface-header">
        <div class="chat-header-main oc-surface-header__main">
          <h2 class="mission-conversation-title chat-title oc-surface-header__title">
            {t("mission.launcher.conversation_title")}
          </h2>
        </div>
        <div class="oc-surface-header__actions mission-conversation-header-actions">
          <span
            class="mission-conversation-runtime"
            data-ui="mission-runtime"
            title={props.mission?.created ? detailStamp(props.mission.created) : ""}
          >
            {missionStartTimeText()}
          </span>
        </div>
      </header>
      <div class="chat-content-frame mission-chat-content-frame">
        <div class="chat-message-pane mission-chat-message-pane">
          <div class="conversation-body mission-conversation-body-frame">
            <div class="conversation-scroll-shell">
              <div class="mission-conversation-body chat-scroll session-content" ref={conversationContainer}>
                <Conversation container={conversationContainer} />
              </div>
            </div>
          </div>
          <div class="conversation-agent-rail-host mission-agent-rail-host" data-ui="mission-agent-rail">
            <ConversationAgentRail />
          </div>
        </div>
      </div>
      <Show when={props.workspaceOpen()}>
        <div class="workspace-mount mission-workspace-mount" data-ui="mission-workspace">
          <WorkspacePanel target={props.workspaceTarget()} onClose={props.closeWorkspace} />
        </div>
      </Show>
      <div class="mission-conversation-composer">
        <ChatComposer
          enabled={true}
          busy={false}
          formID="missionConversationChatForm"
          textareaID="missionConversationChatTextarea"
          sendID="missionConversationChatSend"
          draftKey={props.sessionID ? composerDraftKey("mission", "session", props.sessionID) : undefined}
          onSubmit={async (text, attachments, webSearch) => {
            await submitMessage(text, attachments, {
              metadata: {
                source: "mission",
                ...(webSearch ? { web_search: true } : {}),
              },
            })
            props.onSubmitted()
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
  draftKey: string
}) {
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal("")
  const [lastResult, setLastResult] = createSignal<{ missionID: string; sessionID: string; created: boolean } | null>(
    null,
  )

  let activeController: AbortController | null = null
  const cancelActive = (reason?: unknown): void => {
    if (!activeController) return
    activeController.abort(reason ?? new DOMException("Mission launcher dismissed", "AbortError"))
    activeController = null
  }
  onCleanup(() => cancelActive())

  async function handleSubmit(promptText: string, attachments: unknown[]) {
    const text = promptText.trim()
    if (!text) return
    if (attachments.length > 0) {
      const message = t("mission.launcher.attachments_unsupported")
      setError(message)
      throw new Error(message)
    }
    setSubmitting(true)
    setError("")
    cancelActive()
    const controller = new AbortController()
    activeController = controller
    try {
      const result = await wakeMission({
        text,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setLastResult(result)
      props.onAwake(result)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(humanizeApiError(err))
      setLastResult(null)
      throw err
    } finally {
      if (activeController === controller) activeController = null
      setSubmitting(false)
    }
  }

  function handleDiscard() {
    cancelActive()
    setError("")
    setLastResult(null)
    clearComposerDraft(props.draftKey)
    props.onClose()
  }

  return (
    <div class="mission-composer" data-ui="mission-composer">
      <header class="mission-composer-header oc-surface-header">
        <div class="mission-composer-title-block">
          <span class="mission-composer-kicker">{t("mission.title")}</span>
          <h2 class="mission-composer-title oc-surface-header__title">{t("mission.launcher.title")}</h2>
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
        <ChatComposer
          enabled={!submitting()}
          busy={false}
          formID="missionLauncherChatForm"
          textareaID="missionLauncherChatTextarea"
          sendID="missionLauncherChatSend"
          textareaDataUI="mission-composer-input"
          sendDataUI="mission-composer-submit"
          draftKey={props.draftKey}
          onSubmit={handleSubmit}
        />
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
  taskStats: MissionTaskStats
  restartError: string
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

      <section class="mission-created-task-stats" data-ui="mission-created-task-stats">
        <h3>{t("mission.tasks.stats_heading")}</h3>
        <dl class="mission-created-task-stats-grid">
          <div>
            <dt>{t("mission.tasks.total")}</dt>
            <dd>{props.taskStats.total}</dd>
          </div>
          <div>
            <dt>{t("mission.tasks.active")}</dt>
            <dd>{props.taskStats.active}</dd>
          </div>
          <div>
            <dt>{t("mission.tasks.queued")}</dt>
            <dd>{props.taskStats.queued}</dd>
          </div>
          <div>
            <dt>{t("mission.tasks.completed")}</dt>
            <dd>{props.taskStats.completed}</dd>
          </div>
          <div>
            <dt>{t("mission.tasks.failed")}</dt>
            <dd>{props.taskStats.failed}</dd>
          </div>
          <div>
            <dt>{t("mission.tasks.cancelled")}</dt>
            <dd>{props.taskStats.cancelled}</dd>
          </div>
        </dl>
      </section>

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
            <Show when={(props.runtime!.channels ?? []).length > 0}>
              <div>
                <dt>{t("mission.channels.runtime_channels")}</dt>
                <dd>{(props.runtime!.channels ?? []).join(", ")}</dd>
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
                <li
                  class="mission-channel-row"
                  data-channel-id={c.id}
                  data-status={c.status}
                  data-runtime={c.runtime_status ?? "disabled"}
                >
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
    </aside>
  )
}

function channelStatusLabel(status: string): string {
  const value = t(`channel.status.${status}`)
  return value === `channel.status.${status}` ? status : value
}
