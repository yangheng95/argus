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
// each card. Bottom-line "click goal pill -> scroll to its card" is the
// only per-goal interaction; the header exposes only a whole-strip fold.
//
// We do NOT mutate cardTreeStore here — spec 07 requires tree-writer
// to be the single writer. This component is purely a derived view of
// boardStore + cardTreeStore (for scroll target lookup).

import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { boardStore } from "../store/board";
import { cardTreeStore } from "../store/card-tree";
import { requestConversationCardScroll } from "../services/conversation-scroll";
import { t } from "../utils/i18n";
import { goalRevisionLabelFromIndexes } from "../utils/goal-label";
import { goalState, type GoalState } from "../utils/goal-state";
import { Icon } from "./Icon";

/** Visible pill rows before the strip collapses behind a "+N more" toggle.
 *  Operators scanning a long task want the goal list visible at a glance, not
 *  pushing the conversation down by 8+ rows. Three rows fits ~6–12 pills in a
 *  typical conversation column and keeps the sticky header light. */
const MAX_VISIBLE_PILL_ROWS = 3;

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

  // ── Auto-collapse beyond MAX_VISIBLE_PILL_ROWS ──
  // A ResizeObserver on the pills container measures the offsetTop of each
  // pill to count visual rows (pill heights are not deterministic — they
  // depend on UI scale, font, and pill-title length when wrapped). When the
  // natural layout would exceed 3 rows we expose a `+N more` toggle; under
  // the limit the toggle stays hidden and the strip is unconstrained.
  let pillsEl: HTMLDivElement | undefined;
  const [folded, setFolded] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [hiddenCount, setHiddenCount] = createSignal(0);
  const [collapsedMaxHeight, setCollapsedMaxHeight] = createSignal<number | null>(null);

  const remeasure = () => {
    const el = pillsEl;
    if (!el) return;
    const pills = el.querySelectorAll<HTMLElement>(".task-progress__pill");
    if (pills.length === 0) {
      setHiddenCount(0);
      setCollapsedMaxHeight(null);
      return;
    }
    // Group pills by their offsetTop (rounded to the nearest pixel to absorb
    // sub-pixel layout drift). Even when the container is collapsed, each
    // pill's offsetTop still reports its natural position relative to the
    // flex container — only paint is clipped — so this measurement works in
    // both expanded and collapsed states.
    const rowTops: number[] = [];
    let lastTop = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pills.length; i++) {
      const top = Math.round(pills[i].offsetTop);
      if (top > lastTop + 1) {
        rowTops.push(top);
        lastTop = top;
      }
    }
    if (rowTops.length <= MAX_VISIBLE_PILL_ROWS) {
      setHiddenCount(0);
      setCollapsedMaxHeight(null);
      return;
    }
    const firstHiddenTop = rowTops[MAX_VISIBLE_PILL_ROWS];
    let firstHiddenIndex = pills.length;
    for (let i = 0; i < pills.length; i++) {
      if (Math.round(pills[i].offsetTop) >= firstHiddenTop) {
        firstHiddenIndex = i;
        break;
      }
    }
    setHiddenCount(pills.length - firstHiddenIndex);
    // Clip the container exactly at the first-hidden-row top so the last
    // visible row never gets truncated mid-pill.
    setCollapsedMaxHeight(firstHiddenTop);
  };

  onMount(() => {
    if (!pillsEl) return;
    // Initial measure (microtask so the first paint has flushed).
    queueMicrotask(remeasure);
    const ro = new ResizeObserver(remeasure);
    ro.observe(pillsEl);
    // Pill children may resize independently of the container (i18n switch
    // changes label length; UI scale changes pill padding). Observe each pill
    // to catch those cases too.
    const observed = new WeakSet<Element>();
    const observePills = () => {
      if (!pillsEl) return;
      for (const pill of pillsEl.querySelectorAll<HTMLElement>(".task-progress__pill")) {
        if (!observed.has(pill)) {
          ro.observe(pill);
          observed.add(pill);
        }
      }
    };
    observePills();
    const mo = new MutationObserver(() => {
      observePills();
      remeasure();
    });
    mo.observe(pillsEl, { childList: true, subtree: false });
    onCleanup(() => {
      ro.disconnect();
      mo.disconnect();
    });
  });

  const onPillClick = (goalID: string) => {
    const cardID = findGoalCardID(goalID);
    if (!cardID) return;
    void requestConversationCardScroll({
      cardID,
      behavior: "smooth",
      block: "start",
      focus: "card",
    });
  };

  return (
    <Show when={hasGoals()} fallback={null}>
      <div
        class="task-progress"
        role="region"
        aria-label={t("progress.heading")}
        data-folded={folded() ? "true" : "false"}
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
          <button
            type="button"
            class="task-progress__fold"
            aria-expanded={folded() ? "false" : "true"}
            aria-controls="taskProgressPills"
            title={folded() ? t("progress.expand_card") : t("progress.collapse_card")}
            aria-label={folded() ? t("progress.expand_card") : t("progress.collapse_card")}
            onClick={() => setFolded((value) => !value)}
          >
            <Icon name={folded() ? "chevron-down" : "chevron-up"} size={12} />
          </button>
        </div>
        <div class="task-progress__bar" aria-hidden="true">
          <div
            class="task-progress__bar-fill"
            style={{
              "--progress-passed": `${counts().total === 0 ? 0 : Math.round((counts().passed / counts().total) * 100)}%`,
            }}
          />
          <Show when={counts().failed > 0}>
            <div
              class="task-progress__bar-fail"
              style={{
                "--progress-failed": `${Math.round((counts().failed / counts().total) * 100)}%`,
              }}
            />
          </Show>
        </div>
        <div
          id="taskProgressPills"
          ref={pillsEl}
          class="task-progress__pills"
          data-collapsed={hiddenCount() > 0 && !expanded() ? "true" : "false"}
          style={
            hiddenCount() > 0 && !expanded() && collapsedMaxHeight() !== null
              ? { "max-height": `${collapsedMaxHeight()}px` }
              : undefined
          }
        >
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
        <Show when={hiddenCount() > 0}>
          <button
            type="button"
            class="task-progress__toggle"
            aria-expanded={expanded() ? "true" : "false"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded()
              ? t("progress.collapse")
              : t("progress.expand_more", { count: String(hiddenCount()) })}
          </button>
        </Show>
      </div>
    </Show>
  );
}
