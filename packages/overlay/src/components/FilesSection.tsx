// ── FilesSection ──
// Top-level right-panel Files tab. The tab stays mounted so delivery
// focus events can retarget the selected goal without remount churn.

import { createMemo } from "solid-js"
import { ChangesPanel } from "./ChangesPanel"
import { activeTaskID } from "../store/board"
import { t } from "../utils/i18n"

export function FilesSection() {
  const hasSelectedTask = createMemo(() => Boolean(activeTaskID()))

  return (
    <section class="files-tab-panel" id="changesSection" aria-label={t("section.files")}>
      <ChangesPanel hasSelectedTask={hasSelectedTask()} />
    </section>
  )
}
