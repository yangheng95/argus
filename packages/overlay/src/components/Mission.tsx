import { Show, createResource, createSignal } from "solid-js"
import { appStore } from "../store/app"
import { boardStore, setBoardStore } from "../store/board"
import { clearMessages, setChatAttachments } from "../store/messages"
import { loadConversation } from "../services/conversation"
import {
  abortMission,
  deleteMission,
  downloadMissionProjectArchive,
  loadMissions,
  missionPage,
  renameMission,
  type MissionRecord,
  type MissionTaskProjection,
} from "../services/mission"
import { startSSE, stopSSE } from "../services/sse"
import { resetWriter } from "../services/tree-writer"
import { resetConversationAgentView } from "../store/conversation-agents"
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

type MissionRecordSource = {
  search: string
  refresh: number
  sharedRefresh: number
  activation: number
  mutation: number
}

export interface MissionProps {
  active: boolean
  activationToken?: number
  refreshToken?: number
  onSelectTask: (taskID: string, directory?: string) => void
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
  const [missionMutationRevision, setMissionMutationRevision] = createSignal(0)
  const [actionBusy, setActionBusy] = createSignal<string>("")
  const [actionError, setActionError] = createSignal<{ action: string; error: string } | null>(null)
  const [missionsLoadingMoreSource, setMissionsLoadingMoreSource] = createSignal<MissionRecordSource | null>(null)

  const missionListRequestSource = () => ({
    search: searchQuery().trim(),
    refresh: missionRefreshToken(),
    sharedRefresh: props.refreshToken ?? 0,
    activation: props.activationToken ?? 0,
  })
  const missionListSource = () => {
    if (!props.active) return null
    if (!appStore.connected) return null
    return missionListRequestSource()
  }
  const [missionRecords, missionRecordsCtl] = createResource(
    () => missionListSource(),
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
  const missionRecordSource = (): MissionRecordSource => ({
    ...missionListRequestSource(),
    mutation: missionMutationRevision(),
  })
  const sameMissionSource = (
    current: MissionRecordSource,
    source: MissionRecordSource,
  ) => {
    return (
      current.search === source.search &&
      current.refresh === source.refresh &&
      current.sharedRefresh === source.sharedRefresh &&
      current.activation === source.activation &&
      current.mutation === source.mutation
    )
  }
  const missionSourceMatches = (source: MissionRecordSource) =>
    sameMissionSource(missionRecordSource(), source)
  const missionsLoadingMore = () => {
    const source = missionsLoadingMoreSource()
    return !!source && missionSourceMatches(source)
  }

  const selectedMissionSessionID = () =>
    boardStore.selectedSource?.kind === "session" ? boardStore.selectedSource.id : ""

  function missionLedgerError(): string {
    if (props.active && !appStore.connected) return t("mission.ledger.error_offline")
    if (missionRecords.error) {
      return t("mission.ledger.error_load_failed", { error: humanizeApiError(missionRecords.error) })
    }
    return ""
  }

  function reportActionError(action: string, err: unknown): void {
    setActionError({ action, error: humanizeApiError(err) })
  }

  async function refetchMissionRecordsAfterMutation(
    action: "delete" | "rename",
    context: { title: string },
  ): Promise<void> {
    const source = missionRecordSource()
    try {
      const records = await loadMissions({
        search: source.search || undefined,
        limit: MISSION_LIST_PAGE_SIZE + 1,
      })
      if (!missionSourceMatches(source)) return
      missionRecordsCtl.mutate(missionPage(records, MISSION_LIST_PAGE_SIZE))
    } catch (err) {
      reportActionError(
        "reload",
        new Error(
          t(action === "delete" ? "mission.reload_after_delete_failed" : "mission.reload_after_rename_failed", {
            title: context.title,
            error: humanizeApiError(err),
          }),
        ),
      )
    }
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
    resetConversationAgentView()
    resetWriter({ scrollIntent: "bottom", cause: "mission-session-switch" })
    setBoardStore("selectedSource", source)
    setBoardStore("board", null)
    await loadConversation(source, {
      scrollIntent: "bottom",
      resetCause: "mission-session-hydrate",
      directory,
    })
    startSSE(source, 0, { directory })
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

  function handleTaskSelect(task: MissionTaskProjection): void {
    props.onSelectTask(task.id, task.directory)
  }

  async function handleMissionAbort(mission: MissionRecord): Promise<void> {
    await withBusy(`abort:${mission.missionID}`, async () => {
      await abortMission(mission)
      const current = missionRecords()
      if (current) {
        setMissionMutationRevision((value) => value + 1)
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
      await deleteMission(mission)
      if (selectedMissionSessionID() === mission.sessionID) handleCloseMission()
      setMissionMutationRevision((value) => value + 1)
      const current = missionRecords()
      if (current) {
        missionRecordsCtl.mutate({
          ...current,
          records: current.records.filter((record) => record.missionID !== mission.missionID),
        })
      }
      await refetchMissionRecordsAfterMutation("delete", { title: mission.title })
    })
  }

  async function handleMissionRename(mission: MissionRecord, title: string): Promise<void> {
    await withBusy(`rename:${mission.missionID}`, async () => {
      const updated = await renameMission(mission, title)
      setMissionMutationRevision((value) => value + 1)
      const current = missionRecords()
      if (current) {
        missionRecordsCtl.mutate({
          ...current,
          records: current.records.map((record) => (record.missionID === mission.missionID ? updated : record)),
        })
      }
      await refetchMissionRecordsAfterMutation("rename", { title: updated.title || title })
    })
  }

  async function handleMissionDownload(mission: MissionRecord): Promise<void> {
    await withBusy(`download:${mission.missionID}`, async () => {
      await downloadMissionProjectArchive(mission)
    })
  }

  async function handleMissionLoadMore(): Promise<void> {
    if (missionsLoadingMore()) return
    const current = missionRecords()
    const cursor = current?.cursor
    if (!current?.hasMore || !cursor) return
    const source = missionRecordSource()
    setMissionsLoadingMoreSource(source)
    try {
      const records = await loadMissions({
        search: source.search || undefined,
        limit: MISSION_LIST_PAGE_SIZE + 1,
        cursorUpdated: cursor.updated,
        cursorSessionID: cursor.sessionID,
      })
      if (!missionSourceMatches(source)) return
      const nextPage = missionPage(records, MISSION_LIST_PAGE_SIZE)
      const latest = missionRecords()
      if (!latest || !missionSourceMatches(source)) return
      const bySession = new Map(latest.records.map((mission) => [mission.sessionID, mission]))
      for (const mission of nextPage.records) bySession.set(mission.sessionID, mission)
      missionRecordsCtl.mutate({
        records: [...bySession.values()].sort(
          (a, b) => b.updated - a.updated || b.sessionID.localeCompare(a.sessionID),
        ),
        hasMore: nextPage.hasMore,
        cursor: nextPage.cursor,
      })
    } catch (err) {
      if (missionSourceMatches(source)) reportActionError("load_more", err)
    } finally {
      setMissionsLoadingMoreSource((current) => (current && sameMissionSource(current, source) ? null : current))
    }
  }

  function handleCloseMission(): void {
    if (boardStore.selectedSource?.kind !== "session") return
    stopSSE()
    clearMessages()
    setChatAttachments([])
    resetConversationAgentView()
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
        loading={appStore.connected && missionRecords.loading}
        error={missionLedgerError()}
        searchQuery={searchQuery()}
        onSearchChange={setSearchQuery}
        onSelectMission={(mission) => void handleMissionSelect(mission)}
        onSelectTask={handleTaskSelect}
        onAbortMission={(mission) => void handleMissionAbort(mission)}
        onDownloadMission={(mission) => void handleMissionDownload(mission)}
        onDeleteMission={(mission) => void handleMissionDelete(mission)}
        onRenameMission={(mission, title) => void handleMissionRename(mission, title)}
        actionBusy={actionBusy()}
        onRetry={() => {
          void Promise.resolve(missionRecordsCtl.refetch()).catch((error) => reportActionError("retry", error))
        }}
        hasMore={missionRecords()?.hasMore}
        loadingMore={missionsLoadingMore()}
        onLoadMore={() => void handleMissionLoadMore()}
      />
    </div>
  )
}
