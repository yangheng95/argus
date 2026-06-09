/**
 * EvaluationCriteriaPanel
 *
 * Renders the task-level rollup of every quality criterion that touched the
 * task — per-goal evaluator outcomes, integrity acceptance review, and
 * external quality gates (e.g. visual-diff). Data comes from
 * `board.criteriaResults`, which the backend assembles from
 * `task.metadata.criteria_results`.
 *
 * This panel was removed in commit 980c3c54 (unified data-driven Board
 * refactor) along with the legacy hand-coded check catalogue. We've brought
 * it back as a data-driven view: whatever the backend reports gets grouped
 * by `family` and displayed with status + evidence. There is no client-side
 * list of "known checks" — the source of truth is whoever recorded the
 * criterion (integrity review, benchmark, etc).
 */
import { For, Show } from "solid-js"
import { familyOrder, familyLabel } from "../utils/criteria"
import { goalStatusToTaskStatus, statusIconName } from "../utils/status-mapping"
import { Icon } from "./Icon"

interface CriteriaCheck {
  name: string
  label?: string
  family?: string
  status: "passed" | "failed" | "skipped"
  evidence?: string
}

interface Props {
  checks: CriteriaCheck[]
}

function groupByFamily(checks: CriteriaCheck[]) {
  const groups = new Map<string, CriteriaCheck[]>()
  for (const c of checks) {
    const key = familyLabel(c.family)
    const list = groups.get(key) ?? []
    list.push(c)
    groups.set(key, list)
  }
  return [...groups.entries()].sort(([a], [b]) => familyOrder(a) - familyOrder(b))
}

export function EvaluationCriteriaPanel(props: Props) {
  const groups = () => groupByFamily(props.checks ?? [])
  const summary = () => {
    const passed = props.checks.filter((c) => c.status === "passed").length
    const failed = props.checks.filter((c) => c.status === "failed").length
    const skipped = props.checks.filter((c) => c.status === "skipped").length
    return { passed, failed, skipped, total: props.checks.length }
  }

  return (
    <div class="criteria-panel">
      <div class="criteria-summary">
        <span class="criteria-summary-item criteria-summary-item--passed">
          <Icon name={statusIconName(goalStatusToTaskStatus("passed"))} /> {summary().passed}
        </span>
        <span class="criteria-summary-item criteria-summary-item--failed">
          <Icon name={statusIconName(goalStatusToTaskStatus("failed"))} /> {summary().failed}
        </span>
        <Show when={summary().skipped > 0}>
          <span class="criteria-summary-item criteria-summary-item--skipped">
            <Icon name={statusIconName(goalStatusToTaskStatus("skipped"))} /> {summary().skipped}
          </span>
        </Show>
      </div>
      <For each={groups()}>
        {([family, items]) => (
          <div class="criteria-family">
            <div class="criteria-family-head">{family}</div>
            <ul class="criteria-list">
              <For each={items}>
                {(item) => (
                  <li class="criteria-item" data-criteria-status={item.status}>
                    <span class="criteria-status" data-result={item.status}>
                      <Icon name={statusIconName(goalStatusToTaskStatus(item.status))} />
                    </span>
                    <span class="criteria-name">{item.label || item.name}</span>
                    <Show when={item.evidence}>
                      <div class="criteria-evidence">{item.evidence}</div>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </div>
  )
}
