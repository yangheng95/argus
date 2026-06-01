import type { MissionRecord } from "../services/mission"
import { detailStamp, relativeTime } from "../utils/time"
import { t } from "../utils/i18n"
import { compactDirectory } from "../utils/mission-helpers"
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

export function MissionList(props: MissionListProps) {
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
          items={props.missions}
          loading={props.loading}
          error={props.error}
          emptyLabel={props.searchQuery ? t("mission.ledger.empty_filtered") : t("mission.ledger.empty")}
          retryLabel={t("mission.ledger.error_retry")}
          onRetry={props.onRetry}
        >
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
        </LedgerList>
      </div>
    </aside>
  )
}
