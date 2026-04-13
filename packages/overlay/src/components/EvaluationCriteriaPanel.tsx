/**
 * EvaluationCriteriaPanel
 *
 * Renders the task-level rollup of every quality criterion that touched the
 * task — per-goal evaluator outcomes, delivery agent verifications, and
 * external quality gates (e.g. visual-diff). Data comes from
 * `board.criteriaResults`, which the backend assembles from
 * `task.metadata.criteria_results`.
 *
 * This panel was removed in commit 980c3c54 (unified data-driven Board
 * refactor) along with the legacy hand-coded check catalogue. We've brought
 * it back as a data-driven view: whatever the backend reports gets grouped
 * by `family` and displayed with status + evidence. There is no client-side
 * list of "known checks" — the source of truth is whoever recorded the
 * criterion (delivery agent, benchmark, etc).
 */
import { For, Show } from "solid-js";

interface CriteriaCheck {
  name: string;
  label?: string;
  family?: string;
  status: "passed" | "failed" | "skipped";
  evidence?: string;
}

interface Props {
  checks: CriteriaCheck[];
}

const FAMILY_ORDER = ["command", "runtime", "artifact", "review", "acceptance", "custom", "other"] as const;

function familyOrder(family: string | undefined): number {
  const key = (family || "other").toLowerCase();
  const idx = FAMILY_ORDER.indexOf(key as (typeof FAMILY_ORDER)[number]);
  return idx === -1 ? FAMILY_ORDER.length : idx;
}

function familyLabel(family: string | undefined): string {
  return (family || "other").toLowerCase();
}

function statusIcon(status: string): string {
  if (status === "passed") return "✓";
  if (status === "failed") return "✗";
  if (status === "skipped") return "−";
  return "·";
}

function groupByFamily(checks: CriteriaCheck[]) {
  const groups = new Map<string, CriteriaCheck[]>();
  for (const c of checks) {
    const key = familyLabel(c.family);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  return [...groups.entries()].sort(
    ([a], [b]) => familyOrder(a) - familyOrder(b),
  );
}

export function EvaluationCriteriaPanel(props: Props) {
  const groups = () => groupByFamily(props.checks ?? []);
  const summary = () => {
    const passed = props.checks.filter((c) => c.status === "passed").length;
    const failed = props.checks.filter((c) => c.status === "failed").length;
    const skipped = props.checks.filter((c) => c.status === "skipped").length;
    return { passed, failed, skipped, total: props.checks.length };
  };

  return (
    <div class="criteria-panel">
      <div class="criteria-summary">
        <span class="criteria-summary-item criteria-summary-item--passed">
          {statusIcon("passed")} {summary().passed}
        </span>
        <span class="criteria-summary-item criteria-summary-item--failed">
          {statusIcon("failed")} {summary().failed}
        </span>
        <Show when={summary().skipped > 0}>
          <span class="criteria-summary-item criteria-summary-item--skipped">
            {statusIcon("skipped")} {summary().skipped}
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
                  <li class={`criteria-item criteria-item--${item.status}`}>
                    <span class="criteria-status" data-result={item.status}>
                      {statusIcon(item.status)}
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
  );
}
