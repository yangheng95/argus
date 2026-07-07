// ── ExpertSquadPanel ──
// Dynamic expert-squad catalog surface. Active selection remains config-owned
// via prompt_profile.active; this panel edits only that existing config field.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { t } from "../../utils/i18n"
import { renderMarkdown } from "../../utils/markdown"
import { pickDirectory } from "../../services/workspace"
import {
  clearSessionExpertSquadOverride,
  exportExpertSquadArchive,
  importExpertSquadArchive,
  importExpertSquadFolder,
  loadExpertSquadCatalog,
  setProjectExpertSquadActive,
  setSessionExpertSquadActive,
  type ExpertSquadCatalog,
  type ExpertSquadOption,
} from "../../services/expert-squad"
import {
  expertSquadCatalogDirectory,
  expertSquadCatalogRequestKey,
  expertSquadCatalogScope,
} from "../../services/expert-squad-scope"
import { Button } from "../ui/Button"
import { Icon } from "../Icon"
import { SettingsGroup, SettingsPanel, SettingsPill, SettingsRow } from "./primitives"

function markdownHtml(value: string): string {
  if (!value.trim()) {
    return `<p class="empty-hint">${t("expert_squad.preview_empty")}</p>`
  }
  return renderMarkdown(value)
}

function sourceLabel(squad: ExpertSquadOption): string {
  return squad.source.kind === "built_in" ? t("expert_squad.built_in") : t("expert_squad.package")
}

function catalogDirectoryLabel(): string {
  const directory = expertSquadCatalogDirectory().trim()
  return directory ? directory : t("expert_squad.directory_unavailable")
}

function projectionCount(values: string[] | undefined): number {
  return values?.length ?? 0
}

function activeAgentMcpRefCount(agent: ExpertSquadCatalog["active_agent_projection"]["agents"][number]): number {
  return (
    projectionCount(agent.default_mcp_server_refs) +
    projectionCount(agent.package_mcp_server_refs) +
    projectionCount(agent.default_mcp_tool_refs) +
    projectionCount(agent.package_mcp_tool_refs) +
    projectionCount(agent.default_mcp_prompt_refs) +
    projectionCount(agent.package_mcp_prompt_refs) +
    projectionCount(agent.default_mcp_resource_refs) +
    projectionCount(agent.package_mcp_resource_refs)
  )
}

function activeAgentSkillRefCount(agent: ExpertSquadCatalog["active_agent_projection"]["agents"][number]): number {
  return projectionCount(agent.default_skill_refs) + projectionCount(agent.package_skill_refs)
}

function activeAgentToolRefCount(agent: ExpertSquadCatalog["active_agent_projection"]["agents"][number]): number {
  return (
    projectionCount(agent.built_in_tool_ids) +
    projectionCount(agent.default_tool_refs) +
    projectionCount(agent.package_tool_refs)
  )
}

function catalogScopeIdentity(scope = expertSquadCatalogScope()): string {
  if (scope.kind === "project") return `project:${scope.directory}`
  if (scope.kind === "session") return `session:${scope.directory}:${scope.sessionID}`
  return scope.kind
}

type WritableCatalogScope = Extract<ReturnType<typeof expertSquadCatalogScope>, { kind: "project" | "session" }>
type BusyAction = { key: string; scopeIdentity: string }

function captureCatalogActionScope(): { scope: WritableCatalogScope; identity: string } | null {
  const scope = expertSquadCatalogScope()
  if (scope.kind !== "project" && scope.kind !== "session") return null
  return { scope, identity: catalogScopeIdentity(scope) }
}

async function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const comma = value.indexOf(",")
      resolve(comma >= 0 ? value.slice(comma + 1) : value)
    }
    reader.onerror = () => reject(reader.error || new Error("Failed to read expert-squad archive"))
    reader.readAsDataURL(file)
  })
}

function saveBase64Archive(filename: string, archiveBase64: string): void {
  const binary = atob(archiveBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: "application/zip" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function ExpertSquadPanel() {
  const [selectedSquadID, setSelectedSquadID] = createSignal("")
  const [catalog, setCatalog] = createSignal<ExpertSquadCatalog | null>(null)
  const [notice, setNotice] = createSignal("")
  const [noticeTone, setNoticeTone] = createSignal("")
  const [busy, setBusy] = createSignal<BusyAction | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [replaceExisting, setReplaceExisting] = createSignal(false)
  const [catalogError, setCatalogError] = createSignal("")
  const [actionError, setActionError] = createSignal("")

  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let loadSequence = 0
  let archiveInput: HTMLInputElement | undefined

  const currentScope = createMemo(() => expertSquadCatalogScope())
  const currentScopeIdentity = createMemo(() => catalogScopeIdentity(currentScope()))
  const writableScopeAvailable = createMemo(() => {
    const scope = currentScope()
    return scope.kind === "project" || scope.kind === "session"
  })
  const activeBusy = createMemo(() => {
    const action = busy()
    return action?.scopeIdentity === currentScopeIdentity() ? action.key : ""
  })
  const requestKey = createMemo(() => expertSquadCatalogRequestKey())
  const currentScopeSessionID = createMemo(() => {
    const scope = currentScope()
    return scope.kind === "session" ? scope.sessionID : ""
  })
  const squads = createMemo(() => catalog()?.squads ?? [])
  const projectActiveID = createMemo(() => catalog()?.active.project ?? "")
  const sessionOverrideID = createMemo(() => catalog()?.active.session_override ?? "")
  const effectiveActiveID = createMemo(() => catalog()?.active.effective ?? "")
  const activeProjection = createMemo(() => catalog()?.active_skill_projection ?? null)
  const activeAgentProjection = createMemo(() => catalog()?.active_agent_projection ?? null)
  const currentSquad = createMemo(() => {
    const list = squads()
    return list.find((squad) => squad.id === selectedSquadID()) ?? list[0]
  })
  const squadNameByID = (id: string): string =>
    id ? (squads().find((item) => item.id === id)?.display_label ?? id) : "-"
  const selectedSquadLabel = createMemo(() => {
    const selectedID = selectedSquadID()
    return selectedID ? squadNameByID(selectedID) : "-"
  })
  const scopeLabel = createMemo(() => {
    const scope = currentScope()
    if (scope.kind === "session") return t("expert_squad.scope_session")
    if (scope.kind === "project") return t("expert_squad.scope_project")
    if (scope.kind === "pending") return t("expert_squad.scope_pending")
    return t("expert_squad.scope_unavailable")
  })
  const scopeStatus = createMemo(() => {
    const scope = currentScope()
    if (scope.kind === "pending") {
      return {
        status: "pending",
        title: t("expert_squad.scope_pending_title"),
        body: t("expert_squad.scope_pending_body"),
      }
    }
    if (scope.kind === "unavailable") {
      return {
        status: "unavailable",
        title: t("expert_squad.scope_unavailable_title"),
        body: t("expert_squad.scope_unavailable_body"),
      }
    }
    return null
  })

  async function refreshCatalog(
    nextSelectedID?: string,
    scope = expertSquadCatalogScope(),
    expectedScopeIdentity = catalogScopeIdentity(scope),
  ): Promise<void> {
    if (scope.kind === "unavailable" || scope.kind === "pending") {
      loadSequence++
      setCatalog(null)
      setCatalogError("")
      setLoading(false)
      return
    }
    setLoading(true)
    const sequence = ++loadSequence
    try {
      const next = await loadExpertSquadCatalog(scope)
      if (sequence !== loadSequence || currentScopeIdentity() !== expectedScopeIdentity) return
      setCatalog(next)
      setCatalogError("")
      setSelectedSquadID((current) =>
        next.squads.some((squad) => squad.id === (nextSelectedID || current))
          ? nextSelectedID || current
          : next.active.effective || next.squads[0]?.id || "",
      )
    } catch (error) {
      if (sequence === loadSequence && currentScopeIdentity() === expectedScopeIdentity) {
        setCatalog(null)
        setCatalogError(error instanceof Error ? error.message : String(error))
      }
      throw error
    } finally {
      if (sequence === loadSequence && currentScopeIdentity() === expectedScopeIdentity) setLoading(false)
    }
  }

  createEffect<string>((previousKey) => {
    const key = requestKey()
    if (key === previousKey) return previousKey
    setActionError("")
    clearNotice()
    const scope = currentScope()
    if (scope.kind === "unavailable" || scope.kind === "pending") {
      loadSequence++
      setCatalog(null)
      setCatalogError("")
      setLoading(false)
      return key
    }
    void refreshCatalog().catch(() => undefined)
    return key
  }, "")

  createEffect(() => {
    const list = squads()
    if (list.length === 0) {
      if (selectedSquadID()) setSelectedSquadID("")
      return
    }
    if (list.some((squad) => squad.id === selectedSquadID())) return
    setSelectedSquadID(effectiveActiveID() || list[0]!.id)
  })

  function clearNotice() {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = undefined
    setNotice("")
    setNoticeTone("")
  }

  function showNotice(message: string, tone = "") {
    clearNotice()
    setNotice(message)
    setNoticeTone(tone)
    if (message) noticeTimer = setTimeout(() => setNotice(""), 3200)
  }

  async function runBusy(key: string, fn: () => Promise<void>, expectedScopeIdentity = currentScopeIdentity()) {
    if (activeBusy()) return
    setBusy({ key, scopeIdentity: expectedScopeIdentity })
    setActionError("")
    try {
      await fn()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (currentScopeIdentity() === expectedScopeIdentity) setActionError(message)
    } finally {
      setBusy((current) => (current?.key === key && current.scopeIdentity === expectedScopeIdentity ? null : current))
    }
  }

  async function activateProject() {
    const squad = currentSquad()
    const captured = captureCatalogActionScope()
    if (!captured) return
    const actionScope = captured.scope
    const actionScopeIdentity = captured.identity
    const directory = actionScope.directory
    if (!squad || !directory || projectActiveID() === squad.id) return
    await runBusy(
      "activate-project",
      async () => {
        await setProjectExpertSquadActive(squad.id, directory, {
          isCurrentDirectory: () => currentScopeIdentity() === actionScopeIdentity,
        })
        if (currentScopeIdentity() !== actionScopeIdentity) return
        await refreshCatalog(squad.id, actionScope, actionScopeIdentity)
        showNotice(t("expert_squad.activated_project"), "active")
      },
      actionScopeIdentity,
    )
  }

  async function activateSession() {
    const squad = currentSquad()
    const captured = captureCatalogActionScope()
    if (!captured) return
    const actionScope = captured.scope
    const actionScopeIdentity = captured.identity
    const sessionID = actionScope.kind === "session" ? actionScope.sessionID : ""
    const directory = actionScope.directory
    if (!squad || !sessionID || !directory || sessionOverrideID() === squad.id) return
    await runBusy(
      "activate-session",
      async () => {
        await setSessionExpertSquadActive(sessionID, squad.id, directory)
        if (currentScopeIdentity() !== actionScopeIdentity) return
        await refreshCatalog(squad.id, actionScope, actionScopeIdentity)
        showNotice(t("expert_squad.activated_session"), "active")
      },
      actionScopeIdentity,
    )
  }

  async function clearSessionOverride() {
    const captured = captureCatalogActionScope()
    if (!captured) return
    const actionScope = captured.scope
    const actionScopeIdentity = captured.identity
    const sessionID = actionScope.kind === "session" ? actionScope.sessionID : ""
    const directory = actionScope.directory
    if (!sessionID || !directory || !sessionOverrideID()) return
    await runBusy(
      "clear-session-override",
      async () => {
        await clearSessionExpertSquadOverride(sessionID, directory)
        if (currentScopeIdentity() !== actionScopeIdentity) return
        await refreshCatalog(projectActiveID(), actionScope, actionScopeIdentity)
        showNotice(t("expert_squad.cleared_session_override"), "active")
      },
      actionScopeIdentity,
    )
  }

  async function importFolder() {
    const captured = captureCatalogActionScope()
    if (!captured) return
    await runBusy(
      "import-folder",
      async () => {
        const sourceDirectory = await pickDirectory(captured.scope.directory)
        if (!sourceDirectory.trim()) return
        if (currentScopeIdentity() !== captured.identity) return
        const result = await importExpertSquadFolder({
          directory: captured.scope.directory,
          sourceDirectory,
          replace: replaceExisting(),
        })
        if (currentScopeIdentity() !== captured.identity) return
        await refreshCatalog(result.id, captured.scope, captured.identity)
        showNotice(
          result.replaced
            ? t("expert_squad.import_replaced", { id: result.id })
            : t("expert_squad.imported", { id: result.id }),
          "active",
        )
      },
      captured.identity,
    )
  }

  async function importArchive(file: File | undefined) {
    const captured = captureCatalogActionScope()
    if (!captured || !file) return
    await runBusy(
      "import-archive",
      async () => {
        const archiveBase64 = await fileToBase64(file)
        if (currentScopeIdentity() !== captured.identity) return
        const result = await importExpertSquadArchive({
          directory: captured.scope.directory,
          archiveBase64,
          filename: file.name,
          replace: replaceExisting(),
        })
        if (currentScopeIdentity() !== captured.identity) return
        await refreshCatalog(result.id, captured.scope, captured.identity)
        showNotice(
          result.replaced
            ? t("expert_squad.import_replaced", { id: result.id })
            : t("expert_squad.imported", { id: result.id }),
          "active",
        )
      },
      captured.identity,
    )
    if (archiveInput) archiveInput.value = ""
  }

  async function exportCurrent() {
    const squad = currentSquad()
    const captured = captureCatalogActionScope()
    if (!squad || !captured || squad.built_in) return
    await runBusy(
      "export",
      async () => {
        const result = await exportExpertSquadArchive(captured.scope.directory, squad.id)
        if (currentScopeIdentity() !== captured.identity) return
        saveBase64Archive(result.filename, result.archiveBase64)
        showNotice(t("expert_squad.exported", { id: result.id, count: result.fileCount }), "active")
      },
      captured.identity,
    )
  }

  return (
    <>
      <Show when={notice()}>
        <div class="config-status-box" data-status={noticeTone()}>
          {notice()}
        </div>
      </Show>

      <SettingsPanel class="general-panel expert-squad-panel" id="expertSquadBody">
        <SettingsGroup
          title={t("expert_squad.settings_title")}
          actions={
            <div class="expert-squad-toolbar">
              <label class="expert-squad-replace-toggle">
                <input
                  type="checkbox"
                  checked={replaceExisting()}
                  disabled={!writableScopeAvailable() || !!activeBusy()}
                  onChange={(event) => setReplaceExisting(event.currentTarget.checked)}
                />
                <span>{t("expert_squad.replace_existing")}</span>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                tone="neutral"
                data-ui="expert-squad-import-folder"
                disabled={!writableScopeAvailable() || !!activeBusy()}
                onClick={importFolder}
              >
                <Icon name="folder-open" size={13} />
                {t("expert_squad.import_folder")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                tone="neutral"
                data-ui="expert-squad-import-archive"
                disabled={!writableScopeAvailable() || !!activeBusy()}
                onClick={() => archiveInput?.click()}
              >
                <Icon name="upload" size={13} />
                {t("expert_squad.import_archive")}
              </Button>
              <input
                ref={(el) => {
                  archiveInput = el
                }}
                type="file"
                accept=".zip,application/zip"
                class="expert-squad-file-input"
                onChange={(event) => void importArchive(event.currentTarget.files?.[0] ?? undefined)}
              />
            </div>
          }
        >
          <p class="agent-models-info">{t("expert_squad.settings_intro")}</p>
          <Show when={currentScopeSessionID()}>
            <p class="agent-models-info">{t("expert_squad.session_scope_hint")}</p>
          </Show>
          <Show when={catalogError()}>
            <div class="config-status-box" data-status="error" data-ui="expert-squad-catalog-error">
              <span class="config-status-box__text">
                {t("expert_squad.catalog_failed", {
                  directory: catalogDirectoryLabel(),
                  error: catalogError(),
                })}
              </span>
            </div>
          </Show>
          <Show when={actionError()}>
            <div class="config-status-box" data-status="error" data-ui="expert-squad-action-error">
              <span class="config-status-box__text">
                {t("expert_squad.action_failed", {
                  directory: catalogDirectoryLabel(),
                  error: actionError(),
                })}
              </span>
              <Button type="button" variant="ghost" size="sm" tone="neutral" onClick={() => setActionError("")}>
                {t("common.dismiss")}
              </Button>
            </div>
          </Show>

          <div class="expert-squad-overview" data-ui="expert-squad-overview">
            <div class="expert-squad-overview-item" data-kind="directory">
              <span>{t("expert_squad.directory")}</span>
              <strong>{catalogDirectoryLabel()}</strong>
            </div>
            <div class="expert-squad-overview-item" data-kind="scope">
              <span>{t("expert_squad.scope")}</span>
              <strong>{scopeLabel()}</strong>
            </div>
            <div class="expert-squad-overview-item" data-kind="project-active">
              <span>{t("expert_squad.project_active")}</span>
              <strong>{squadNameByID(projectActiveID())}</strong>
            </div>
            <Show when={currentScopeSessionID()}>
              <div class="expert-squad-overview-item" data-kind="session-override">
                <span>{t("expert_squad.session_override")}</span>
                <strong>
                  {sessionOverrideID() ? squadNameByID(sessionOverrideID()) : t("expert_squad.inherits_project")}
                </strong>
              </div>
            </Show>
            <div class="expert-squad-overview-item" data-kind="effective-active">
              <span>{t("expert_squad.effective_active")}</span>
              <strong>{squadNameByID(effectiveActiveID())}</strong>
            </div>
            <div class="expert-squad-overview-item" data-kind="selected">
              <span>{t("expert_squad.selected")}</span>
              <strong>{selectedSquadLabel()}</strong>
            </div>
            <Show when={activeProjection()}>
              {(projection) => (
                <div class="expert-squad-overview-item" data-kind="projection">
                  <span>{t("expert_squad.active_projection")}</span>
                  <strong>{projection().active_squad_id}</strong>
                  <small>
                    {t("expert_squad.agent_count", { count: projection().projected_agent_ids.length })} ·{" "}
                    {t("expert_squad.skill_count", { count: projection().projected_skill_names.length })} ·{" "}
                    {t("expert_squad.tool_count", { count: projection().projected_tool_ids.length })}
                  </small>
                </div>
              )}
            </Show>
          </div>

          <Show when={!loading()} fallback={<div class="loading-hint">{t("expert_squad.loading")}</div>}>
            <Show when={scopeStatus()}>
              {(status) => (
                <div class="expert-squad-recovery" data-ui="expert-squad-scope-state" data-status={status().status}>
                  <Icon name="info-circle" size={16} />
                  <strong>{status().title}</strong>
                  <span>{status().body}</span>
                </div>
              )}
            </Show>
            <Show when={!scopeStatus() && catalogError()}>
              <div class="expert-squad-recovery" data-ui="expert-squad-catalog-recovery" data-status="failed">
                <Icon name="folder-open" size={16} />
                <strong>{t("expert_squad.catalog_recovery_title")}</strong>
                <span>{t("expert_squad.catalog_recovery_body")}</span>
              </div>
            </Show>
            <Show when={!scopeStatus() && !catalogError() && squads().length === 0}>
              <div class="empty-hint">{t("expert_squad.none")}</div>
            </Show>
            <Show when={!scopeStatus() && !catalogError() && squads().length > 0}>
              <div class="expert-squad-layout" data-ui="expert-squad-panel">
                <div class="expert-squad-list" data-ui="expert-squad-list">
                  <For each={squads()}>
                    {(squad) => (
                      <SettingsRow
                        as="button"
                        class="expert-squad-list-row"
                        interactive
                        data-active={selectedSquadID() === squad.id ? "true" : "false"}
                        aria-current={selectedSquadID() === squad.id ? "true" : undefined}
                        onClick={() => setSelectedSquadID(squad.id)}
                        actions={
                          <div class="expert-squad-list-meta">
                            <Show when={effectiveActiveID() === squad.id}>
                              <SettingsPill tone="accent">{t("expert_squad.effective_active")}</SettingsPill>
                            </Show>
                            <SettingsPill tone={squad.built_in ? "muted" : "ok"}>{sourceLabel(squad)}</SettingsPill>
                          </div>
                        }
                      >
                        <div class="expert-squad-list-copy">
                          <strong>{squad.display_label}</strong>
                          <span>{squad.id}</span>
                          <Show when={squad.description}>
                            <small>{squad.description}</small>
                          </Show>
                        </div>
                      </SettingsRow>
                    )}
                  </For>
                </div>

                <Show when={currentSquad()} keyed>
                  {(squad) => (
                    <div class="expert-squad-detail" data-ui="expert-squad-detail">
                      <div class="expert-squad-detail-head">
                        <div class="expert-squad-detail-copy">
                          <strong>{squad.display_label}</strong>
                          <span>{squad.id}</span>
                          <Show when={squad.description}>
                            <small>{squad.description}</small>
                          </Show>
                          <div class="expert-squad-detail-badges">
                            <SettingsPill tone={squad.built_in ? "muted" : "ok"}>{sourceLabel(squad)}</SettingsPill>
                            <Show when={squad.version}>
                              <SettingsPill tone="muted">v{squad.version}</SettingsPill>
                            </Show>
                            <Show when={projectActiveID() === squad.id}>
                              <SettingsPill tone="accent">{t("expert_squad.project_active")}</SettingsPill>
                            </Show>
                            <Show when={sessionOverrideID() === squad.id}>
                              <SettingsPill tone="ok">{t("expert_squad.session_override")}</SettingsPill>
                            </Show>
                          </div>
                        </div>
                      </div>

                      <div class="expert-squad-action-strip" data-ui="expert-squad-actions">
                        <Button
                          type="button"
                          variant={projectActiveID() === squad.id ? "ghost" : "solid"}
                          size="sm"
                          tone={projectActiveID() === squad.id ? "neutral" : "accent"}
                          data-ui="expert-squad-activate-project"
                          disabled={!writableScopeAvailable() || !!activeBusy() || projectActiveID() === squad.id}
                          onClick={activateProject}
                        >
                          {projectActiveID() === squad.id
                            ? t("expert_squad.project_active")
                            : t("expert_squad.activate_project")}
                        </Button>
                        <Show when={currentScopeSessionID()}>
                          <>
                            <Button
                              type="button"
                              variant={sessionOverrideID() === squad.id ? "ghost" : "solid"}
                              size="sm"
                              tone={sessionOverrideID() === squad.id ? "neutral" : "accent"}
                              data-ui="expert-squad-activate-session"
                              disabled={!writableScopeAvailable() || !!activeBusy() || sessionOverrideID() === squad.id}
                              onClick={activateSession}
                            >
                              {sessionOverrideID() === squad.id
                                ? t("expert_squad.session_override")
                                : t("expert_squad.activate_session")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              tone="neutral"
                              data-ui="expert-squad-clear-session-override"
                              disabled={!writableScopeAvailable() || !!activeBusy() || !sessionOverrideID()}
                              onClick={clearSessionOverride}
                            >
                              <Icon name="rewind" size={13} />
                              {t("expert_squad.clear_session_override")}
                            </Button>
                          </>
                        </Show>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          tone="neutral"
                          data-ui="expert-squad-export"
                          disabled={!writableScopeAvailable() || !!activeBusy() || squad.built_in}
                          onClick={exportCurrent}
                        >
                          <Icon name="download" size={13} />
                          {t("expert_squad.export")}
                        </Button>
                      </div>

                      <div class="expert-squad-source-grid">
                        <div>
                          <span>{t("expert_squad.source")}</span>
                          <strong>{sourceLabel(squad)}</strong>
                        </div>
                        <div>
                          <span>{t("expert_squad.projection_hash")}</span>
                          <strong>{squad.projection_hash.slice(0, 12)}</strong>
                        </div>
                        <div>
                          <span>{t("expert_squad.projected_agents")}</span>
                          <strong>{squad.projected_agents.join(", ") || "-"}</strong>
                        </div>
                        <div>
                          <span>{t("expert_squad.virtual_agents")}</span>
                          <strong>{t("expert_squad.agent_count", { count: squad.virtual_agents.length })}</strong>
                        </div>
                      </div>

                      <div class="expert-squad-section">
                        <div class="expert-squad-section-head">
                          <strong>{t("expert_squad.virtual_agents")}</strong>
                          <SettingsPill tone="muted">
                            {t("expert_squad.agent_count", { count: squad.virtual_agents.length })}
                          </SettingsPill>
                        </div>
                        <Show when={squad.virtual_agents.length > 0} fallback={<div class="empty-hint">-</div>}>
                          <div class="expert-squad-projection-grid" data-ui="expert-squad-virtual-agents">
                            <For each={squad.virtual_agents}>
                              {(agent) => (
                                <div class="expert-squad-projection-row">
                                  <span>{agent.base_role}</span>
                                  <strong>{agent.label}</strong>
                                  <small>{agent.virtual_agent_id}</small>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>

                      <Show when={effectiveActiveID() === squad.id && activeAgentProjection()}>
                        {(projection) => (
                          <div class="expert-squad-section" data-ui="expert-squad-active-agent-projection">
                            <div class="expert-squad-section-head">
                              <strong>{t("expert_squad.active_agent_projection")}</strong>
                              <SettingsPill tone="accent">{projection().projection_hash.slice(0, 12)}</SettingsPill>
                            </div>
                            <div class="expert-squad-projection-grid">
                              <For each={projection().agents}>
                                {(agent) => (
                                  <div class="expert-squad-projection-row">
                                    <span>{agent.base_role}</span>
                                    <strong>{agent.label}</strong>
                                    <small>
                                      {agent.virtual_agent_id} ·{" "}
                                      {t("expert_squad.skill_count", { count: activeAgentSkillRefCount(agent) })} ·{" "}
                                      {t("expert_squad.tool_count", { count: activeAgentToolRefCount(agent) })} ·{" "}
                                      {t("expert_squad.mcp_ref_count", { count: activeAgentMcpRefCount(agent) })}
                                    </small>
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>
                        )}
                      </Show>

                      <div class="expert-squad-section">
                        <div class="expert-squad-section-head">
                          <strong>{t("expert_squad.readme_title")}</strong>
                          <SettingsPill tone="accent">{t("expert_squad.orchestrator_append")}</SettingsPill>
                        </div>
                        <div class="expert-squad-markdown md-content" innerHTML={markdownHtml(squad.readme.content)} />
                      </div>

                      <Show when={squad.selector}>
                        {(selector) => (
                          <div class="expert-squad-section">
                            <div class="expert-squad-section-head">
                              <strong>{t("expert_squad.selector_instructions_title")}</strong>
                              <SettingsPill tone="muted">{selector().ref}</SettingsPill>
                            </div>
                            <div class="expert-squad-selector-summary">
                              <strong>{selector().summary}</strong>
                              <span>{selector().selection_guidance}</span>
                            </div>
                            <div
                              class="expert-squad-markdown md-content"
                              innerHTML={markdownHtml(selector().instructions)}
                            />
                          </div>
                        )}
                      </Show>

                      <div class="expert-squad-section">
                        <div class="expert-squad-section-head">
                          <strong>{t("expert_squad.capability_projection")}</strong>
                          <SettingsPill tone="muted">
                            {t("expert_squad.tool_count", {
                              count:
                                projectionCount(squad.capability_projection.scheduler.built_in_tool_ids) +
                                projectionCount(squad.capability_projection.scheduler.default_tool_refs) +
                                projectionCount(squad.capability_projection.scheduler.package_tool_refs) +
                                projectionCount(squad.capability_projection.scheduler.default_mcp_tool_refs) +
                                projectionCount(squad.capability_projection.scheduler.package_mcp_tool_refs),
                            })}
                          </SettingsPill>
                        </div>
                        <div class="expert-squad-projection-grid">
                          <For
                            each={
                              [
                                ["built_in_tool_ids", squad.capability_projection.scheduler.built_in_tool_ids],
                                ["default_skill_refs", squad.capability_projection.scheduler.default_skill_refs],
                                ["package_skill_refs", squad.capability_projection.scheduler.package_skill_refs],
                                ["default_tool_refs", squad.capability_projection.scheduler.default_tool_refs],
                                ["package_tool_refs", squad.capability_projection.scheduler.package_tool_refs],
                                [
                                  "default_mcp_server_refs",
                                  squad.capability_projection.scheduler.default_mcp_server_refs,
                                ],
                                [
                                  "package_mcp_server_refs",
                                  squad.capability_projection.scheduler.package_mcp_server_refs,
                                ],
                                ["default_mcp_tool_refs", squad.capability_projection.scheduler.default_mcp_tool_refs],
                                ["package_mcp_tool_refs", squad.capability_projection.scheduler.package_mcp_tool_refs],
                                [
                                  "default_mcp_prompt_refs",
                                  squad.capability_projection.scheduler.default_mcp_prompt_refs,
                                ],
                                [
                                  "package_mcp_prompt_refs",
                                  squad.capability_projection.scheduler.package_mcp_prompt_refs,
                                ],
                                [
                                  "default_mcp_resource_refs",
                                  squad.capability_projection.scheduler.default_mcp_resource_refs,
                                ],
                                [
                                  "package_mcp_resource_refs",
                                  squad.capability_projection.scheduler.package_mcp_resource_refs,
                                ],
                              ] as const
                            }
                          >
                            {([key, values]) => (
                              <div class="expert-squad-projection-row">
                                <span>{key}</span>
                                <strong>{values.length ? values.join(", ") : "-"}</strong>
                              </div>
                            )}
                          </For>
                        </div>
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
