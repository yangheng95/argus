// ── ChangesPanel Component ──
// Shows changed files for the selected task. Clicking a row resolves the same
// shared diff data that the workspace preview uses; FileChangesView renders the
// result inline below the row.

import { createMemo, createResource } from "solid-js"
import { boardStore, activeTaskID } from "../store/board"
import { cardTreeStore, type CardNode } from "../store/card-tree"
import {
  changeGroupsRevisionKey,
  currentChangeGroups,
  resolveCurrentChangeGroups,
  resolveDiff,
  type ChangeGroup,
  type DiffTarget,
} from "../services/diff"
import { collectAgentFileChangeGroupsFromNodes, mergeChangeGroups } from "../utils/file-change-summary"
import type { FileChange } from "./DiffView"
import { FileChangesView } from "./FileChangesView"

// ── ChangesPanel ──

export interface ChangesPanelProps {
  /** File changes to display. If omitted, the shared diff service supplies board-derived groups. */
  changes?: FileChange[]
  /** Whether a task is currently selected (affects empty-state messaging). */
  hasSelectedTask?: boolean
  /** Whether the file changes surface is visible enough to run broad card-tree projections. */
  active?: () => boolean
}

export function ChangesPanel(props: ChangesPanelProps) {
  const panelActive = () => props.active?.() ?? true

  const agentGroups = createMemo<ChangeGroup[]>(() => {
    if (!panelActive()) return []
    const board = boardStore.board as any
    const roots = cardTreeStore.order.map((id) => cardTreeStore.cards[id]).filter((node): node is CardNode => !!node)
    return collectAgentFileChangeGroupsFromNodes(roots, String(board?.task?.directory || ""), board?.goalWorkflows)
  })

  const sourceGroups = createMemo<ChangeGroup[]>(() => {
    if (!panelActive()) return []
    if (props.changes === undefined) return currentChangeGroups()
    const changes = props.changes
    return [
      {
        id: "props",
        additions: changes.reduce((sum, item) => sum + (item.additions ?? 0), 0),
        deletions: changes.reduce((sum, item) => sum + (item.deletions ?? 0), 0),
        changes,
      },
    ]
  })

  const requestKey = createMemo(() => {
    if (!panelActive()) return false
    const groups = sourceGroups()
    const agentKey = changeGroupsRevisionKey(agentGroups())
    return props.changes !== undefined
      ? `props:${groups[0]?.changes.length ?? 0}`
      : `${activeTaskID()}:${agentKey}:${changeGroupsRevisionKey(groups)}`
  })

  const [resolvedGroups] = createResource(requestKey, async () => {
    if (!panelActive()) return []
    if (props.changes !== undefined) return sourceGroups()
    return resolveCurrentChangeGroups()
  })

  const groups = createMemo<ChangeGroup[]>(() =>
    !panelActive()
      ? []
      : props.changes === undefined
        ? mergeChangeGroups([...agentGroups(), ...(resolvedGroups() || sourceGroups())])
        : sourceGroups().filter((group) => group.changes.length > 0),
  )

  async function handleRowClick(group: ChangeGroup, item: FileChange) {
    const target: DiffTarget = {
      filePath: item.file,
      ...(group.goalRunID ? { goalRunID: group.goalRunID } : {}),
      ...(group.goalLabel ? { goalLabel: group.goalLabel } : {}),
    }
    void resolveDiff(target)
  }

  return (
    <FileChangesView
      groups={groups()}
      hasSelectedTask={props.hasSelectedTask}
      focusEvent="acceptance:focus-changes"
      onRowClick={handleRowClick}
    />
  )
}
