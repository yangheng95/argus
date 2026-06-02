import { createEffect, createMemo, createResource, createSignal, Show } from "solid-js"
import { apiJson } from "../services/api"
import {
  closeFileEditor,
  selectedFilePath,
  shortWorkbenchPath,
  type FileContent,
} from "../services/file-workbench"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { CodeEditor } from "./primitives/CodeEditor"

async function readFileContent(path: string): Promise<FileContent | null> {
  if (!path) return null
  return await apiJson(`file/content?path=${encodeURIComponent(path)}`) as FileContent
}

async function writeFileContent(path: string, content: string): Promise<FileContent> {
  return await apiJson("file/content", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  }) as FileContent
}

function canEdit(content: FileContent | null | undefined): boolean {
  return !!content && content.type === "text" && !content.encoding
}

export function FileEditorPane() {
  const [draft, setDraft] = createSignal("")
  const [savedContent, setSavedContent] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")

  const [content, { mutate }] = createResource(
    () => selectedFilePath(),
    readFileContent,
  )

  createEffect(() => {
    const next = content()
    setError("")
    if (!canEdit(next)) {
      setDraft("")
      setSavedContent("")
      return
    }
    setDraft(next!.content)
    setSavedContent(next!.content)
  })

  const path = createMemo(() => selectedFilePath())
  const editable = createMemo(() => canEdit(content()))
  const dirty = createMemo(() => editable() && draft() !== savedContent())

  const save = async () => {
    const file = path()
    if (!file || !editable() || !dirty() || saving()) return
    setSaving(true)
    setError("")
    try {
      const next = await writeFileContent(file, draft())
      mutate(next)
      setSavedContent(next.content)
      setDraft(next.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section class="file-editor-pane" aria-label={t("file_editor.title")}>
      <Show
        when={path()}
        fallback={
          <div class="file-editor-empty">
            <Icon name="file-document" size={18} />
            <p>{t("file_editor.empty")}</p>
          </div>
        }
      >
        <header class="file-editor-header">
          <div class="file-editor-title" title={path()}>
            <span class="file-editor-title-name">{shortWorkbenchPath(path())}</span>
            <Show when={dirty()}>
              <span class="file-editor-dirty" aria-label={t("file_editor.unsaved")}>*</span>
            </Show>
          </div>
          <button
            type="button"
            class="file-editor-save"
            data-dirty={dirty() ? "true" : "false"}
            disabled={!dirty() || saving()}
            onClick={() => void save()}
          >
            {saving() ? t("common.saving") : t("common.save")}
          </button>
          <button
            type="button"
            class="file-editor-close"
            onClick={closeFileEditor}
            title={t("workspace.close")}
            aria-label={t("workspace.close")}
          >
            <Icon name="close" size={13} />
          </button>
        </header>
        <div class="file-editor-body">
          <Show
            when={!content.loading}
            fallback={<div class="file-editor-empty"><p>{t("diff.loading")}</p></div>}
          >
            <Show
              when={editable()}
              fallback={
                <div class="file-editor-empty">
                  <Icon name="file-document" size={18} />
                  <p>{t("file_editor.binary")}</p>
                </div>
              }
            >
              <CodeEditor
                value={draft()}
                ariaLabel={t("file_editor.title")}
                onValueChange={setDraft}
              />
            </Show>
          </Show>
        </div>
        <Show when={error()}>
          <footer class="file-editor-error">{error()}</footer>
        </Show>
      </Show>
    </section>
  )
}
