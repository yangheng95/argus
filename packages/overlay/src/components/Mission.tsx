import { Show, createEffect, createResource, createSignal, onCleanup } from "solid-js"
import { appStore } from "../store/app"
import { boardStore, setBoardStore } from "../store/board"
import { clearMessages, setChatAttachments } from "../store/messages"
import { loadConversation } from "../services/conversation"
import { clearComposerDraft, composerDraftKey } from "../services/composer-draft"
import {
  abortMission,
  deleteMission,
  loadMissions,
  missionPage,
  renameMission,
  wakeMission,
  type MissionRecord,
} from "../services/mission"
import { startSSE, stopSSE } from "../services/sse"
import { resetWriter } from "../services/tree-writer"
import { activeDirectory as activeProjectDirectory } from "../services/workspace"
import { ApiError } from "../services/api"
import { t } from "../utils/i18n"
import { humanizeApiError } from "../utils/mission-helpers"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { ChatComposer } from "./ChatComposer"
import { MissionList } from "./MissionList"

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

function actionVerbLabel(actionKey: string): string {
  const verb = String(actionKey || "").split(":", 1)[0] || actionKey
  const translated = t(`mission.error.action.${verb}`)
  return translated === `mission.error.action.${verb}` ? verb : translated
}

const MISSION_LIST_PAGE_SIZE = 10

export interface MissionProps {
  active: boolean
  refreshToken?: number
  onSelectTask: (taskID: string) => void
}

export function Mission(props: MissionProps) {
  return (
    <Show when={appStore.i18nReady} fallback={<div class="mission-left-panel" data-i18n-ready="false" />}>
      <MissionContent {...props} />
    </Show>
  )
}

function MissionContent(props: MissionProps) {
  const [searchQuery, setSearchQuery] = createSignal("")
  const [missionRefreshToken, setMissionRefreshToken] = createSignal(0)
  const [composerOpen, setComposerOpen] = createSignal(false)
  const [actionBusy, setActionBusy] = createSignal<string>("")
  const [actionError, setActionError] = createSignal<{ action: string; error: string } | null>(null)
  const [missionsLoadingMore, setMissionsLoadingMore] = createSignal(false)

  const [missionRecords, missionRecordsCtl] = createResource(
    () => {
      if (!props.active) return null
      return { search: searchQuery().trim(), refresh: missionRefreshToken(), sharedRefresh: props.refreshToken ?? 0 }
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

  const selectedMissionSessionID = () =>
    boardStore.selectedSource?.kind === "session" ? boardStore.selectedSource.id : ""

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

  function handleTaskSelect(taskID: string): void {
    props.onSelectTask(taskID)
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

  createEffect(() => {
    if (!props.active) return
    if (searchQuery().trim()) return
    if (boardStore.selectedSource?.kind === "session") return
    if (missionRecords.loading) return
    const mission = missionRecords()?.records[0]
    if (!mission) return
    void handleMissionSelect(mission)
  })

  createEffect(() => {
    if (!props.active) return
    if (searchQuery().trim()) return
    const selected = selectedMissionSessionID()
    if (!selected || missionRecords.loading) return
    const rows = missionRecords()?.records ?? []
    if (!rows.some((mission) => mission.sessionID === selected)) {
      handleCloseMission()
    }
  })

  return (
    <div class="mission-left-panel" data-ui="mission-left-panel">
      <Show when={actionError()}>
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

      <Show when={composerOpen()}>
        <MissionComposer
          onClose={() => setComposerOpen(false)}
          onAwake={(result) => void handleMissionAwake(result)}
          draftKey={missionLauncherDraftKey()}
        />
      </Show>

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
        onSelectTask={handleTaskSelect}
        onAbortMission={(mission) => void handleMissionAbort(mission)}
        onDeleteMission={(mission) => void handleMissionDelete(mission)}
        onRenameMission={(mission, title) => void handleMissionRename(mission, title)}
        onCreateMission={handleNewMission}
        onRetry={() => void missionRecordsCtl.refetch()}
        hasMore={missionRecords()?.hasMore}
        loadingMore={missionsLoadingMore()}
        onLoadMore={() => void handleMissionLoadMore()}
      />
    </div>
  )
}

function MissionComposer(props: {
  onClose: () => void
  onAwake: (result: { missionID: string; sessionID: string; created: boolean }) => void
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
    <div class="mission-composer mission-composer--inline" data-ui="mission-composer">
      <header class="mission-composer-header oc-surface-header">
        <div class="mission-composer-title-block">
          <span class="mission-composer-kicker">{t("mission.title")}</span>
          <h2 class="mission-composer-title oc-surface-header__title">{t("mission.launcher.title")}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tone="neutral"
          data-ui="mission-composer-discard"
          title={t("mission.launcher.discard_title")}
          aria-label={t("mission.launcher.discard_title")}
          onClick={handleDiscard}
        >
          <Icon name="close" size={12} />
        </Button>
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
