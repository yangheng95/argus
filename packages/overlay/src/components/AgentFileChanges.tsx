import { For, Show, createMemo, createSignal } from "solid-js"
import type { CardNode } from "../store/card-tree"
import { selectedTaskDirectory } from "../store/board"
import { collectAgentFileChanges, type AgentFileChange } from "../utils/file-change-summary"
import { t, tc } from "../utils/i18n"
import { DiffView, changeStatusLabel } from "./DiffView"

const COLLAPSED_DIFF_LIMIT = 2
const COLLAPSED_PATH_LIMIT = 18

function hasRenderableDiff(item: AgentFileChange): boolean {
  if (item.before == null && item.after == null) return false
  return (item.before ?? "") !== (item.after ?? "")
}

function statusMark(status: AgentFileChange["status"]): string {
  if (status === "added") return "+"
  if (status === "deleted") return "-"
  return "~"
}

export function AgentFileChanges(props: { node: CardNode }) {
  const [expanded, setExpanded] = createSignal(false)
  const changes = createMemo(() => collectAgentFileChanges(props.node, selectedTaskDirectory()))
  const diffChanges = createMemo(() => changes().filter(hasRenderableDiff))
  const pathChanges = createMemo(() => changes().filter((item) => !hasRenderableDiff(item)))
  const visibleDiffChanges = createMemo(() =>
    expanded() ? diffChanges() : diffChanges().slice(0, COLLAPSED_DIFF_LIMIT),
  )
  const visiblePathChanges = createMemo(() =>
    expanded() ? pathChanges() : pathChanges().slice(0, COLLAPSED_PATH_LIMIT),
  )
  const hiddenCount = createMemo(
    () => changes().length - visibleDiffChanges().length - visiblePathChanges().length,
  )
  const totals = createMemo(() => ({
    additions: changes().reduce((sum, item) => sum + item.additions, 0),
    deletions: changes().reduce((sum, item) => sum + item.deletions, 0),
  }))
  const statusSummary = createMemo(() => {
    const counts = changes().reduce(
      (acc, item) => {
        acc[item.status] += 1
        return acc
      },
      { added: 0, deleted: 0, modified: 0 } as Record<AgentFileChange["status"], number>,
    )
    return (["modified", "added", "deleted"] as const)
      .filter((status) => counts[status] > 0)
      .map((status) => `${changeStatusLabel(status)} ${counts[status]}`)
      .join(" · ")
  })

  return (
    <Show when={props.node.kind === "agent" && changes().length > 0}>
      <section class="agent-file-changes" aria-label={tc("files.changed", changes().length)}>
        <div class="agent-file-changes__summary">
          <div class="agent-file-changes__summary-copy">
            <span class="agent-file-changes__count">{tc("files.changed", changes().length)}</span>
            <span class="agent-file-changes__status-summary">{statusSummary()}</span>
          </div>
          <Show when={totals().additions > 0 || totals().deletions > 0}>
            <span class="agent-file-changes__stats">
              <span class="diff-dialog-stat" data-tone="add">
                +{totals().additions}
              </span>
              <span class="diff-dialog-stat" data-tone="del">
                -{totals().deletions}
              </span>
            </span>
          </Show>
        </div>
        <Show when={diffChanges().length > 0}>
          <div class="agent-file-changes__diffs" aria-label={t("agent_file_changes.diff_preview")}>
            <For each={visibleDiffChanges()}>
              {(item) => (
                <section class="agent-file-change-diff" data-status={item.status}>
                  <header class="agent-file-change-diff__head">
                    <div class="agent-file-change-diff__copy">
                      <span class="agent-file-change-diff__mark" aria-hidden="true">
                        {statusMark(item.status)}
                      </span>
                      <span class="agent-file-change-diff__path" title={item.openPath}>
                        {item.displayPath}
                      </span>
                      <span class="agent-file-change-diff__status">{changeStatusLabel(item.status)}</span>
                    </div>
                    <Show when={item.additions > 0 || item.deletions > 0}>
                      <span class="agent-file-change-diff__stats">
                        <span data-tone="add">+{item.additions}</span>
                        <span data-tone="del">-{item.deletions}</span>
                      </span>
                    </Show>
                  </header>
                  <div class="agent-file-change-diff__body">
                    <DiffView item={item} />
                  </div>
                </section>
              )}
            </For>
          </div>
        </Show>
        <Show when={pathChanges().length > 0}>
          <div class="agent-file-changes__paths" aria-label={t("agent_file_changes.path_records")}>
            <div class="agent-file-changes__paths-head">
              <span>{t("agent_file_changes.path_records")}</span>
              <span>{tc("files.changed", pathChanges().length)}</span>
              <span>{t("agent_file_changes.no_diff_payload")}</span>
            </div>
            <div class="agent-file-changes__path-grid">
              <For each={visiblePathChanges()}>
                {(item) => (
                  <div class="agent-file-change-path" data-status={item.status}>
                    <span class="agent-file-change-path__mark" aria-hidden="true">
                      {statusMark(item.status)}
                    </span>
                    <span class="agent-file-change-path__path" title={item.openPath}>
                      {item.displayPath}
                    </span>
                    <span class="agent-file-change-path__status">{changeStatusLabel(item.status)}</span>
                    <Show when={item.additions > 0 || item.deletions > 0}>
                      <span class="agent-file-change-path__stats">
                        <span data-tone="add">+{item.additions}</span>
                        <span data-tone="del">-{item.deletions}</span>
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
        <Show when={hiddenCount() > 0 || expanded()}>
          <button
            type="button"
            class="agent-file-changes__toggle"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded()
              ? t("agent_file_changes.collapse")
              : t("agent_file_changes.expand", { count: hiddenCount() })}
          </button>
        </Show>
      </section>
    </Show>
  )
}
