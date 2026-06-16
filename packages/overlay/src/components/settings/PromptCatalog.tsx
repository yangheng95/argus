// ── PromptCatalog ──
// Solid.js component that renders both:
//   1. prompt profile inspection/customization
//   2. individual prompt override editing
// Data sources:
//   - appStore.promptEntries for per-slot prompt editing
//   - GET /config/prompt-profile for visible prompt-profile definitions
// Save/reset delegates to config service helpers so profile text never leaks
// into config.agent.* prompt fields.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { t } from "../../utils/i18n"
import { renderMarkdown } from "../../utils/markdown"
import { appStore } from "../../store/app"
import { settingsStore } from "../../store/settings"
import {
  createPromptProfileID,
  deletePromptProfile,
  loadPromptCatalog,
  loadPromptProfileCatalog,
  savePromptEntry as serviceSave,
  resetPromptEntry as serviceReset,
  savePromptProfile,
  setProjectPromptProfileActive,
  type PromptProfileCatalog as PromptProfileCatalogResponse,
  type PromptProfileDraft,
  type PromptProfileOption,
  type PromptProfileTarget,
} from "../../services/config"
import { Button } from "../ui/Button"
import { SurfaceHeader } from "../ui/SurfaceHeader"
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
  editable_prompt?: string
  effective_prompt?: string
  active_profile?: string
  profile_prompt?: string | null
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

function editablePrompt(entry: PromptEntry): string {
  return entry.editable_prompt ?? entry.prompt ?? ""
}

function compactProfileAgents(agents: Record<string, string> | undefined): Record<string, string> {
  if (!agents || typeof agents !== "object") return {}
  return Object.fromEntries(
    Object.entries(agents).flatMap(([targetID, prompt]) => {
      if (typeof prompt !== "string" || prompt.trim().length === 0) return []
      return [[targetID, prompt]]
    }),
  )
}

function promptProfileDraft(profile: PromptProfileOption | undefined): PromptProfileDraft {
  return {
    id: profile?.id ?? "",
    label: profile?.label ?? "",
    description: profile?.description ?? "",
    agents: compactProfileAgents(profile?.agents),
  }
}

function samePromptProfile(profile: PromptProfileOption | undefined, draft: PromptProfileDraft): boolean {
  return JSON.stringify(promptProfileDraft(profile)) === JSON.stringify({
    id: draft.id,
    label: draft.label,
    description: draft.description ?? "",
    agents: compactProfileAgents(draft.agents),
  })
}

function profileTypeLabel(profile: PromptProfileOption): string {
  return profile.built_in ? t("prompt_profile.built_in") : t("prompt_profile.custom")
}

function targetValue(draft: PromptProfileDraft, targetID: string): string {
  return draft.agents?.[targetID] ?? ""
}

// ── Component ──

export default function PromptCatalog() {
  const [drafts, setDrafts] = createStore<Record<string, string>>({})
  const [viewModes, setViewModes] = createStore<Record<string, PromptViewMode>>({})
  const [profileDraftState, setProfileDraftState] = createStore<PromptProfileDraft>({
    id: "",
    label: "",
    description: "",
    agents: {},
  })
  const [selectedProfileID, setSelectedProfileID] = createSignal("")
  const [profileCatalog, setProfileCatalog] = createSignal<PromptProfileCatalogResponse | null>(null)
  const [notice, setNotice] = createSignal("")
  const [noticeTone, setNoticeTone] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [profileLoading, setProfileLoading] = createSignal(false)

  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let promptProfileLoadSequence = 0

  // Data source: reactive from appStore (populated by Settings data loading)
  const entries = createMemo((): PromptEntry[] => {
    const raw = appStore.promptEntries
    return Array.isArray(raw) ? (raw as PromptEntry[]) : []
  })

  const profileConfigVersion = createMemo(() => JSON.stringify(appStore.config?.prompt_profile ?? null))
  const profiles = createMemo(() => profileCatalog()?.profiles ?? [])
  const currentProfile = createMemo(() => {
    const list = profiles()
    return list.find((profile) => profile.id === selectedProfileID()) ?? list[0]
  })
  const currentProfileDirty = createMemo(() => !samePromptProfile(currentProfile(), profileDraftState))
  const profileTargets = createMemo(() => {
    const catalog = profileCatalog()
    const profile = currentProfile()
    if (!catalog || !profile) return [] as PromptProfileTarget[]
    if (profile.editable) return catalog.targets.filter((target) => target.editable)
    return catalog.targets.filter((target) => {
      const prompt = profile.agents?.[target.id]
      return typeof prompt === "string" && prompt.trim().length > 0
    })
  })

  async function refreshPromptProfiles(): Promise<void> {
    if (!appStore.connected || !settingsStore.directory.trim()) {
      setProfileCatalog(null)
      return
    }
    setProfileLoading(true)
    const sequence = ++promptProfileLoadSequence
    try {
      const catalog = await loadPromptProfileCatalog()
      if (sequence !== promptProfileLoadSequence) return
      setProfileCatalog(catalog)
      setSelectedProfileID((current) =>
        catalog.profiles.some((profile) => profile.id === current) ? current : (catalog.active ?? catalog.profiles[0]?.id ?? ""),
      )
    } finally {
      if (sequence === promptProfileLoadSequence) setProfileLoading(false)
    }
  }

  createEffect(() => {
    const connected = appStore.connected
    const directory = settingsStore.directory.trim()
    const version = profileConfigVersion()
    void version
    if (!connected || !directory) {
      setProfileCatalog(null)
      return
    }
    void refreshPromptProfiles().catch((error) => {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    })
  })

  createEffect(() => {
    const list = profiles()
    if (list.length === 0) {
      if (selectedProfileID()) setSelectedProfileID("")
      return
    }
    if (list.some((profile) => profile.id === selectedProfileID())) return
    setSelectedProfileID(profileCatalog()?.active ?? list[0]!.id)
  })

  createEffect(() => {
    const profile = currentProfile()
    if (!profile) return
    setProfileDraftState(reconcile(promptProfileDraft(profile)))
  })

  function draftValue(entry: PromptEntry): string {
    const id = promptEntryID(entry)
    const val = (drafts as Record<string, string>)[id]
    return val !== undefined ? val : editablePrompt(entry)
  }

  function isDirty(entry: PromptEntry): boolean {
    return draftValue(entry) !== editablePrompt(entry)
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

  async function reloadPromptSurfaces(nextSelectedProfileID?: string): Promise<void> {
    await Promise.all([loadPromptCatalog(), refreshPromptProfiles()])
    if (nextSelectedProfileID) setSelectedProfileID(nextSelectedProfileID)
  }

  async function handleSave(entry: PromptEntry) {
    const value = draftValue(entry)
    setSaving(true)
    try {
      await serviceSave(entry, value)
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
      setDrafts(entryID, editablePrompt(entry))
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

  async function handleCreateProfile() {
    const catalog = profileCatalog()
    if (!catalog) return
    const nextID = createPromptProfileID(
      catalog.profiles.map((profile) => profile.id),
      "custom-squad",
    )
    setSaving(true)
    try {
      await savePromptProfile(
        {
          id: nextID,
          label: t("prompt_profile.new_label"),
          description: "",
          agents: {},
        },
        catalog.default,
      )
      await reloadPromptSurfaces(nextID)
      showNotice(t("prompt_profile.created"), "active")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleDuplicateProfile() {
    const catalog = profileCatalog()
    const profile = currentProfile()
    if (!catalog || !profile) return
    const nextID = createPromptProfileID(
      catalog.profiles.map((item) => item.id),
      profile.id,
    )
    setSaving(true)
    try {
      await savePromptProfile(
        {
          id: nextID,
          label: `${profile.label} ${t("prompt_profile.copy_suffix")}`.trim(),
          description: profile.description ?? "",
          agents: { ...(profile.agents ?? {}) },
        },
        catalog.default,
      )
      await reloadPromptSurfaces(nextID)
      showNotice(t("prompt_profile.duplicated"), "active")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveProfile() {
    const catalog = profileCatalog()
    const profile = currentProfile()
    if (!catalog || !profile || !profile.editable) return
    setSaving(true)
    try {
      await savePromptProfile(
        {
          id: profileDraftState.id,
          label: profileDraftState.label,
          description: profileDraftState.description,
          agents: { ...(profileDraftState.agents ?? {}) },
        },
        catalog.default,
      )
      await reloadPromptSurfaces(profileDraftState.id)
      showNotice(t("common.saved"), "active")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteProfile() {
    const catalog = profileCatalog()
    const profile = currentProfile()
    if (!catalog || !profile || !profile.editable) return
    const nextActive = catalog.active === profile.id ? catalog.default : catalog.active
    setSaving(true)
    try {
      await deletePromptProfile(profile.id, nextActive, catalog.default)
      await reloadPromptSurfaces(nextActive)
      showNotice(t("prompt_profile.deleted"), "active")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleActivateProfile() {
    const profile = currentProfile()
    if (!profile || profileCatalog()?.active === profile.id) return
    setSaving(true)
    try {
      await setProjectPromptProfileActive(profile.id)
      await reloadPromptSurfaces(profile.id)
      showNotice(t("prompt_profile.activated"), "active")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  function showNotice(msg: string, tone = "") {
    if (noticeTimer) clearTimeout(noticeTimer)
    setNotice(msg)
    setNoticeTone(tone)
    if (msg) {
      noticeTimer = setTimeout(() => setNotice(""), 2600)
    }
  }

  return (
    <>
      <Show when={notice()}>
        <div class="config-status-box" data-status={noticeTone()}>
          {notice()}
        </div>
      </Show>

      <div class="general-panel">
        <div class="config-panel-group">
          <SurfaceHeader
            variant="settings-group"
            title={t("prompt_profile.settings_title")}
            actions={
              <div class="prompt-profile-head-actions">
                <Button type="button" variant="ghost" size="sm" tone="neutral" disabled={saving()} onClick={handleCreateProfile}>
                  {t("prompt_profile.create")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  tone="neutral"
                  disabled={saving() || !currentProfile()}
                  onClick={handleDuplicateProfile}
                >
                  {t("prompt_profile.duplicate")}
                </Button>
              </div>
            }
          />
          <p class="agent-models-info">{t("prompt_profile.settings_intro")}</p>

          <Show when={!profileLoading()} fallback={<div class="loading-hint">{t("prompt_profile.loading")}</div>}>
            <Show when={profiles().length > 0} fallback={<div class="empty-hint">{t("prompt_profile.none")}</div>}>
              <div class="prompt-profile-layout" data-ui="prompt-profile-panel">
                <div class="prompt-profile-list" data-ui="prompt-profile-list">
                  <For each={profiles()}>
                    {(profile) => (
                      <button
                        type="button"
                        class="prompt-profile-list-item"
                        data-active={selectedProfileID() === profile.id ? "true" : "false"}
                        onClick={() => setSelectedProfileID(profile.id)}
                      >
                        <div class="prompt-profile-list-copy">
                          <strong>{profile.label}</strong>
                          <span>{profile.id}</span>
                          <Show when={profile.description}>
                            <small>{profile.description}</small>
                          </Show>
                        </div>
                        <div class="prompt-profile-list-meta">
                          <Show when={profileCatalog()?.active === profile.id}>
                            <span class="s-pill" data-tone="accent">
                              {t("prompt_profile.project_active")}
                            </span>
                          </Show>
                          <span class="s-pill" data-tone={profile.built_in ? "muted" : "ok"}>
                            {profileTypeLabel(profile)}
                          </span>
                        </div>
                      </button>
                    )}
                  </For>
                </div>

                <Show when={currentProfile()} keyed>
                  {(profile) => (
                    <div class="prompt-profile-detail" data-ui="prompt-profile-detail">
                      <div class="prompt-profile-detail-head">
                        <div class="prompt-profile-detail-copy">
                          <strong>{profile.label}</strong>
                          <span>{profile.id}</span>
                        </div>
                        <div class="prompt-profile-detail-actions">
                          <Button
                            type="button"
                            variant="solid"
                            size="sm"
                            tone="accent"
                            disabled={saving() || profileCatalog()?.active === profile.id}
                            onClick={handleActivateProfile}
                          >
                            {t("prompt_profile.activate")}
                          </Button>
                          <Show when={profile.editable}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              tone="danger"
                              disabled={saving()}
                              onClick={handleDeleteProfile}
                            >
                              {t("common.delete")}
                            </Button>
                            <Button
                              type="button"
                              variant="solid"
                              size="sm"
                              tone="accent"
                              disabled={saving() || !currentProfileDirty()}
                              onClick={handleSaveProfile}
                            >
                              {t("common.save")}
                            </Button>
                          </Show>
                        </div>
                      </div>

                      <div class="prompt-profile-form">
                        <label class="prompt-profile-field">
                          <span class="field-label">{t("prompt_profile.label")}</span>
                          <input
                            class="field-input"
                            type="text"
                            value={profileDraftState.label}
                            disabled={saving() || !profile.editable}
                            onInput={(event) => setProfileDraftState("label", event.currentTarget.value)}
                          />
                        </label>

                        <label class="prompt-profile-field">
                          <span class="field-label">{t("prompt_profile.description")}</span>
                          <textarea
                            class="field-input prompt-profile-description"
                            rows={3}
                            value={profileDraftState.description ?? ""}
                            disabled={saving() || !profile.editable}
                            onInput={(event) => setProfileDraftState("description", event.currentTarget.value)}
                          />
                        </label>
                      </div>

                      <Show when={!profile.editable}>
                        <div class="prompt-profile-readonly-note">{t("prompt_profile.readonly_note")}</div>
                      </Show>

                      <div class="prompt-profile-targets">
                        <div class="prompt-profile-targets-head">
                          <strong>{t("prompt_profile.agent_overlays")}</strong>
                          <span>{t("prompt_profile.overlay_hint")}</span>
                        </div>
                        <For each={profileTargets()}>
                          {(target) => (
                            <div class="prompt-profile-target">
                              <div class="prompt-profile-target-head">
                                <div class="prompt-profile-target-copy">
                                  <strong>{target.label}</strong>
                                  <span>{target.id}</span>
                                </div>
                                <Show when={target.built_in_only}>
                                  <span class="s-pill" data-tone="muted">
                                    {t("prompt_profile.built_in_only")}
                                  </span>
                                </Show>
                              </div>
                              <Show when={target.description}>
                                <small class="prompt-profile-target-description">{target.description}</small>
                              </Show>
                              <Show
                                when={profile.editable}
                                fallback={
                                  <div class="prompt-preview-card prompt-preview-card--attached">
                                    <div
                                      class="md-content prompt-preview-body"
                                      innerHTML={promptPreviewHtml(targetValue(profileDraftState, target.id))}
                                    />
                                  </div>
                                }
                              >
                                <textarea
                                  class="field-input prompt-profile-textarea"
                                  rows={6}
                                  value={targetValue(profileDraftState, target.id)}
                                  disabled={saving() || !target.editable}
                                  onInput={(event) => setProfileDraftState("agents", target.id, event.currentTarget.value)}
                                />
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </Show>
              </div>
            </Show>
          </Show>
        </div>

        <div class="config-panel-group">
          <SurfaceHeader variant="settings-group" title={t("prompt.title")} />
          <Show when={entries().length > 0} fallback={<div class="empty-hint">{t("prompt.none")}</div>}>
            <div class="prompt-grid">
              <For each={entries()}>
                {(entry) => {
                  const entryID = promptEntryID(entry)
                  const status = createMemo(() => promptStatus(entry))
                  const description = promptDescription(entry)
                  const dirty = createMemo(() => isDirty(entry))
                  const currentDraft = createMemo(() => draftValue(entry))
                  const previewPrompt = createMemo(() =>
                    dirty() ? currentDraft() : (entry.effective_prompt ?? currentDraft()),
                  )
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
                          <Show when={entry.active_profile}>
                            <small>
                              {t("prompt_profile.project_active")}: {entry.active_profile}
                            </small>
                          </Show>
                          <Show when={entry.profile_prompt}>
                            <small>{t("prompt_profile.profile_overlay_visible")}</small>
                          </Show>
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
                                <div class="md-content prompt-preview-body" innerHTML={promptPreviewHtml(previewPrompt())} />
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
        </div>
      </div>
    </>
  )
}
