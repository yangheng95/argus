import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import type { DiffTarget } from "../services/diff"
import { t } from "../utils/i18n"
import { ChangesPanel } from "./ChangesPanel"
import { DiffPreviewPanel } from "./DiffPreviewPanel"
import { Icon } from "./Icon"

export interface RightFilesPanelProps {
  diffOpen: boolean
  diffTarget: DiffTarget
  onCloseDiff: () => void
}

export function RightFilesPanel(props: RightFilesPanelProps) {
  const [activeView, setActiveView] = createSignal<"changes" | "diff">("changes")
  const hasDiff = createMemo(() => props.diffOpen && !!props.diffTarget?.filePath)

  createEffect(() => {
    if (hasDiff()) setActiveView("diff")
  })

  onMount(() => {
    const handler = () => setActiveView("changes")
    window.addEventListener("delivery:focus-changes", handler)
    onCleanup(() => window.removeEventListener("delivery:focus-changes", handler))
  })

  return (
    <section class="right-files-panel" data-active-view={activeView()} aria-label={t("section.files")}>
      <header class="right-files-switcher" aria-label={t("section.files")}>
        <button
          type="button"
          class="right-files-tab"
          data-active={activeView() === "changes" ? "true" : "false"}
          onClick={() => setActiveView("changes")}
        >
          <Icon name="file-document" size={13} />
          <span>{t("files.changes")}</span>
        </button>
        <button
          type="button"
          class="right-files-tab"
          data-active={activeView() === "diff" ? "true" : "false"}
          disabled={!hasDiff()}
          onClick={() => setActiveView("diff")}
        >
          <Icon name="panel-right" size={13} />
          <span>{t("workspace.diff")}</span>
        </button>
      </header>
      <div class="right-files-body">
        <section class="right-files-view" data-active={activeView() === "changes" ? "true" : "false"}>
          <ChangesPanel hasSelectedTask />
        </section>
        <section class="right-files-view right-files-diff" data-active={activeView() === "diff" ? "true" : "false"}>
          <Show
            when={hasDiff()}
            fallback={
              <div class="file-editor-empty">
                <Icon name="file-document" size={18} />
                <p>{t("diff.select_file")}</p>
              </div>
            }
          >
            <header class="right-files-diff-header">
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
