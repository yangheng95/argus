// ── PromptCatalog ──
// Expert-squad prompt profile surface. Code-owned base prompts are not edited
// here; this component only exposes scenario append prompts stored under
// config.prompt_profile.profiles.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { t } from "../../utils/i18n"
import { renderMarkdown } from "../../utils/markdown"
import {
  createPromptProfileID,
  deletePromptProfile,
  importPromptProfiles,
  loadPromptProfileCatalog,
  parsePromptProfileImportPayload,
  savePromptProfile,
  setProjectPromptProfileActive,
  setSessionPromptProfileActive,
  type PromptProfileCatalog as PromptProfileCatalogResponse,
  type PromptProfileDraft,
  type PromptProfileImportPreview,
  type PromptProfileOption,
  type PromptProfileTarget,
} from "../../services/config"
import {
  promptProfileCatalogDirectory,
  promptProfileCatalogRequestKey,
  promptProfileCatalogScope,
} from "../../services/prompt-profile-scope"
import { AutoGrowTextarea } from "../primitives/AutoGrowTextarea"
import { Button } from "../ui/Button"
import { SettingsGroup, SettingsPanel, SettingsPill, SettingsRow } from "./primitives"

function promptPreviewHtml(value: string): string {
  if (!value.trim()) {
    return `<p class="empty-hint">${t("prompt.preview_empty")}</p>`
  }
  return renderMarkdown(value)
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
  return (
    JSON.stringify(promptProfileDraft(profile)) ===
    JSON.stringify({
      id: draft.id,
      label: draft.label,
      description: draft.description ?? "",
      agents: compactProfileAgents(draft.agents),
    })
  )
}

function profileTypeLabel(profile: PromptProfileOption): string {
  return profile.built_in ? t("prompt_profile.built_in") : t("prompt_profile.custom")
}

function profileOverlayCount(profile: PromptProfileOption | undefined): number {
  return Object.values(profile?.agents ?? {}).filter((prompt) => prompt.trim().length > 0).length
}

function targetValue(draft: PromptProfileDraft, targetID: string): string {
  return draft.agents?.[targetID] ?? ""
}

function promptProfileTargetLabelID(targetID: string): string {
  return `promptProfileTargetLabel-${targetID}`
}

export default function PromptCatalog() {
  const [profileDraftState, setProfileDraftState] = createStore<PromptProfileDraft>({
    id: "",
    label: "",
    description: "",
    agents: {},
  })
  const [selectedProfileID, setSelectedProfileID] = createSignal("")
  const [profileCatalog, setProfileCatalog] = createSignal<PromptProfileCatalogResponse | null>(null)
  const [importPreview, setImportPreview] = createSignal<PromptProfileImportPreview | null>(null)
  const [notice, setNotice] = createSignal("")
  const [noticeTone, setNoticeTone] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [profileLoading, setProfileLoading] = createSignal(false)

  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let promptProfileLoadSequence = 0
  let importFileInput: HTMLInputElement | undefined

  const profileRequestKey = createMemo(() => promptProfileCatalogRequestKey())
  const currentScopeSessionID = createMemo(() => {
    const scope = promptProfileCatalogScope()
    return scope.kind === "session" ? scope.sessionID : ""
  })
  const profiles = createMemo(() => profileCatalog()?.profiles ?? [])
  const projectActiveProfileID = createMemo(() => profileCatalog()?.project_active ?? "")
  const sessionActiveProfileID = createMemo(() => profileCatalog()?.session_active ?? "")
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
  const selectedProfileTargetCount = createMemo(() => profileTargets().length)
  const profileNameByID = (profileID: string): string => {
    const profile = profiles().find((item) => item.id === profileID)
    return profile?.label ?? profileID
  }
  const scopeLabel = createMemo(() =>
    promptProfileCatalogScope().kind === "session"
      ? t("prompt_profile.scope_session")
      : t("prompt_profile.scope_project"),
  )

  async function refreshPromptProfiles(): Promise<void> {
    const scope = promptProfileCatalogScope()
    if (scope.kind === "unavailable" || scope.kind === "pending") {
      setProfileCatalog(null)
      return
    }
    setProfileLoading(true)
    const sequence = ++promptProfileLoadSequence
    try {
      const catalog = await loadPromptProfileCatalog(scope)
      if (sequence !== promptProfileLoadSequence) return
      setProfileCatalog(catalog)
      setSelectedProfileID((current) =>
        catalog.profiles.some((profile) => profile.id === current)
          ? current
          : (catalog.active ?? catalog.profiles[0]?.id ?? ""),
      )
    } finally {
      if (sequence === promptProfileLoadSequence) setProfileLoading(false)
    }
  }

  createEffect<string>((previousKey) => {
    const requestKey = profileRequestKey()
    if (requestKey === previousKey) return previousKey
    const scope = promptProfileCatalogScope()
    if (scope.kind === "unavailable" || scope.kind === "pending") {
      setProfileCatalog(null)
      return requestKey
    }
    void refreshPromptProfiles().catch((error) => {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    })
    return requestKey
  }, "")

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

  async function reloadPromptSurfaces(nextSelectedProfileID?: string): Promise<void> {
    await refreshPromptProfiles()
    if (nextSelectedProfileID) setSelectedProfileID(nextSelectedProfileID)
  }

  async function handleCreateProfile() {
    const catalog = profileCatalog()
    if (!catalog) return
    const directory = promptProfileCatalogDirectory()
    if (!directory) return
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
        directory,
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
    const directory = promptProfileCatalogDirectory()
    if (!directory) return
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
          agents: Object.fromEntries(
            Object.entries(profile.agents ?? {}).filter(([targetID]) =>
              catalog.targets.some((target) => target.id === targetID && target.editable),
            ),
          ),
        },
        catalog.default,
        directory,
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
    const directory = promptProfileCatalogDirectory()
    if (!directory) return
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
        directory,
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
    const directory = promptProfileCatalogDirectory()
    if (!directory) return
    const nextActive = catalog.active === profile.id ? catalog.default : catalog.active
    setSaving(true)
    try {
      await deletePromptProfile(profile.id, nextActive, catalog.default, directory)
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
    if (!profile || projectActiveProfileID() === profile.id) return
    const directory = promptProfileCatalogDirectory()
    if (!directory) return
    setSaving(true)
    try {
      await setProjectPromptProfileActive(profile.id, directory)
      await reloadPromptSurfaces(profile.id)
      showNotice(t("prompt_profile.activated"), "active")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleActivateProfileForSession() {
    const profile = currentProfile()
    const sessionID = currentScopeSessionID()
    if (!profile || !sessionID || sessionActiveProfileID() === profile.id) return
    const directory = promptProfileCatalogDirectory()
    if (!directory) return
    setSaving(true)
    try {
      await setSessionPromptProfileActive(sessionID, profile.id, directory)
      await reloadPromptSurfaces(profile.id)
      showNotice(t("prompt_profile.activated_session"), "active")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  function openImportPicker() {
    importFileInput?.click()
  }

  async function handleImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ""
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      setImportPreview(parsePromptProfileImportPayload(parsed))
      showNotice(t("prompt_profile.import_loaded"), "active")
    } catch (error) {
      setImportPreview(null)
      showNotice(error instanceof Error ? error.message : String(error), "error")
    }
  }

  async function handleApplyImport() {
    const catalog = profileCatalog()
    const preview = importPreview()
    if (!catalog || !preview) return
    const directory = promptProfileCatalogDirectory()
    if (!directory) return
    setSaving(true)
    try {
      await importPromptProfiles(preview, catalog, directory)
      const selected = preview.active ?? preview.profiles[0]?.id
      setImportPreview(null)
      await reloadPromptSurfaces(selected)
      showNotice(t("prompt_profile.imported"), "active")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  function importedTargetSummary(profile: PromptProfileDraft): string {
    const catalog = profileCatalog()
    const targets = Object.keys(profile.agents ?? {})
    if (targets.length === 0) return t("prompt_profile.import_no_targets")
    return targets
      .map((targetID) => {
        const target = catalog?.targets.find((item) => item.id === targetID)
        return target ? `${target.label} (${target.id})` : targetID
      })
      .join(", ")
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

      <SettingsPanel class="general-panel">
        <SettingsGroup
          title={t("prompt_profile.settings_title")}
          actions={
            <div class="prompt-profile-head-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                tone="neutral"
                disabled={saving()}
                onClick={openImportPicker}
              >
                {t("prompt_profile.import")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                tone="neutral"
                disabled={saving()}
                onClick={handleCreateProfile}
              >
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
              <input
                ref={(element) => (importFileInput = element)}
                data-ui="prompt-profile-import-input"
                type="file"
                accept="application/json,.json"
                hidden
                onChange={handleImportFile}
              />
            </div>
          }
        >
          <p class="agent-models-info">{t("prompt_profile.settings_intro")}</p>
          <Show when={currentScopeSessionID()}>
            <p class="agent-models-info">{t("prompt_profile.session_scope_hint")}</p>
          </Show>

          <Show when={importPreview()}>
            {(preview) => (
              <div class="prompt-profile-import-preview" data-ui="prompt-profile-import-preview">
                <div class="prompt-profile-import-head">
                  <div>
                    <strong>{t("prompt_profile.import_preview")}</strong>
                    <Show when={preview().active}>
                      <small>
                        {t("prompt_profile.import_active")}: {preview().active}
                      </small>
                    </Show>
                  </div>
                  <div class="prompt-profile-detail-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      tone="neutral"
                      disabled={saving()}
                      onClick={() => setImportPreview(null)}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      type="button"
                      variant="solid"
                      size="sm"
                      tone="accent"
                      disabled={saving()}
                      onClick={handleApplyImport}
                    >
                      {t("prompt_profile.apply_import")}
                    </Button>
                  </div>
                </div>
                <div class="prompt-profile-import-list">
                  <For each={preview().profiles}>
                    {(profile) => (
                      <div class="prompt-profile-import-item">
                        <strong>{profile.label}</strong>
                        <span>{profile.id}</span>
                        <small>{importedTargetSummary(profile)}</small>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </Show>

          <Show when={!profileLoading()} fallback={<div class="loading-hint">{t("prompt_profile.loading")}</div>}>
            <Show when={profiles().length > 0} fallback={<div class="empty-hint">{t("prompt_profile.none")}</div>}>
              <div class="prompt-profile-overview" data-ui="prompt-profile-overview">
                <div class="prompt-profile-overview-item" data-kind="scope">
                  <span>{t("prompt_profile.scope")}</span>
                  <strong>{scopeLabel()}</strong>
                </div>
                <div class="prompt-profile-overview-item" data-kind="project-active">
                  <span>{t("prompt_profile.project_active")}</span>
                  <strong>{profileNameByID(projectActiveProfileID())}</strong>
                </div>
                <Show when={currentScopeSessionID()}>
                  <div class="prompt-profile-overview-item" data-kind="session-active">
                    <span>{t("prompt_profile.session_active")}</span>
                    <strong>{profileNameByID(sessionActiveProfileID())}</strong>
                  </div>
                </Show>
                <Show when={currentProfile()}>
                  {(profile) => (
                    <div class="prompt-profile-overview-item" data-kind="selected">
                      <span>{t("prompt_profile.selected_profile")}</span>
                      <strong>{profile().label}</strong>
                      <small>
                        {t("prompt_profile.target_count", { count: selectedProfileTargetCount() })} ·{" "}
                        {t("prompt_profile.overlay_count", { count: profileOverlayCount(profile()) })}
                      </small>
                    </div>
                  )}
                </Show>
              </div>

              <div class="prompt-profile-layout" data-ui="prompt-profile-panel">
                <div class="prompt-profile-list" data-ui="prompt-profile-list">
                  <For each={profiles()}>
                    {(profile) => (
                      <SettingsRow
                        as="button"
                        class="prompt-profile-list-row"
                        interactive
                        data-active={selectedProfileID() === profile.id ? "true" : "false"}
                        aria-current={selectedProfileID() === profile.id ? "true" : undefined}
                        onClick={() => setSelectedProfileID(profile.id)}
                        actions={
                          <div class="prompt-profile-list-meta">
                            <Show when={projectActiveProfileID() === profile.id}>
                              <SettingsPill tone="accent">{t("prompt_profile.project_active")}</SettingsPill>
                            </Show>
                            <Show when={!!currentScopeSessionID() && sessionActiveProfileID() === profile.id}>
                              <SettingsPill tone="ok">{t("prompt_profile.session_active")}</SettingsPill>
                            </Show>
                            <SettingsPill tone={profile.built_in ? "muted" : "ok"}>
                              {profileTypeLabel(profile)}
                            </SettingsPill>
                          </div>
                        }
                      >
                        <div class="prompt-profile-list-copy">
                          <strong>{profile.label}</strong>
                          <span>{profile.id}</span>
                          <Show when={profile.description}>
                            <small>{profile.description}</small>
                          </Show>
                        </div>
                      </SettingsRow>
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
                          <Show when={profile.description}>
                            <small>{profile.description}</small>
                          </Show>
                          <div class="prompt-profile-detail-badges">
                            <SettingsPill tone={profile.built_in ? "muted" : "ok"}>
                              {profileTypeLabel(profile)}
                            </SettingsPill>
                            <Show when={projectActiveProfileID() === profile.id}>
                              <SettingsPill tone="accent">{t("prompt_profile.project_active")}</SettingsPill>
                            </Show>
                            <Show when={!!currentScopeSessionID() && sessionActiveProfileID() === profile.id}>
                              <SettingsPill tone="ok">{t("prompt_profile.session_active")}</SettingsPill>
                            </Show>
                          </div>
                        </div>
                      </div>

                      <div class="prompt-profile-action-strip" data-ui="prompt-profile-actions">
                        <Button
                          type="button"
                          variant={projectActiveProfileID() === profile.id ? "ghost" : "solid"}
                          size="sm"
                          tone={projectActiveProfileID() === profile.id ? "neutral" : "accent"}
                          data-ui="prompt-profile-activate-project"
                          disabled={saving() || projectActiveProfileID() === profile.id}
                          onClick={handleActivateProfile}
                        >
                          {projectActiveProfileID() === profile.id
                            ? t("prompt_profile.project_active")
                            : t("prompt_profile.activate")}
                        </Button>
                        <Show when={currentScopeSessionID()}>
                          <Button
                            type="button"
                            variant={sessionActiveProfileID() === profile.id ? "ghost" : "solid"}
                            size="sm"
                            tone={sessionActiveProfileID() === profile.id ? "neutral" : "accent"}
                            data-ui="prompt-profile-activate-session"
                            disabled={saving() || sessionActiveProfileID() === profile.id}
                            onClick={handleActivateProfileForSession}
                          >
                            {sessionActiveProfileID() === profile.id
                              ? t("prompt_profile.session_active")
                              : t("prompt_profile.activate_session")}
                          </Button>
                        </Show>
                        <Show when={profile.editable}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            tone="danger"
                            data-ui="prompt-profile-delete"
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
                            data-ui="prompt-profile-save"
                            disabled={saving() || !currentProfileDirty()}
                            onClick={handleSaveProfile}
                          >
                            {t("common.save")}
                          </Button>
                        </Show>
                      </div>

                      <Show
                        when={profile.editable}
                        fallback={<div class="prompt-profile-readonly-note">{t("prompt_profile.readonly_note")}</div>}
                      >
                        <div class="prompt-profile-form" data-ui="prompt-profile-metadata">
                          <div class="prompt-profile-form-head">
                            <strong>{t("prompt_profile.metadata")}</strong>
                            <span>{t("prompt_profile.custom")}</span>
                          </div>
                          <label class="prompt-profile-field">
                            <span class="field-label">{t("prompt_profile.label")}</span>
                            <input
                              class="field-input"
                              type="text"
                              value={profileDraftState.label}
                              disabled={saving()}
                              onInput={(event) => setProfileDraftState("label", event.currentTarget.value)}
                            />
                          </label>

                          <label class="prompt-profile-field">
                            <span class="field-label">{t("prompt_profile.description")}</span>
                            <AutoGrowTextarea
                              class="composer-textarea prompt-profile-description"
                              rows={3}
                              value={profileDraftState.description ?? ""}
                              disabled={saving()}
                              onInput={(event) => setProfileDraftState("description", event.currentTarget.value)}
                            />
                          </label>
                        </div>
                      </Show>

                      <div class="prompt-profile-targets">
                        <div class="prompt-profile-targets-head">
                          <div>
                            <strong>{t("prompt_profile.agent_overlays")}</strong>
                            <span>{t("prompt_profile.overlay_hint")}</span>
                          </div>
                          <SettingsPill tone="muted">
                            {t("prompt_profile.target_count", { count: selectedProfileTargetCount() })}
                          </SettingsPill>
                        </div>
                        <For each={profileTargets()}>
                          {(target) => {
                            const labelID = promptProfileTargetLabelID(target.id)
                            const value = () => targetValue(profileDraftState, target.id)
                            const hasOverlay = () => value().trim().length > 0
                            const editableTarget = () => !!profile.editable && target.editable
                            return (
                              <div
                                class="prompt-profile-target"
                                data-editable={editableTarget() ? "true" : "false"}
                                data-has-overlay={hasOverlay() ? "true" : "false"}
                              >
                                <div class="prompt-profile-target-head">
                                  <div class="prompt-profile-target-copy">
                                    <strong id={labelID}>{target.label}</strong>
                                    <span>{target.id}</span>
                                  </div>
                                  <div class="prompt-profile-target-state">
                                    <SettingsPill tone={editableTarget() ? "ok" : "muted"}>
                                      {editableTarget() ? t("prompt_profile.editable") : t("prompt_profile.readonly")}
                                    </SettingsPill>
                                    <SettingsPill tone={hasOverlay() ? "accent" : "muted"}>
                                      {hasOverlay()
                                        ? t("prompt_profile.overlay_configured")
                                        : t("prompt_profile.overlay_empty")}
                                    </SettingsPill>
                                    <Show when={target.built_in_only}>
                                      <SettingsPill tone="muted">{t("prompt_profile.built_in_only")}</SettingsPill>
                                    </Show>
                                  </div>
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
                                        innerHTML={promptPreviewHtml(value())}
                                      />
                                    </div>
                                  }
                                >
                                  <AutoGrowTextarea
                                    class="composer-textarea prompt-profile-textarea"
                                    aria-labelledby={labelID}
                                    rows={6}
                                    value={value()}
                                    disabled={saving() || !target.editable}
                                    onInput={(event) =>
                                      setProfileDraftState("agents", target.id, event.currentTarget.value)
                                    }
                                  />
                                </Show>
                              </div>
                            )
                          }}
                        </For>
                      </div>
                    </div>
                  )}
                </Show>
              </div>
            </Show>
          </Show>
        </SettingsGroup>
      </SettingsPanel>
    </>
  )
}
