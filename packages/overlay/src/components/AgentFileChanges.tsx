import { For, Show, createMemo } from "solid-js"
import type { CardNode } from "../store/card-tree"
import { selectedTaskDirectory } from "../store/board"
import { collectAgentFileChanges } from "../utils/file-change-summary"
import { tc } from "../utils/i18n"
import { DiffView, changeStatusLabel } from "./DiffView"

export function AgentFileChanges(props: { node: CardNode }) {
  const changes = createMemo(() => collectAgentFileChanges(props.node, selectedTaskDirectory()))
  const totals = createMemo(() => ({
    additions: changes().reduce((sum, item) => sum + item.additions, 0),
    deletions: changes().reduce((sum, item) => sum + item.deletions, 0),
  }))

  return (
    <Show when={props.node.kind === "agent" && changes().length > 0}>
      <section class="agent-file-changes" aria-label={tc("files.changed", changes().length)}>
        <div class="agent-file-changes__summary">
          <span class="agent-file-changes__count">{tc("files.changed", changes().length)}</span>
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
        <div class="agent-file-changes__diffs">
          <For each={changes()}>
            {(item) => (
              <section class="agent-file-change-diff" data-status={item.status}>
                <header class="agent-file-change-diff__head">
                  <div class="agent-file-change-diff__copy">
                    <span class="agent-file-change-diff__mark" aria-hidden="true">
                      {item.status === "added" ? "+" : item.status === "deleted" ? "-" : "~"}
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
      </section>
    </Show>
  )
}
