// ── TaskProgressBar ──
//
// Sticky one-row goal progress strip rendered at the top of the
// Conversation panel. Reads `boardStore.board.goalWorkflows` so it shows
// EVERY goal the architect emitted — including pending ones that haven't
// been dispatched yet. Operators no longer need to hunt the right pane
// or scroll the timeline to answer "how much of this task is done".
//
// The component intentionally renders no per-goal action buttons: it is
// a status overview, not a control surface. Per-goal actions remain on
// the right-pane GoalWorkflowList, and per-card rewind/copy stays on
// each card. Bottom-line "click goal pill → scroll to its card" is the
// only interaction; everything else is read-only.
//
// We do NOT mutate cardTreeStore here — spec 07 requires tree-writer
// to be the single writer. This component is purely a derived view of
// boardStore + cardTreeStore (for scroll target lookup).

import { For, Show, createMemo } from "solid-js";
import { boardStore } from "../store/board";
import { cardTreeStore } from "../store/card-tree";
import { t } from "../utils/i18n";
import { goalRevisionLabelFromIndexes } from "../utils/goal-label";
import { goalState, type GoalState } from "../utils/goal-state";

interface GoalPill {
  goalID: string;
  index: number;
  attempt: number;
  title: string;
  state: GoalState;
}

function pillStateLabel(state: GoalState, title: string): string {
  // Static `t(\`progress.goal.${state}\`)` so the i18n linter sees
  // "progress.goal" as a referenced prefix (template-literal head + dot
  // matches its ancestor rule).
  return t(`progress.goal.${state}`, { title });
}

/** Find the on-screen card id that represents this goal's most recent
 *  attempt, so clicking the pill scrolls the timeline to it. We use
 *  cardTreeStore directly — the writer creates step cards with ids that
 *  contain the goalID. Best-effort: if there's no matching card yet
 *  (goal still pending dispatch) the click is a noop. */
function findGoalCardID(goalID: string): string | undefined {
  const ids = cardTreeStore.order;
  for (let i = ids.length - 1; i >= 0; i--) {
    const card = cardTreeStore.cards[ids[i]];
    if (!card) continue;
    if (card.goalID === goalID) return card.id;
  }
  return undefined;
}

export function TaskProgressBar() {
  const goals = createMemo<GoalPill[]>(() => {
    const list = (boardStore.board as any)?.goalWorkflows;
    if (!Array.isArray(list) || list.length === 0) return [];
    return list.map((g: any, i: number): GoalPill => ({
      goalID: String(g?.goalID || `goal-${i}`),
      index: typeof g?.orderIndex === "number" ? g.orderIndex : i,
      attempt: typeof g?.retryCount === "number" ? g.retryCount : 0,
      title: String(g?.goalTitle || "").trim() || `Goal ${i + 1}`,
      state: goalState(g),
    }));
  });

  const counts = createMemo(() => {
    const all = goals();
    let passed = 0;
    let failed = 0;
    let running = 0;
    for (const g of all) {
      if (g.state === "passed") passed++;
      else if (g.state === "failed") failed++;
      else if (g.state === "running") running++;
    }
    return { passed, failed, running, total: all.length };
  });

  const hasGoals = () => goals().length > 0;

  const onPillClick = (goalID: string) => {
    const cardID = findGoalCardID(goalID);
    if (!cardID) return;
    // Stable id selector — Card writes article[data-kind][data-stage]
    // but no `data-card-id`. Use a CSS-attribute selector that matches
    // the article whose React/Solid key was this id. We tag the article
    // with `id={cardID}` via a separate scroll target attribute.
    // Falls back to no-op when the article isn't in the DOM yet.
    const escaped = (window as any).CSS?.escape ? (window as any).CSS.escape(cardID) : cardID;
    const node = document.querySelector(`[data-card-id="${escaped}"]`) as HTMLElement | null;
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <Show when={hasGoals()} fallback={null}>
      <div
        class="task-progress"
        role="region"
        aria-label={t("progress.heading")}
        data-running={counts().running > 0 ? "true" : undefined}
      >
        <div class="task-progress__header">
          <span class="task-progress__heading">{t("progress.heading")}</span>
          <span class="task-progress__summary" title={t("progress.summary", {
            passed: String(counts().passed),
            failed: String(counts().failed),
            running: String(counts().running),
            total: String(counts().total),
          })}>
            {counts().passed}/{counts().total}
          </span>
        </div>
        <div class="task-progress__bar" aria-hidden="true">
          <div
            class="task-progress__bar-fill"
            style={{
              width: `${counts().total === 0 ? 0 : Math.round((counts().passed / counts().total) * 100)}%`,
            }}
          />
          <Show when={counts().failed > 0}>
            <div
              class="task-progress__bar-fail"
              style={{
                width: `${Math.round((counts().failed / counts().total) * 100)}%`,
              }}
            />
          </Show>
        </div>
        <div class="task-progress__pills">
          <For each={goals()}>
            {(g) => (
              <button
                type="button"
                class="task-progress__pill"
                data-state={g.state}
                title={pillStateLabel(g.state, g.title)}
                aria-label={pillStateLabel(g.state, g.title)}
                onClick={() => onPillClick(g.goalID)}
              >
                <span class="task-progress__pill-id">
                  {goalRevisionLabelFromIndexes(g.index, g.attempt)}
                </span>
                <span class="task-progress__pill-title">{g.title}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
