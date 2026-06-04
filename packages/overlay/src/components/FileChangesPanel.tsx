import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import type { DiffTarget } from "../services/diff"
import { t } from "../utils/i18n"
import { ChangesPanel } from "./ChangesPanel"
import { DiffPreviewPanel } from "./DiffPreviewPanel"
import { Icon } from "./Icon"

export interface FileChangesPanelProps {
  diffOpen: boolean
  diffTarget: DiffTarget
  onCloseDiff: () => void
}

export function FileChangesPanel(props: FileChangesPanelProps) {
  const [activeView, setActiveView] = createSignal<"changes" | "diff">("changes")
  const hasDiff = createMemo(() => props.diffOpen && !!props.diffTarget?.filePath)

  createEffect(() => {
    if (hasDiff()) setActiveView("diff")
  })

  onMount(() => {
    const handler = () => setActiveView("changes")
    window.addEventListener("acceptance:focus-changes", handler)
    onCleanup(() => window.removeEventListener("acceptance:focus-changes", handler))
  })

  return (
    <section class="file-changes-panel" data-active-view={activeView()} aria-label={t("section.files")}>
      <header class="file-changes-switcher" aria-label={t("section.files")}>
        <button
          type="button"
          class="file-changes-tab"
          data-active={activeView() === "changes" ? "true" : "false"}
          onClick={() => setActiveView("changes")}
        >
          <Icon name="file-document" size={13} />
          <span>{t("files.changes")}</span>
        </button>
        <button
          type="button"
          class="file-changes-tab"
          data-active={activeView() === "diff" ? "true" : "false"}
          disabled={!hasDiff()}
          onClick={() => setActiveView("diff")}
        >
          <Icon name="panel-right" size={13} />
          <span>{t("workspace.diff")}</span>
        </button>
      </header>
      <div class="file-changes-body">
        <section class="file-changes-view" data-active={activeView() === "changes" ? "true" : "false"}>
          <ChangesPanel hasSelectedTask />
        </section>
        <section class="file-changes-view file-changes-diff" data-active={activeView() === "diff" ? "true" : "false"}>
          <Show
            when={hasDiff()}
            fallback={
              <div class="file-editor-empty">
                <Icon name="file-document" size={18} />
                <p>{t("diff.select_file")}</p>
              </div>
            }
          >
            <header class="file-changes-diff-header">
              <span>{t("workspace.diff")}</span>
              <button
                type="button"
                class="workspace-close"
                title={t("workspace.close")}
                aria-label={t("workspace.close")}
                onClick={props.onCloseDiff}
              >
                <Icon name="close" size={13} />
              </button>
            </header>
            <DiffPreviewPanel target={props.diffTarget} />
          </Show>
        </section>
      </div>
    </section>
  )
}
