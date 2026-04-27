// ── FilesSection ──
// Collapsible "Files" section in the right column. Owns visibility:
// hidden when a task is selected but has produced zero changes — same
// rule the previous imperative `document.getElementById("changesSection").hidden`
// effect inside ChangesPanel enforced. Lifting the `<details>` into a Solid
// component lets the same reactive memo drive everything (root, badge, body)
// without going around Solid's reactive graph.

import { createMemo, Show } from "solid-js";
import { ChangesPanel } from "./ChangesPanel";
import { boardStore } from "../store/board";
import { currentChangeGroups } from "../services/diff";
import { t } from "../utils/i18n";

export function FilesSection() {
  const hasSelectedTask = createMemo(() => Boolean(boardStore.selectedTaskID));
  const totalFiles = createMemo(() =>
    currentChangeGroups().reduce((sum, group) => sum + group.changes.length, 0),
  );
  // Hide the entire section when a task is selected but has zero file changes.
  // Without a selected task we still show the collapsible (empty-hint guides
  // the operator to pick a target) — matches prior behaviour.
  const sectionVisible = createMemo(() => !hasSelectedTask() || totalFiles() > 0);

  return (
    <Show when={sectionVisible()}>
      <details class="section" id="changesSection" open>
        <summary class="section-head">
          <span class="section-icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 2.5h5l3 3V13.5H4z"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linejoin="round"
              />
              <path
                d="M9 2.5v3h3"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linejoin="round"
              />
              <path
                d="M6 8h4M6 10.5h4"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="section-title">{t("section.files")}</span>
        </summary>
        <div class="section-body">
          <ChangesPanel hasSelectedTask={hasSelectedTask()} />
        </div>
      </details>
    </Show>
  );
}
