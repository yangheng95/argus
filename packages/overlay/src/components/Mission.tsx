import { Show, createEffect, createResource, createSignal } from "solid-js"
import { appStore } from "../store/app"
import { boardStore, setBoardStore } from "../store/board"
import { clearMessages, setChatAttachments } from "../store/messages"
import { loadConversation } from "../services/conversation"
import {
  abortMission,
  deleteMission,
  loadMissions,
  missionPage,
  renameMission,
  type MissionRecord,
} from "../services/mission"
import { startSSE, stopSSE } from "../services/sse"
import { resetWriter } from "../services/tree-writer"
import { ApiError } from "../services/api"
import { t } from "../utils/i18n"
import { humanizeApiError } from "../utils/mission-helpers"
import { isAbortError } from "../utils/string"
import { Icon } from "./Icon"
import { MissionList } from "./MissionList"
import { Button } from "./ui/Button"

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
  activationToken?: number
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
  const [actionBusy, setActionBusy] = createSignal<string>("")
  const [actionError, setActionError] = createSignal<{ action: string; error: string } | null>(null)
  const [missionsLoadingMore, setMissionsLoadingMore] = createSignal(false)

  const [missionRecords, missionRecordsCtl] = createResource(
    () => {
      if (!props.active) return null
      return {
        search: searchQuery().trim(),
        refresh: missionRefreshToken(),
        sharedRefresh: props.refreshToken ?? 0,
        activation: props.activationToken ?? 0,
      }
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
    setActionError(null)
    try {
      await openMissionSession(mission.sessionID, mission.directory)
    } catch (err) {
      if (isAbortError(err)) return
      reportActionError(`mission:${mission.sessionID}`, err)
    }
  }

  function handleTaskSelect(taskID: string): void {
    props.onSelectTask(taskID)
  }

  async function handleMissionAbort(mission: MissionRecord): Promise<void> {
    await withBusy(`abort:${mission.missionID}`, async () => {
      await abortMission(mission)
      const current = missionRecords()
      if (current) {
        missionRecordsCtl.mutate({
          ...current,
          records: current.records.map((record) =>
            record.missionID === mission.missionID ? { ...record, interruptible: false } : record,
          ),
        })
      }
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
        records: [...bySession.values()].sort(
          (a, b) => b.updated - a.updated || b.sessionID.localeCompare(a.sessionID),
        ),
        hasMore: nextPage.hasMore,
        cursor: nextPage.cursor,
      })
    } catch (err) {
      reportActionError("load_more", err)
    } finally {
      setMissionsLoadingMore(false)
    }
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-chrome="icon-action"
            data-ui="mission-action-error-dismiss"
            aria-label={t("common.clear")}
            title={t("common.clear")}
            onClick={() => setActionError(null)}
          >
            <Icon name="close" size={12} />
          </Button>
        </div>
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
        onRetry={() => void missionRecordsCtl.refetch()}
        hasMore={missionRecords()?.hasMore}
        loadingMore={missionsLoadingMore()}
        onLoadMore={() => void handleMissionLoadMore()}
      />
    </div>
  )
}
