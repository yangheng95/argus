import { createMemo, Show } from "solid-js"
import type { CardNode } from "../store/card-tree"
import { boardStore, selectedTaskDirectory } from "../store/board"
import { collectAgentFileChangeGroups } from "../utils/file-change-summary"
import { t } from "../utils/i18n"
import { FileChangesView } from "./FileChangesView"

export function AgentFileChanges(props: { node: CardNode }) {
  const groups = createMemo(() =>
    collectAgentFileChangeGroups(
      props.node,
      selectedTaskDirectory(),
      (boardStore.board as any)?.goalWorkflows,
    ),
  )
  const filesCount = createMemo(() =>
    groups().reduce((sum, group) => sum + group.changes.length, 0),
  )

  return (
    <Show when={filesCount() > 0}>
      <section class="agent-file-changes" aria-label={t("section.files")}>
        <FileChangesView groups={groups()} showHeading />
      </section>
    </Show>
  )
}
