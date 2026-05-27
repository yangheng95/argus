// ── FilesSection ──
// Collapsible "Files" section in the right column. Owns visibility:
// hidden when a task is selected but has produced zero changes — same
// rule the previous imperative `document.getElementById("changesSection").hidden`
// effect inside ChangesPanel enforced.

import { createMemo, Show } from "solid-js";
import { ChangesPanel } from "./ChangesPanel";
import { boardStore,
  activeTaskID,
} from "../store/board";
import { Icon } from "./Icon";
import { Section } from "./primitives/Section";
import { currentChangeGroups } from "../services/diff";
import { t } from "../utils/i18n";

export function FilesSection() {
  const hasSelectedTask = createMemo(() => Boolean(activeTaskID()));
  const totalFiles = createMemo(() =>
    currentChangeGroups().reduce((sum, group) => sum + group.changes.length, 0),
  );
  // Hide the entire section when a task is selected but has zero file changes.
  // Without a selected task we still show the collapsible (empty-hint guides
  // the operator to pick a target) — matches prior behaviour.
  const sectionVisible = createMemo(() => !hasSelectedTask() || totalFiles() > 0);

  return (
    <Show when={sectionVisible()}>
      <Section
        id="changesSection"
        title={t("section.files")}
        icon={<Icon name="file-document" />}
        defaultOpen
      >
        <ChangesPanel hasSelectedTask={hasSelectedTask()} />
      </Section>
    </Show>
  );
}
