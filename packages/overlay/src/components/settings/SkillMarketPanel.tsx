// ── SkillMarketPanel ──
// Solid.js component for managing skills, MCP servers, and marketplace.
// Displays:
// • Installed custom skills with add/remove/open actions
// • Installed MCP servers with add/remove actions
// • Skill market catalog with install / open-site actions
// All CRUD operations are self-contained — no dependency on static HTML dialogs.

import * as Select from "@kobalte/core/select"
import { createEffect, createSignal, createMemo, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { t } from "../../utils/i18n"
import { apiJson } from "../../services/api"
import { activeDirectory, pickDirectory } from "../../services/workspace"
import { appStore } from "../../store/app"
import { updateConfig } from "../../services/config"
import { getHostTransport } from "../../services/host-transport"
import { nativeOpen } from "../../utils/native"
import { createVisibilityInterval } from "../../utils/visibility-interval"
import {
  loadExtensions,
  loadInstalledSkills,
  loadMcpStatus,
  loadSkillMarket,
  importSkillArchive,
  importSkillFile,
  importSkillPackage,
  type SkillImportPackageFile,
} from "../../services/extensions"
import { addMcpServer } from "../../services/mcp"
import { Button } from "../ui/Button"
import { SurfaceHeader } from "../ui/SurfaceHeader"
import { Icon, type IconName } from "../Icon"

// ── Types ──

interface SkillItem {
  name: string
  description?: string
  location?: string
  source?: string
  source_type?: string
  builtin?: boolean
}

interface McpItem {
  status?: string
  error?: string
}

interface MarketItem {
  id: string
  name: string
  provider: string
  trust: string
  install_kind: string
  description?: string
  notes?: string
  homepage?: string
  source?: string
  recommended_policy?: string
}

interface WebkitFileSystemEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
}

interface WebkitFileSystemFileEntry extends WebkitFileSystemEntry {
  isFile: true
  file(success: (file: File) => void, error?: (error: DOMException) => void): void
}

interface WebkitFileSystemDirectoryReader {
  readEntries(success: (entries: WebkitFileSystemEntry[]) => void, error?: (error: DOMException) => void): void
}

interface WebkitFileSystemDirectoryEntry extends WebkitFileSystemEntry {
  isDirectory: true
  createReader(): WebkitFileSystemDirectoryReader
}

interface SkillDropPayload {
  sourceName: string
  file?: File
  archive?: File
  files?: SkillImportPackageFile[]
}

// ── Helpers ──

function skillRemoveKind(item: SkillItem): string {
  if (item.source_type === "managed_git") return "git"
  if (item.source_type === "config_url") return "url"
  if (item.source_type === "config_path") return "path"
  return ""
}

function skillRemovable(item: SkillItem): boolean {
  return !item.builtin && !!item.source && !!skillRemoveKind(item)
}

function mcpStatusLabel(status: string): string {
  const map: Record<string, string> = {
    connected: t("mcp.status.connected"),
    disabled: t("mcp.status.disabled"),
    error: t("mcp.status.error"),
    connecting: t("mcp.status.connecting"),
  }
  return map[status] || status
}

function dataTransferEntries(dataTransfer: DataTransfer | null): WebkitFileSystemEntry[] {
  if (!dataTransfer?.items?.length) return []
  const entries: WebkitFileSystemEntry[] = []
  for (const item of Array.from(dataTransfer.items)) {
    const entry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => unknown
    }).webkitGetAsEntry?.() as WebkitFileSystemEntry | null | undefined
    if (entry) entries.push(entry)
  }
  return entries
}

function readFileEntry(entry: WebkitFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

async function readDirectoryEntries(entry: WebkitFileSystemDirectoryEntry): Promise<WebkitFileSystemEntry[]> {
  const reader = entry.createReader()
  const entries: WebkitFileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<WebkitFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    if (batch.length === 0) return entries
    entries.push(...batch)
  }
}

async function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const comma = value.indexOf(",")
      resolve(comma >= 0 ? value.slice(comma + 1) : value)
    }
    reader.onerror = () => reject(reader.error || new Error("Failed to read dropped skill file"))
    reader.readAsDataURL(file)
  })
}

async function readEntryFiles(entry: WebkitFileSystemEntry, prefix = ""): Promise<SkillImportPackageFile[]> {
  const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
  if (entry.isFile) {
    const file = await readFileEntry(entry as WebkitFileSystemFileEntry)
    return [{ path: relativePath, contentBase64: await fileToBase64(file) }]
  }
  if (!entry.isDirectory) return []
  const children = await readDirectoryEntries(entry as WebkitFileSystemDirectoryEntry)
  const nested = await Promise.all(children.map((child) => readEntryFiles(child, relativePath)))
  return nested.flat()
}

function fileListPayload(dataTransfer: DataTransfer | null): SkillDropPayload | undefined {
  const files = Array.from(dataTransfer?.files ?? [])
  if (files.length === 0) return undefined
  const first = files[0]!
  if (files.length === 1 && first.name.toLowerCase().endsWith(".zip")) {
    return { sourceName: first.name, archive: first }
  }
  if (files.length === 1 && !first.webkitRelativePath) {
    return { sourceName: first.name, file: first }
  }
  return {
    sourceName: first.webkitRelativePath.split("/")[0] || first.name,
    files: files.map((file) => ({
      path: file.webkitRelativePath || file.name,
      contentBase64: "",
    })),
  }
}

async function droppedSkillPayload(event: DragEvent): Promise<SkillDropPayload | undefined> {
  const entries = dataTransferEntries(event.dataTransfer)
  if (entries.length > 0) {
    if (entries.length === 1 && entries[0]!.isFile) {
      const file = await readFileEntry(entries[0] as WebkitFileSystemFileEntry)
      return file.name.toLowerCase().endsWith(".zip")
        ? { sourceName: file.name, archive: file }
        : { sourceName: file.name, file }
    }
    const files = (await Promise.all(entries.map((entry) => readEntryFiles(entry)))).flat()
    const sourceName = entries.length === 1 ? entries[0]!.name : "dropped-skills"
    return { sourceName, files }
  }

  const payload = fileListPayload(event.dataTransfer)
  if (!payload?.files) return payload
  const files = Array.from(event.dataTransfer?.files ?? [])
  return {
    ...payload,
    files: await Promise.all(
      files.map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        contentBase64: await fileToBase64(file),
      })),
    ),
  }
}

function policyLabel(policy: string): string {
  if (policy === "ask") return t("skill.policy.ask")
  if (policy === "allow") return t("skill.policy.allow")
  if (policy === "deny") return t("skill.policy.deny")
  return policy
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

// ── Extension Settings Panels ──

type ExtensionPanelMode = "skill" | "mcp" | "skill-market"
const MCP_STATUS_REFRESH_INTERVAL_MS = 1_000

interface FormSelectOption {
  value: string
  label: string
}

function PanelActionButton(props: {
  icon: IconName
  label: string
  tone?: "neutral" | "accent" | "danger"
  disabled?: boolean
  compact?: boolean
  onClick: () => void | Promise<void>
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      tone={props.tone || "neutral"}
      data-ui="tool-panel-action"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => void props.onClick()}
    >
      <Icon name={props.icon} />
      <Show when={!props.compact}>
        <span class="tool-panel-action-label">{props.label}</span>
      </Show>
    </Button>
  )
}

function FormSelectOptionItem(props: Select.SelectRootItemComponentProps<FormSelectOption>): JSX.Element {
  const option = () => props.item.rawValue
  return (
    <Select.Item item={props.item} class="oc-select-option settings-form-select-option" data-value={option().value}>
      <Select.ItemLabel>{option().label}</Select.ItemLabel>
      <Select.ItemIndicator class="oc-select-indicator">
        <Icon name="status-completed" size={12} />
      </Select.ItemIndicator>
    </Select.Item>
  )
}

function FormSelect(props: {
  value: string
  options: FormSelectOption[]
  ariaLabel: string
  onChange: (value: string) => void
}): JSX.Element {
  const selectedOption = () => props.options.find((option) => option.value === props.value) ?? props.options[0] ?? null
  const setSelectedOption = (option: FormSelectOption | null) => {
    if (!option || option.value === props.value) return
    props.onChange(option.value)
  }
  return (
    <Select.Root<FormSelectOption>
      class="settings-form-select"
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={selectedOption()}
      onChange={setSelectedOption}
      itemComponent={FormSelectOptionItem}
      disallowEmptySelection
      gutter={4}
      sameWidth
    >
      <Select.Trigger class="field-input oc-select-trigger settings-form-select-trigger" aria-label={props.ariaLabel}>
        <Select.Value<FormSelectOption>>
          {(state) => <span>{state.selectedOption()?.label ?? ""}</span>}
        </Select.Value>
        <Select.Icon>
          <Icon name="caret-down" size={12} />
        </Select.Icon>
      </Select.Trigger>
      <Select.HiddenSelect aria-label={props.ariaLabel} />
      <Select.Portal>
        <Select.Content class="oc-select-content settings-form-select-content">
          <Select.Listbox class="oc-select-listbox settings-form-select-listbox" />
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

function ExtensionSettingsPanel(props: { mode: ExtensionPanelMode; active?: boolean; compact?: boolean }) {
  const nativeCommands = getHostTransport().capabilities.nativeCommands
  const canOpenLocalPath = createMemo(() => nativeCommands["open-path"])
  const canOpenRemoteUrl = createMemo(() => nativeCommands["open-url"])
  const canPickSkillDirectory = createMemo(() => nativeCommands["workspace.pickDir"])
  const skillSourceOptions = (): FormSelectOption[] => [
    { value: "path", label: t("skill.source.path") },
    { value: "url", label: t("skill.source.url") },
    { value: "git", label: t("skill.source.git") },
  ]
  const skillPolicyOptions = (): FormSelectOption[] => [
    { value: "ask", label: t("skill.policy.ask") },
    { value: "allow", label: t("skill.policy.allow") },
    { value: "deny", label: t("skill.policy.deny") },
  ]
  const mcpTypeOptions = (): FormSelectOption[] => [
    { value: "remote", label: t("mcp.type.remote") },
    { value: "local", label: t("mcp.type.local") },
  ]
  const [notice, setNotice] = createSignal("")
  const [noticeStatus, setNoticeStatus] = createSignal<"active" | "error" | "warn">("error")
  const [loading, setLoading] = createSignal(false)
  const [loadedMarketDirectory, setLoadedMarketDirectory] = createSignal("")
  const [skillDragActive, setSkillDragActive] = createSignal(false)

  function setPanelNotice(message: string, status: "active" | "error" | "warn" = "error") {
    setNotice(message)
    setNoticeStatus(status)
  }

  // Reactive data from appStore (populated by loadExtensions/loadSkillMarket after connect)
  const skills = createMemo((): SkillItem[] => {
    const raw = appStore.skills
    return Array.isArray(raw) ? (raw as SkillItem[]) : []
  })
  const mcp = createMemo((): Record<string, McpItem> => {
    const raw = appStore.mcp
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, McpItem>) : {}
  })
  const market = createMemo((): MarketItem[] => {
    const raw = appStore.skillMarket
    return Array.isArray(raw) ? (raw as MarketItem[]) : []
  })

  const customSkills = createMemo(() => skills().filter((item) => !item.builtin))
  const removableSkills = createMemo(() => customSkills().filter(skillRemovable))
  const builtinCount = createMemo(() => skills().length - customSkills().length)
  const mcpEntries = createMemo(() => Object.entries(mcp()))

  async function reloadAll() {
    setLoading(true)
    setNotice("")
    try {
      await Promise.all([loadExtensions(), loadSkillMarket()])
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveSkill(source: string, kind: string, name: string) {
    if (!confirm(t("skill.delete_confirm", { name }))) return
    try {
      await apiJson("skill/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, kind }),
      })
      await reloadAll()
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleOpenSkill(location: string) {
    if (isRemoteUrl(location) ? !canOpenRemoteUrl() : !canOpenLocalPath()) return
    try {
      await nativeOpen(location)
    } catch {
      // ignore
    }
  }

  async function handleDeleteAllSkills() {
    const list = removableSkills()
    if (list.length === 0) return
    const message =
      list.length === customSkills().length
        ? t("skill.delete_all_confirm_all", { count: list.length })
        : t("skill.delete_all_confirm_partial", {
            removable: list.length,
            blocked: customSkills().length - list.length,
          })
    if (!confirm(message)) return
    try {
      for (const item of list) {
        await apiJson("skill/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: item.source, kind: skillRemoveKind(item) }),
        })
      }
      await reloadAll()
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDeleteAllMcp() {
    const names = mcpEntries().map(([name]) => name)
    if (names.length === 0) return
    if (!confirm(t("mcp.delete_all_confirm", { count: names.length }))) return
    try {
      await Promise.all(
        names.map((name) =>
          apiJson(`mcp/${encodeURIComponent(name)}/disconnect`, { method: "POST" }).catch(() => void 0),
        ),
      )
      await Promise.all(
        names.map((name) => apiJson(`mcp/${encodeURIComponent(name)}/auth`, { method: "DELETE" }).catch(() => void 0)),
      )
      await updateConfig((current: any) => {
        delete current.mcp
      })
      await reloadAll()
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleInstall(item: MarketItem) {
    if (!item.source || item.install_kind === "manual") return
    try {
      await apiJson("skill/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: item.install_kind,
          value: item.source,
          policy: item.recommended_policy || undefined,
        }),
      })
      await reloadAll()
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleOpenHomepage(url: string | undefined) {
    if (!url) return
    if (!canOpenRemoteUrl()) return
    await nativeOpen(url)
  }

  // ── Add Skill inline form ──

  const [showAddSkill, setShowAddSkill] = createSignal(false)
  const [skillForm, setSkillForm] = createStore({
    type: "path" as "path" | "url" | "git",
    value: "",
    policy: "ask" as "ask" | "allow" | "deny",
  })

  async function handleAddSkill() {
    const value = skillForm.value.trim()
    if (!value) return
    try {
      await apiJson("skill/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: skillForm.type,
          value,
          policy: skillForm.policy,
        }),
      })
      setSkillForm({ type: "path", value: "", policy: "ask" })
      setShowAddSkill(false)
      await reloadAll()
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDroppedSkillDrop(event: DragEvent) {
    if (!activeDirectory()) {
      setPanelNotice(t("workspace.no_directory"), "warn")
      return
    }
    try {
      const payload = await droppedSkillPayload(event)
      if (!payload) return
      if (!confirm(t("skill.drop_confirm", { name: payload.sourceName }))) return
      setLoading(true)
      setNotice("")
      const imported = payload.archive
        ? await importSkillArchive(payload.archive.name, await fileToBase64(payload.archive), skillForm.policy)
        : payload.files
          ? await importSkillPackage(payload.sourceName, payload.files, skillForm.policy)
          : payload.file
            ? await importSkillFile(payload.file.name, await payload.file.text(), skillForm.policy)
            : undefined
      if (!imported) return
      const installedNames = imported.names?.length ? imported.names.join(", ") : imported.name
      setPanelNotice(t("skill.drop_success", { name: installedNames }), "active")
      await reloadAll()
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setSkillDragActive(false)
      setLoading(false)
    }
  }

  async function handleBrowseFolder() {
    if (!canPickSkillDirectory()) return
    try {
      const selected = await pickDirectory()
      if (selected) {
        setSkillForm("value", selected)
      }
    } catch {
      // Host has no directory picker (vite preview). User can paste
      // the path manually into the field.
    }
  }

  async function handleReloadSkills() {
    await reloadAll()
  }

  // Ensure market data is loaded once per active project directory.
  createEffect(() => {
    const directory = activeDirectory()
    if (props.mode !== "skill-market" || props.active !== true) return
    if (!directory) {
      setLoadedMarketDirectory("")
      setPanelNotice(t("workspace.no_directory"), "warn")
      return
    }
    if (loadedMarketDirectory() === directory) return
    setLoadedMarketDirectory(directory)
    setNotice("")
    loadSkillMarket().catch((e) => {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    })
  })

  createEffect(() => {
    if (props.mode !== "skill" || props.active !== true) return

    loadInstalledSkills().catch((e) => {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    })
  })

  createEffect(() => {
    if (props.mode !== "mcp" || props.active !== true) return

    const refresh = () => {
      loadMcpStatus().catch((e) => {
        setPanelNotice(e instanceof Error ? e.message : String(e))
      })
    }
    const interval = createVisibilityInterval(refresh, MCP_STATUS_REFRESH_INTERVAL_MS, {
      onVisible: refresh,
    })
    refresh()
    interval.start()

    onCleanup(() => {
      interval.dispose()
    })
  })

  async function handleOpenSkillDir() {
    if (!canOpenLocalPath()) return
    try {
      const dirs = await apiJson("skill/directories")
      const target = (dirs as any)?.global_config || (dirs as any)?.managed_skills
      if (!target) return
      await nativeOpen(target)
    } catch {
      // ignore
    }
  }

  // ── Add MCP inline form ──

  const [showAddMcp, setShowAddMcp] = createSignal(false)
  const [mcpForm, setMcpForm] = createStore({
    name: "",
    type: "remote" as "remote" | "local",
    url: "",
    command: "",
    args: "",
  })

  async function handleAddMcp() {
    try {
      await addMcpServer({
        name: mcpForm.name,
        type: mcpForm.type,
        url: mcpForm.url,
        command: mcpForm.command,
        args: mcpForm.args,
      })
      setMcpForm({ name: "", type: "remote", url: "", command: "", args: "" })
      setShowAddMcp(false)
      await reloadAll()
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <Show when={loading()}>
        <div class="loading-hint">{t("common.loading")}</div>
      </Show>

      <Show when={notice()}>
        <div class="config-status-box" data-status={noticeStatus()}>
          {notice()}
          <Button type="button" variant="ghost" size="sm" tone="neutral" onClick={() => setNotice("")}>
            {t("common.dismiss")}
          </Button>
        </div>
      </Show>

      {/* ── Installed Skills ── */}
      <Show when={props.mode === "skill"}>
        <section
          class="ext-group"
          data-compact={props.compact ? "true" : "false"}
          data-skill-drop-active={skillDragActive() ? "true" : "false"}
          onDragEnter={(event) => {
            event.preventDefault()
            setSkillDragActive(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
            setSkillDragActive(true)
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setSkillDragActive(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setSkillDragActive(false)
            void handleDroppedSkillDrop(event)
          }}
        >
          <Show
            when={props.compact}
            fallback={
              <SurfaceHeader
                variant="settings-group"
                title={t("skill.title")}
                actions={
                  <>
                    <PanelActionButton icon="refresh" label={t("common.reload")} onClick={handleReloadSkills} />
                    <Show when={canOpenLocalPath()}>
                      <PanelActionButton icon="folder-open" label={t("skill.open_dir")} onClick={handleOpenSkillDir} />
                    </Show>
                    <PanelActionButton
                      icon="plus"
                      label={t("skill.add")}
                      onClick={() => void setShowAddSkill(!showAddSkill())}
                    />
                    <PanelActionButton
                      icon="cancel"
                      label={t("skill.delete_all")}
                      tone="danger"
                      disabled={removableSkills().length === 0}
                      onClick={handleDeleteAllSkills}
                    />
                  </>
                }
              />
            }
          >
            <div class="tool-panel-toolbar" role="toolbar" aria-label={t("skill.title")}>
              <PanelActionButton compact icon="refresh" label={t("common.reload")} onClick={handleReloadSkills} />
              <Show when={canOpenLocalPath()}>
                <PanelActionButton compact icon="folder-open" label={t("skill.open_dir")} onClick={handleOpenSkillDir} />
              </Show>
              <PanelActionButton
                compact
                icon="plus"
                label={t("skill.add")}
                onClick={() => void setShowAddSkill(!showAddSkill())}
              />
              <PanelActionButton
                compact
                icon="cancel"
                label={t("skill.delete_all")}
                tone="danger"
                disabled={removableSkills().length === 0}
                onClick={handleDeleteAllSkills}
              />
            </div>
          </Show>
          <div class="ext-group-body">
            <div
              class="skill-drop-zone"
              data-active={skillDragActive() ? "true" : "false"}
            >
              <span class="skill-drop-zone__icon" aria-hidden="true">
                <Icon name="upload" />
              </span>
              <span class="skill-drop-zone__copy">
                <strong>{t("skill.drop_title")}</strong>
                <span>{t("skill.drop_hint")}</span>
              </span>
            </div>

            {/* Add Skill inline form */}
            <Show when={showAddSkill()}>
              <div class="config-inline-form">
                <label class="field">
                  <span class="field-label">{t("skill.source_type")}</span>
                  <FormSelect
                    value={skillForm.type}
                    options={skillSourceOptions()}
                    ariaLabel={t("skill.source_type")}
                    onChange={(value) => setSkillForm("type", value as any)}
                  />
                </label>
                <label class="field">
                  <span class="field-label">{t("skill.value")}</span>
                  <div class="field-input-group">
                    <input
                      class="field-input"
                      type="text"
                      value={skillForm.value}
                      placeholder={t("skill.value_placeholder")}
                      onInput={(e) => setSkillForm("value", e.currentTarget.value)}
                    />
                    <Show when={skillForm.type === "path" && canPickSkillDirectory()}>
                      <Button type="button" variant="ghost" size="sm" tone="neutral" onClick={handleBrowseFolder}>
                        {t("skill.browse_folder")}
                      </Button>
                    </Show>
                  </div>
                </label>
                <label class="field">
                  <span class="field-label">{t("skill.policy")}</span>
                  <FormSelect
                    value={skillForm.policy}
                    options={skillPolicyOptions()}
                    ariaLabel={t("skill.policy")}
                    onChange={(value) => setSkillForm("policy", value as any)}
                  />
                </label>
                <div class="dialog-actions compact">
                  <Button type="button" variant="ghost" size="sm" tone="neutral" onClick={() => setShowAddSkill(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="solid"
                    size="sm"
                    tone="accent"
                    disabled={!skillForm.value.trim()}
                    onClick={handleAddSkill}
                  >
                    {t("skill.install")}
                  </Button>
                </div>
              </div>
            </Show>
            <div class="extension-list" id="skillList">
              <Show when={skills().length > 0} fallback={<div class="empty-hint">{t("skill.none_custom")}</div>}>
                <For each={skills()}>
                  {(item) => (
                    <div class="extension-row">
                      <div class="extension-row-main">
                        <strong>{item.name}</strong>
                        <span>{item.description || ""}</span>
                        <small>{item.location || ""}</small>
                      </div>
                      <div class="extension-row-actions">
                        <Show when={skillRemovable(item)}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            tone="danger"
                            title={t("skill.delete_button_title")}
                            aria-label={t("skill.delete_button_title")}
                            onClick={() => handleRemoveSkill(item.source || "", skillRemoveKind(item), item.name)}
                          >
                            {t("common.delete")}
                          </Button>
                        </Show>
                        <Show
                          when={
                            item.location &&
                            item.location !== "builtin" &&
                            (isRemoteUrl(item.location) ? canOpenRemoteUrl() : canOpenLocalPath())
                          }
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            tone="neutral"
                            title={t("skill.open_button_title")}
                            aria-label={t("skill.open_button_title")}
                            onClick={() => handleOpenSkill(item.location!)}
                          >
                            {t("common.open")}
                          </Button>
                        </Show>
                        <span class="extension-status" data-state="connected">
                          {item.builtin ? t("skill.builtin") : t("common.loaded")}
                        </span>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </section>
      </Show>

      {/* ── MCP Servers ── */}
      <Show when={props.mode === "mcp"}>
        <section class="ext-group" data-compact={props.compact ? "true" : "false"}>
          <Show
            when={props.compact}
            fallback={
              <SurfaceHeader
                variant="settings-group"
                title={t("mcp.title")}
                actions={
                  <>
                    <PanelActionButton
                      icon="plus"
                      label={t("mcp.add_action")}
                      onClick={() => void setShowAddMcp(!showAddMcp())}
                    />
                    <PanelActionButton
                      icon="cancel"
                      label={t("mcp.delete_all")}
                      tone="danger"
                      disabled={mcpEntries().length === 0}
                      onClick={handleDeleteAllMcp}
                    />
                  </>
                }
              />
            }
          >
            <div class="tool-panel-toolbar" role="toolbar" aria-label={t("mcp.title")}>
              <PanelActionButton
                compact
                icon="plus"
                label={t("mcp.add_action")}
                onClick={() => void setShowAddMcp(!showAddMcp())}
              />
              <PanelActionButton
                compact
                icon="cancel"
                label={t("mcp.delete_all")}
                tone="danger"
                disabled={mcpEntries().length === 0}
                onClick={handleDeleteAllMcp}
              />
            </div>
          </Show>
          <div class="ext-group-body">
            {/* Add MCP inline form */}
            <Show when={showAddMcp()}>
              <div class="config-inline-form">
                <label class="field">
                  <span class="field-label">{t("mcp.name")}</span>
                  {/* Fixed MCP server-name example. */}
                  <input
                    class="field-input"
                    type="text"
                    value={mcpForm.name}
                    placeholder="exa"
                    onInput={(e) => setMcpForm("name", e.currentTarget.value)}
                  />
                </label>
                <label class="field">
                  <span class="field-label">{t("mcp.type")}</span>
                  <FormSelect
                    value={mcpForm.type}
                    options={mcpTypeOptions()}
                    ariaLabel={t("mcp.type")}
                    onChange={(value) => setMcpForm("type", value as any)}
                  />
                </label>
                <Show when={mcpForm.type === "remote"}>
                  <label class="field">
                    <span class="field-label">{t("mcp.remote_url")}</span>
                    {/* Fixed remote MCP URL example. */}
                    <input
                      class="field-input"
                      type="url"
                      value={mcpForm.url}
                      placeholder="https://example.com/mcp"
                      onInput={(e) => setMcpForm("url", e.currentTarget.value)}
                    />
                  </label>
                </Show>
                <Show when={mcpForm.type === "local"}>
                  <label class="field">
                    <span class="field-label">{t("mcp.command")}</span>
                    {/* Fixed command example. */}
                    <input
                      class="field-input"
                      type="text"
                      value={mcpForm.command}
                      placeholder="npx"
                      onInput={(e) => setMcpForm("command", e.currentTarget.value)}
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">{t("mcp.arguments")}</span>
                    {/* Fixed command-line argument example. */}
                    <input
                      class="field-input"
                      type="text"
                      value={mcpForm.args}
                      placeholder="-y @modelcontextprotocol/server-filesystem C:\repo"
                      onInput={(e) => setMcpForm("args", e.currentTarget.value)}
                    />
                  </label>
                </Show>
                <div class="dialog-actions compact">
                  <Button type="button" variant="ghost" size="sm" tone="neutral" onClick={() => setShowAddMcp(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="solid"
                    size="sm"
                    tone="accent"
                    disabled={
                      !mcpForm.name.trim() ||
                      (mcpForm.type === "remote" ? !mcpForm.url.trim() : !mcpForm.command.trim())
                    }
                    onClick={handleAddMcp}
                  >
                    {t("mcp.add_action")}
                  </Button>
                </div>
              </div>
            </Show>
            <div class="extension-list" id="mcpList">
              <Show when={mcpEntries().length > 0} fallback={<div class="empty-hint">{t("mcp.none")}</div>}>
                <For each={mcpEntries()}>
                  {([name, item]) => {
                    const status = item?.status || "disabled"
                    const detail = item?.error || ""
                    return (
                      <div class="extension-row">
                        <div class="extension-row-main">
                          <strong>{name}</strong>
                          <span>{detail ? detail : mcpStatusLabel(status)}</span>
                        </div>
                        <span class="extension-status" data-state={status}>
                          {mcpStatusLabel(status)}
                        </span>
                      </div>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        </section>
      </Show>

      {/* ── Skill Market ── */}
      <Show when={props.mode === "skill-market"}>
        <section class="ext-group">
          <SurfaceHeader variant="settings-group" title={t("skill.market.title")} />
          <div class="ext-group-body">
            <div class="extension-list" id="skillMarketList">
              <Show when={market().length > 0} fallback={<div class="empty-hint">{t("skill.market.none")}</div>}>
                <For each={market()}>
                  {(item) => {
                    const installable = !!item.source && item.install_kind !== "manual"
                    return (
                      <div class="market-card">
                        <div class="market-card-main">
                          <strong>{item.name}</strong>
                          <span>
                            {item.provider} · {item.trust} · {item.install_kind}
                          </span>
                          <small>{item.description || ""}</small>
                          <Show when={item.notes}>
                            <small>{item.notes}</small>
                          </Show>
                        </div>
                        <div class="market-card-actions">
                          <span class="extension-status" data-state={item.recommended_policy || ""}>
                            {policyLabel(item.recommended_policy || "")}
                          </span>
                          <Show
                            when={installable}
                            fallback={
                              <Show when={item.homepage && canOpenRemoteUrl()}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  tone="neutral"
                                  title={t("skill.market.open_site_title")}
                                  aria-label={t("skill.market.open_site_title")}
                                  onClick={() => handleOpenHomepage(item.homepage)}
                                >
                                  {t("skill.market.open_site")}
                                </Button>
                              </Show>
                            }
                          >
                            <Button
                              type="button"
                              variant="solid"
                              size="sm"
                              tone="accent"
                              title={t("skill.market.install_button_title")}
                              aria-label={t("skill.market.install_button_title")}
                              onClick={() => handleInstall(item)}
                            >
                              {t("skill.install")}
                            </Button>
                          </Show>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        </section>
      </Show>
    </>
  )
}

export function SkillsPanel(props: { active?: boolean; compact?: boolean } = {}) {
  return <ExtensionSettingsPanel mode="skill" active={props.active ?? true} compact={props.compact} />
}

export function McpPanel(props: { compact?: boolean } = {}) {
  return <ExtensionSettingsPanel mode="mcp" active={true} compact={props.compact} />
}

export function SkillMarketPanel(props: { active?: boolean }) {
  return <ExtensionSettingsPanel mode="skill-market" active={props.active} />
}

export default SkillMarketPanel
