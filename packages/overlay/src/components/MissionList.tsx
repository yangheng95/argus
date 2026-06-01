import { createMemo, createSignal, For, Show } from "solid-js"
import type { MissionRecord } from "../services/mission"
import { detailStamp, relativeTime } from "../utils/time"
import { t } from "../utils/i18n"
import { compactDirectory } from "../utils/mission-helpers"
import { projectDirectoryKey, projectDirectoryLabel } from "../utils/project-directory"
import { Icon } from "./Icon"
import { LedgerList } from "./LedgerList"

export interface MissionListProps {
  missions: MissionRecord[]
  selectedSessionID?: string
  loading?: boolean
  error?: string
  searchQuery: string
  onSearchChange: (next: string) => void
  onSelectMission: (mission: MissionRecord) => void
  onRetry: () => void
}

type MissionGroup = {
  directory: string
  latest: number
  items: MissionRecord[]
}

function missionProjectTip(directory: string, count: number): string {
  return [directory || t("task.project.unknown"), String(count)].filter(Boolean).join(" / ")
}

export function MissionList(props: MissionListProps) {
  const [collapsedDirectories, setCollapsedDirectories] = createSignal<Record<string, boolean>>({})
  const groupedMissions = createMemo<MissionGroup[]>(() => {
    const groups = new Map<string, MissionGroup>()
    for (const mission of props.missions) {
      const directory = mission.directory || ""
      let group = groups.get(directory)
      if (!group) {
        group = { directory, latest: 0, items: [] }
        groups.set(directory, group)
      }
      group.items.push(mission)
      if (mission.updated > group.latest) group.latest = mission.updated
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => b.updated - a.updated),
      }))
      .sort((a, b) => b.latest - a.latest)
  })

  function isDirectoryCollapsed(directory: string): boolean {
    return collapsedDirectories()[projectDirectoryKey(directory)] === true
  }

  function toggleDirectoryGroup(directory: string): void {
    const key = projectDirectoryKey(directory)
    setCollapsedDirectories((current) => {
      const next = { ...current }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  return (
    <aside class="mission-ledger" data-ui="mission-ledger">
      <header class="mission-ledger-header oc-surface-header">
        <span class="mission-ledger-title oc-surface-header__title">{t("mission.ledger.title")}</span>
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
        <button
          type="button"
          class="mission-ledger-search-clear"
          aria-label={t("mission.ledger.search_clear")}
          title={t("mission.ledger.search_clear")}
          hidden={!props.searchQuery}
          onClick={() => props.onSearchChange("")}
        >
          <Icon name="close" size={10} />
        </button>
      </div>

      <div class="mission-ledger-list">
        <LedgerList
          items={groupedMissions()}
          loading={props.loading}
          error={props.error}
          emptyLabel={props.searchQuery ? t("mission.ledger.empty_filtered") : t("mission.ledger.empty")}
          retryLabel={t("mission.ledger.error_retry")}
          onRetry={props.onRetry}
        >
          {(group) => {
            const label = projectDirectoryLabel(group.directory, t("task.project.unknown"))
            const collapsed = () => isDirectoryCollapsed(group.directory)
            return (
              <section
                class="project-group mission-project-group"
                data-ui="mission-project-group"
                data-collapsed={collapsed() ? "true" : undefined}
              >
                <button
                  type="button"
                  class="project-group-heading"
                  title={missionProjectTip(group.directory, group.items.length)}
                  aria-expanded={collapsed() ? "false" : "true"}
                  aria-label={label.name}
                  onClick={() => toggleDirectoryGroup(group.directory)}
                >
                  <span class="project-group-icon" aria-hidden="true">
                    <Icon name={collapsed() ? "folder" : "folder-open"} size={15} />
                  </span>
                  <span class="project-group-copy">
                    <span class="project-group-name">{label.name}</span>
                    <Show when={label.parent}>
                      <span class="project-group-parent">{label.parent}</span>
                    </Show>
                  </span>
                  <span class="project-group-count" aria-label={String(group.items.length)}>
                    {group.items.length}
                  </span>
                  <span class="project-group-chevron" aria-hidden="true">
                    <Icon name={collapsed() ? "chevron" : "chevron-down"} size={12} />
                  </span>
                </button>
                <Show when={!collapsed()}>
                  <div class="project-group-body">
                    <For each={group.items}>
                      {(mission) => (
                        <button
                          type="button"
                          class="ledger-row mission-row"
                          data-ui="mission-row"
                          data-mission-id={mission.missionID}
                          data-session-id={mission.sessionID}
                          data-active={props.selectedSessionID === mission.sessionID ? "true" : undefined}
                          onClick={() => props.onSelectMission(mission)}
                        >
                          <span class="ledger-row-icon" aria-hidden="true">
                            <Icon name="mission" size={14} />
                          </span>
                          <span class="ledger-row-main">
                            <span class="ledger-row-title">{mission.title || mission.missionID}</span>
                            <span class="ledger-row-meta">
                              <span>{mission.missionID}</span>
                              <span>{compactDirectory(mission.directory)}</span>
                            </span>
                          </span>
                          <span class="ledger-row-stamp" title={detailStamp(mission.updated)}>
                            {relativeTime(mission.updated) || t("mission.ledger.updated_unknown")}
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            )
          }}
        </LedgerList>
      </div>
    </aside>
  )
}
