// ── PromptCatalog ──
// Expert-squad prompt profile surface. Active selection is config-owned;
// profile definitions are read-only package-backed catalog entries.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { t } from "../../utils/i18n"
import { renderMarkdown } from "../../utils/markdown"
import {
  loadPromptProfileCatalog,
  setProjectPromptProfileActive,
  setSessionPromptProfileActive,
  type PromptProfileCatalog as PromptProfileCatalogResponse,
  type PromptProfileOption,
  type PromptProfileTarget,
} from "../../services/config"
import {
  promptProfileCatalogDirectory,
  promptProfileCatalogRequestKey,
  promptProfileCatalogScope,
} from "../../services/prompt-profile-scope"
import { Button } from "../ui/Button"
import { SettingsGroup, SettingsPanel, SettingsPill, SettingsRow } from "./primitives"

function promptPreviewHtml(value: string): string {
  if (!value.trim()) {
    return `<p class="empty-hint">${t("prompt.preview_empty")}</p>`
  }
  return renderMarkdown(value)
}

function profileTypeLabel(profile: PromptProfileOption): string {
  return profile.built_in ? t("prompt_profile.built_in") : t("prompt_profile.package")
}

function profileOverlayCount(profile: PromptProfileOption | undefined): number {
  return Object.values(profile?.agents ?? {}).filter((prompt) => prompt.trim().length > 0).length
}

function promptProfileTargetLabelID(targetID: string): string {
  return `promptProfileTargetLabel-${targetID}`
}

export default function PromptCatalog() {
  const [selectedProfileID, setSelectedProfileID] = createSignal("")
  const [profileCatalog, setProfileCatalog] = createSignal<PromptProfileCatalogResponse | null>(null)
  const [notice, setNotice] = createSignal("")
  const [noticeTone, setNoticeTone] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [profileLoading, setProfileLoading] = createSignal(false)

  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let promptProfileLoadSequence = 0

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
  const profileTargets = createMemo(() => {
    const catalog = profileCatalog()
    const profile = currentProfile()
    if (!catalog || !profile) return [] as PromptProfileTarget[]
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

  async function reloadPromptSurfaces(nextSelectedProfileID?: string): Promise<void> {
    await refreshPromptProfiles()
    if (nextSelectedProfileID) setSelectedProfileID(nextSelectedProfileID)
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
        <SettingsGroup title={t("prompt_profile.settings_title")}>
          <p class="agent-models-info">{t("prompt_profile.settings_intro")}</p>
          <Show when={currentScopeSessionID()}>
            <p class="agent-models-info">{t("prompt_profile.session_scope_hint")}</p>
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
                      </div>

                      <div class="prompt-profile-readonly-note">{t("prompt_profile.readonly_note")}</div>

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
                            const value = () => profile.agents?.[target.id] ?? ""
                            return (
                              <div
                                class="prompt-profile-target"
                                data-editable="false"
                                data-has-overlay={value().trim().length > 0 ? "true" : "false"}
                              >
                                <div class="prompt-profile-target-head">
                                  <div class="prompt-profile-target-copy">
                                    <strong id={labelID}>{target.label}</strong>
                                    <span>{target.id}</span>
                                  </div>
                                  <div class="prompt-profile-target-state">
                                    <SettingsPill tone="muted">{t("prompt_profile.readonly")}</SettingsPill>
                                    <SettingsPill tone="accent">{t("prompt_profile.overlay_configured")}</SettingsPill>
                                    <Show when={target.built_in_only}>
                                      <SettingsPill tone="muted">{t("prompt_profile.built_in_only")}</SettingsPill>
                                    </Show>
                                  </div>
                                </div>
                                <Show when={target.description}>
                                  <small class="prompt-profile-target-description">{target.description}</small>
                                </Show>
                                <div class="prompt-preview-card prompt-preview-card--attached">
                                  <div class="md-content prompt-preview-body" innerHTML={promptPreviewHtml(value())} />
                                </div>
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
