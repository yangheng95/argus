import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { selectedFilePath, showWorkbenchPane } from "../services/file-workbench"
import type { DiffTarget } from "../services/diff"
import { t } from "../utils/i18n"
import { ChangesPanel } from "./ChangesPanel"
import { DiffPreviewPanel } from "./DiffPreviewPanel"
import { FileEditorPane } from "./FileEditorPane"
import { Icon } from "./Icon"

export interface MessageWorkbenchPaneProps {
  diffOpen: boolean
  diffTarget: DiffTarget
  onCloseDiff: () => void
}

export function MessageWorkbenchPane(props: MessageWorkbenchPaneProps) {
  const [activeView, setActiveView] = createSignal<"changes" | "detail">("changes")
  const [detailMode, setDetailMode] = createSignal<"diff" | "editor">("diff")
  const hasEditor = createMemo(() => !!selectedFilePath())
  const hasDiff = createMemo(() => props.diffOpen && !!props.diffTarget?.filePath)
  const hasDetail = createMemo(() => hasEditor() || hasDiff())

  createEffect(() => {
    if (hasDiff()) {
      setDetailMode("diff")
      setActiveView("detail")
    }
  })

  createEffect(() => {
    if (hasEditor() && !hasDiff()) {
      setDetailMode("editor")
      setActiveView("detail")
    }
  })

  createEffect(() => {
    if (!hasDetail()) setActiveView("changes")
  })

  onMount(() => {
    const handler = () => {
      setActiveView("changes")
      showWorkbenchPane()
    }
    window.addEventListener("delivery:focus-changes", handler)
    onCleanup(() => window.removeEventListener("delivery:focus-changes", handler))
  })

  const showDiff = createMemo(() => detailMode() === "diff" && hasDiff())
  const showEditor = createMemo(() => detailMode() === "editor" && hasEditor())

  return (
    <section class="message-workbench" data-active-view={activeView()} aria-label={t("section.files")}>
      <header class="message-workbench-switcher" aria-label={t("section.files")}>
        <button
          type="button"
          class="message-workbench-tab"
          data-active={activeView() === "changes" ? "true" : "false"}
          onClick={() => setActiveView("changes")}
        >
          <Icon name="file-document" size={13} />
          <span>{t("section.files")}</span>
        </button>
        <button
          type="button"
          class="message-workbench-tab"
          data-active={activeView() === "detail" ? "true" : "false"}
          disabled={!hasDetail()}
          onClick={() => setActiveView("detail")}
        >
          <Icon name="panel-right" size={13} />
          <span>{showEditor() ? t("file_editor.title") : t("workspace.diff")}</span>
        </button>
      </header>
      <div class="message-workbench-body">
        <aside class="message-workbench-changes" data-active={activeView() === "changes" ? "true" : "false"}>
          <ChangesPanel hasSelectedTask />
        </aside>
        <section class="message-workbench-detail" data-active={activeView() === "detail" ? "true" : "false"}>
          <Show
            when={hasDetail()}
            fallback={
              <div class="file-editor-empty">
                <Icon name="file-document" size={18} />
                <p>{t("diff.select_file")}</p>
              </div>
            }
          >
            <Show when={showEditor()}>
              <FileEditorPane />
            </Show>
            <Show when={showDiff()}>
              <section class="message-workbench-diff">
                <header class="message-workbench-diff-header">
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
              </section>
            </Show>
          </Show>
        </section>
      </div>
    </section>
  )
}
