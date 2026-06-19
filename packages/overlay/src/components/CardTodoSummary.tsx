import { Show } from "solid-js"

import type { TodoSummary } from "../utils/card-tree"
import { t } from "../utils/i18n"

function todoProgressPct(summary: TodoSummary): number {
  if (summary.total === 0) return 0
  return Math.round((summary.completed / summary.total) * 100)
}

export function todoProgressText(summary: TodoSummary): string {
  const vars = {
    completed: String(summary.completed),
    total: String(summary.total),
    current: summary.current,
  }
  return summary.current ? t("todo.progress_value_current", vars) : t("todo.progress_value", vars)
}

export function CardTodoSummary(props: { summary: TodoSummary }) {
  const progressText = () => todoProgressText(props.summary)

  return (
    <span class="card__todo-summary" title={progressText()}>
      <span
        class="card__todo-progress"
        role="progressbar"
        aria-label={t("todo.progress_label")}
        aria-valuenow={props.summary.completed}
        aria-valuemin={0}
        aria-valuemax={props.summary.total}
        aria-valuetext={progressText()}
        style={{ "--pct": `${todoProgressPct(props.summary)}%` }}
      />
      <span class="card__todo-count">
        {props.summary.completed}/{props.summary.total}
      </span>
      <Show when={props.summary.current}>
        <span class="card__todo-current">{props.summary.current}</span>
      </Show>
    </span>
  )
}
