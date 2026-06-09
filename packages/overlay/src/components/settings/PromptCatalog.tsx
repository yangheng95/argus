// ── PromptCatalog ──
// Solid.js component that renders the prompt override editor.
// Data source: appStore.promptEntries (populated when Settings data loads).
// Save/reset: delegates to config.ts savePromptEntry / resetPromptEntry
// which use the correct PATCH /config mechanism.

import { createSignal, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { t } from "../../utils/i18n"
import { renderMarkdown } from "../../utils/markdown"
import { appStore } from "../../store/app"
import {
  savePromptEntry as serviceSave,
  resetPromptEntry as serviceReset,
  loadPromptCatalog,
} from "../../services/config"
import { Button } from "../ui/Button"
import { Tab, Tabs } from "../ui/Tabs"

// ── Types ──

interface PromptEntry {
  key: string
  label?: string
  group: string
  mode?: string
  scope: string
  description?: string
  inherits_core?: boolean
  prompt?: string
  effective_prompt?: string
  configured_prompt: string | null
  default_prompt?: string
  prompt_mode?: "override" | "append"
}

interface PromptStatus {
  label: string
  tone: string
}

type PromptViewMode = "code" | "preview" | "default"

// ── Helpers ──

function promptEntryID(entry: PromptEntry): string {
  return `${entry.scope}:${entry.key}`
}

function promptGroupLabel(group: string): string {
  if (group === "core") return t("prompt.group.core")
  if (group === "generator") return t("prompt.group.generator")
  if (group === "assistant") return t("prompt.group.assistant")
  if (group === "subagent") return t("prompt.group.subagent")
  if (group === "hidden_agent") return t("prompt.group.hidden_agent")
  if (group === "custom_agent") return t("prompt.group.custom_agent")
  return t("prompt.group.primary_agent")
}

function promptDescription(entry: PromptEntry): string {
  if (entry.key === "core_header") return t("prompt.desc.core_header")
  if (entry.key === "agent_generate") return t("prompt.desc.agent_generate")
  return entry.description || ""
}

function promptStatus(entry: PromptEntry): PromptStatus {
  if (entry.configured_prompt !== null) {
    return { label: t("prompt.status.custom"), tone: "active" }
  }
  if (entry.scope === "system") {
    return { label: t("prompt.status.default"), tone: "ready" }
  }
  if (entry.default_prompt) {
    return { label: t("prompt.status.default"), tone: "ready" }
  }
  if (entry.inherits_core) {
    return { label: t("prompt.status.inherits_core"), tone: "warn" }
  }
  if (entry.prompt) {
    return { label: t("prompt.status.default"), tone: "ready" }
  }
  return { label: t("prompt.status.empty"), tone: "" }
}

function promptPreviewHtml(value: string): string {
  if (!value.trim()) {
    return `<p class="empty-hint">${t("prompt.preview_empty")}</p>`
  }
  return renderMarkdown(value)
}

// ── Component ──

export default function PromptCatalog() {
  const [drafts, setDrafts] = createStore<Record<string, string>>({})
  const [viewModes, setViewModes] = createStore<Record<string, PromptViewMode>>({})
  const [notice, setNotice] = createSignal("")
  const [noticeTone, setNoticeTone] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  // Data source: reactive from appStore (populated by Settings data loading)
  const entries = createMemo((): PromptEntry[] => {
    const raw = appStore.promptEntries
    return Array.isArray(raw) ? (raw as PromptEntry[]) : []
  })

  function draftValue(entry: PromptEntry): string {
    const id = promptEntryID(entry)
    // Access via proxy to track reactivity; undefined means no draft
    const val = (drafts as Record<string, string>)[id]
    return val !== undefined ? val : entry.prompt || ""
  }

  function isDirty(entry: PromptEntry): boolean {
    return draftValue(entry) !== (entry.prompt || "")
  }

  function viewMode(entryID: string): PromptViewMode {
    return (viewModes as Record<string, PromptViewMode>)[entryID] || "code"
  }

  function setViewMode(entryID: string, mode: PromptViewMode) {
    setViewModes(entryID, mode)
  }

  function handleDraftChange(entryID: string, value: string) {
    setDrafts(entryID, value)
  }

  async function handleSave(entry: PromptEntry) {
    const value = draftValue(entry)
    setSaving(true)
    try {
      await serviceSave(entry, value)
      // Clear draft after successful save (catalog reloads from store)
      const id = promptEntryID(entry)
      setDrafts(id, undefined as any)
      showNotice(t("common.saved"), "active")
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleReset(entry: PromptEntry) {
    const entryID = promptEntryID(entry)
    if (entry.configured_prompt === null) {
      // No server override — just reset local draft
      setDrafts(entryID, entry.prompt || "")
      return
    }
    setSaving(true)
    try {
      await serviceReset(entry)
      setDrafts(entryID, undefined as any)
      showNotice(t("prompt.reset_done"), "active")
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error")
    } finally {
      setSaving(false)
    }
  }

  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  function showNotice(msg: string, tone = "") {
    if (noticeTimer) clearTimeout(noticeTimer)
    setNotice(msg)
    setNoticeTone(tone)
    if (msg) {
      noticeTimer = setTimeout(() => setNotice(""), 2600)
    }
  }

  const configuredCount = createMemo(() => entries().filter((e) => e.configured_prompt !== null).length)

  return (
    <>
      <Show when={notice()}>
        <div class="config-status-box" data-status={noticeTone()}>
          {notice()}
        </div>
      </Show>

      <Show when={entries().length > 0} fallback={<div class="empty-hint">{t("prompt.none")}</div>}>
        <div class="prompt-grid">
          <For each={entries()}>
            {(entry) => {
              const entryID = promptEntryID(entry)
              const status = createMemo(() => promptStatus(entry))
              const description = promptDescription(entry)
              const dirty = createMemo(() => isDirty(entry))
              const currentDraft = createMemo(() => draftValue(entry))
              const canShowDefault = () => !!entry.default_prompt

              return (
                <div class="prompt-card" data-prompt-entry={entryID}>
                  <div class="prompt-card-head">
                    <div class="prompt-card-copy">
                      <strong>{entry.label || entry.key}</strong>
                      <span>
                        {promptGroupLabel(entry.group)}
                        {entry.mode ? ` · ${entry.mode}` : ""}
                        {entry.inherits_core ? " · ← core_header" : ""}
                      </span>
                      <Show when={description}>
                        <small>{description}</small>
                      </Show>
                    </div>
                    <Show when={status().tone !== "ready"}>
                      <span class="extension-status" data-state={status().tone}>
                        {status().label}
                      </span>
                    </Show>
                  </div>

                  <div class="prompt-editor">
                    <div class="prompt-editor-head">
                      <Tabs
                        size="sm"
                        tone="neutral"
                        value={viewMode(entryID)}
                        onValueChange={(value) => setViewMode(entryID, value as PromptViewMode)}
                        aria-label={t("prompt.title")}
                        data-ui="prompt-view-tabs"
                      >
                        <Tab
                          value="code"
                          active={viewMode(entryID) === "code"}
                          size="sm"
                          tone="neutral"
                          data-ui="prompt-view-tab"
                        >
                          {t("prompt.editor_label")}
                        </Tab>
                        <Tab
                          value="preview"
                          active={viewMode(entryID) === "preview"}
                          size="sm"
                          tone="neutral"
                          data-ui="prompt-view-tab"
                        >
                          {t("prompt.preview")}
                        </Tab>
                        <Show when={canShowDefault()}>
                          <Tab
                            value="default"
                            active={viewMode(entryID) === "default"}
                            size="sm"
                            tone="neutral"
                            data-ui="prompt-view-tab"
                          >
                            {t("prompt.default_label")}
                          </Tab>
                        </Show>
                      </Tabs>
                      <div class="prompt-editor-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          tone="neutral"
                          disabled={saving() || (entry.configured_prompt === null && !dirty())}
                          onClick={() => handleReset(entry)}
                        >
                          {t("prompt.reset")}
                        </Button>
                        <Button
                          type="button"
                          variant="solid"
                          size="sm"
                          tone="accent"
                          disabled={saving() || !dirty()}
                          onClick={() => handleSave(entry)}
                        >
                          {t("common.save")}
                        </Button>
                      </div>
                    </div>
                    <Show
                      when={viewMode(entryID) !== "code"}
                      fallback={
                        <textarea
                          class="field-input prompt-textarea"
                          rows={8}
                          value={currentDraft()}
                          disabled={saving()}
                          aria-label={t("prompt.editor_label")}
                          onInput={(e) => handleDraftChange(entryID, e.currentTarget.value)}
                        />
                      }
                    >
                      <Show
                        when={viewMode(entryID) === "default" && canShowDefault()}
                        fallback={
                          <div class="prompt-preview-card prompt-preview-card--attached">
                            <div class="md-content prompt-preview-body" innerHTML={promptPreviewHtml(currentDraft())} />
                          </div>
                        }
                      >
                        <div class="prompt-preview-card prompt-preview-card--attached">
                          <div
                            class="md-content prompt-preview-body"
                            innerHTML={promptPreviewHtml(entry.default_prompt || "")}
                          />
                        </div>
                      </Show>
                    </Show>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </>
  )
}
