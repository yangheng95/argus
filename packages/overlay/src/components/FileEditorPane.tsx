import { createEffect, createMemo, createResource, createSignal, Show } from "solid-js"
import { apiJson } from "../services/api"
import {
  closeFileEditor,
  selectedFileTarget,
  shortWorkbenchPath,
  type FileContent,
  type FileEditorTarget,
} from "../services/file-workbench"
import { projectScopedPath } from "../services/project-directory"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { CodeEditor } from "./primitives/CodeEditor"
import { Button } from "./ui/Button"

function fileContentPath(target: FileEditorTarget): string {
  const query = new URLSearchParams({
    path: target.path,
    directory: target.directory,
  })
  return `file/content?${query.toString()}`
}

async function readFileContent(target: FileEditorTarget | null): Promise<FileContent | null> {
  if (!target) return null
  return (await apiJson(fileContentPath(target))) as FileContent
}

async function writeFileContent(target: FileEditorTarget, content: string): Promise<FileContent> {
  return (await apiJson(projectScopedPath("file/content", target.directory), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: target.path, content }),
  })) as FileContent
}

function canEdit(content: FileContent | null | undefined): boolean {
  return !!content && content.type === "text" && !content.encoding
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function FileEditorPane() {
  const [draft, setDraft] = createSignal("")
  const [savedContent, setSavedContent] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")
  const [loadError, setLoadError] = createSignal("")

  const [content, { mutate }] = createResource(
    () => selectedFileTarget(),
    async (target) => {
      try {
        const next = await readFileContent(target)
        setLoadError("")
        return next
      } catch (err) {
        setLoadError(errorMessage(err))
        return null
      }
    },
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

  const target = createMemo(() => selectedFileTarget())
  const path = createMemo(() => target()?.path ?? "")
  const contentLoadError = createMemo(() => loadError())
  const editable = createMemo(() => canEdit(content()))
  const dirty = createMemo(() => editable() && draft() !== savedContent())

  const save = async () => {
    const file = target()
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
              <span class="file-editor-dirty" aria-label={t("file_editor.unsaved")}>
                *
              </span>
            </Show>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            tone={dirty() ? "accent" : "neutral"}
            data-ui="file-editor-save"
            data-dirty={dirty() ? "true" : "false"}
            disabled={!dirty() || saving()}
            onClick={() => void save()}
          >
            {saving() ? t("common.saving") : t("common.save")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-chrome="icon-action"
            data-ui="file-editor-close"
            onClick={closeFileEditor}
            title={t("workspace.close")}
            aria-label={t("workspace.close")}
          >
            <Icon name="close" size={13} />
          </Button>
        </header>
        <div class="file-editor-body">
          <Show
            when={!content.loading}
            fallback={
              <div class="file-editor-empty">
                <p>{t("diff.loading")}</p>
              </div>
            }
          >
            <Show
              when={!contentLoadError()}
              fallback={
                <div class="file-editor-empty" data-ui="file-editor-load-error">
                  <Icon name="status-failed" size={18} />
                  <p>{t("file_editor.load_failed", { message: contentLoadError() })}</p>
                </div>
              }
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
                  path={path()}
                  ariaLabel={t("file_editor.title")}
                  onValueChange={setDraft}
                />
              </Show>
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
