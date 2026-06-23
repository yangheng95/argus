// ── SkillMarketPanel ──
// Solid.js component for managing skills, MCP servers, and marketplace.
// Displays:
// • Installed custom skills with add/remove/open actions
// • Installed MCP servers with add/remove actions
// • Skill market catalog with install / open-site actions
// All CRUD operations are self-contained — no dependency on static HTML dialogs.

import { createEffect, createSignal, createMemo, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { t } from "../../utils/i18n"
import { apiJson, configure as configureApi } from "../../services/api"
import { pickDirectory, syncActiveDirectoryApiContext } from "../../services/workspace"
import { appStore } from "../../store/app"
import { updateConfig } from "../../services/config"
import { getHostTransport } from "../../services/host-transport"
import { nativeConfirm, nativeOpen } from "../../utils/native"
import { createVisibilityInterval } from "../../utils/visibility-interval"
import {
  loadInstalledSkills,
  loadSkillMountMatrix,
  loadMcpStatus,
  loadSkillMarket,
  deleteAllSkills,
  importSkillArchive,
  importAndMountSkill,
  importSkillFile,
  importSkillPackage,
  mountSkill,
  unmountSkill,
  type AgentSkillMountMatrix,
  type SkillImportPackageFile,
} from "../../services/extensions"
import { addMcpServer, deleteAllMcp } from "../../services/mcp"
import {
  mcpConnectionStatusOrDisabledLabel,
  mcpConnectionStatusOrDisabledTone,
} from "../../utils/settings-status-labels"
import { Button } from "../ui/Button"
import { Icon, type IconName } from "../Icon"
import {
  SettingsGroup,
  SettingsPill,
  SettingsRow,
  SettingsSelect,
  type SettingsPillTone,
  type SettingsSelectOption,
} from "./primitives"

// ── Types ──

interface SkillItem {
  name: string
  description?: string
  location?: string
  source?: string
  source_type?: string
  builtin?: boolean
  duplicate_locations?: string[]
  mounted_agents?: string[]
  unmounted?: boolean
  warning?: string
}

interface MountedSkillItem {
  name: string
  description?: string
  location?: string
  enabled: boolean
  reason?: string
}

interface AgentSkillRow {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  skill_tool_available: boolean
  mounted: MountedSkillItem[]
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

function skillDuplicateLocations(item: SkillItem): string[] {
  return Array.isArray(item.duplicate_locations) ? item.duplicate_locations.filter(Boolean) : []
}

function skillDuplicateTitle(item: SkillItem): string {
  return t("skill.duplicate_locations_title", { locations: skillDuplicateLocations(item).join("\n") })
}

function dataTransferEntries(dataTransfer: DataTransfer | null): WebkitFileSystemEntry[] {
  if (!dataTransfer?.items?.length) return []
  const entries: WebkitFileSystemEntry[] = []
  for (const item of Array.from(dataTransfer.items)) {
    const entry = (
      item as DataTransferItem & {
        webkitGetAsEntry?: () => unknown
      }
    ).webkitGetAsEntry?.() as WebkitFileSystemEntry | null | undefined
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

function policyTone(policy: string): SettingsPillTone {
  if (policy === "allow") return "ok"
  if (policy === "ask") return "warn"
  if (policy === "deny") return "bad"
  return "muted"
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requireManagedSkillDirectory(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("skill/directories returned a non-object payload")
  }
  const managedSkills = (value as Record<string, unknown>).managed_skills
  if (typeof managedSkills !== "string" || !managedSkills.trim()) {
    throw new Error("skill/directories returned no managed_skills path")
  }
  return managedSkills.trim()
}

function skillMountMatrix(value: unknown): AgentSkillMountMatrix | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const matrix = value as AgentSkillMountMatrix
  if (!Array.isArray(matrix.skills) || !Array.isArray(matrix.agents) || !Array.isArray(matrix.matrix)) return undefined
  return matrix
}

function mountedAgentLabel(count: number): string {
  if (count <= 0) return t("skill.mount.unmounted")
  return t("skill.mount.mounted_count", { count })
}

function mountedAgentsFor(item: SkillItem): string[] {
  return Array.isArray(item.mounted_agents) ? item.mounted_agents : []
}

function mountedSkillFor(agent: AgentSkillRow, skill: SkillItem): MountedSkillItem | undefined {
  return agent.mounted.find((item) => item.name === skill.name)
}

function skillSourceRoot(item: SkillItem): string {
  if (item.builtin) return "builtin"
  const location = `${item.location || item.source || ""}`.replaceAll("\\", "/")
  const roots = [".opencorvus", ".claude", ".agents", ".codex"]
  return roots.find((root) => location.includes(`/${root}/`) || location.includes(`${root}/`)) || ""
}

function agentColumnLabel(name: string): string {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (parts.length <= 1) return name.slice(0, 4)
  const compact = parts.map((part) => part[0]).join("")
  return (compact || name).slice(0, 4)
}

// ── Extension Settings Panels ──

type ExtensionPanelMode = "skill" | "mcp" | "skill-market"
const MCP_STATUS_REFRESH_INTERVAL_MS = 1_000

interface FormSelectOption extends SettingsSelectOption {}

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

function FormSelect(props: {
  value: string
  options: FormSelectOption[]
  ariaLabel: string
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <SettingsSelect<FormSelectOption>
      class="settings-form-select"
      value={props.value}
      options={props.options}
      ariaLabel={props.ariaLabel}
      onChange={props.onChange}
      triggerClass="settings-form-select-trigger"
      contentClass="settings-form-select-content"
      listboxClass="settings-form-select-listbox"
      optionClass="settings-form-select-option"
      optionData={(option) => ({ "data-value": option.value })}
    />
  )
}

type DirectoryProp = string | (() => string | undefined)

function ExtensionSettingsPanel(props: {
  mode: ExtensionPanelMode
  active?: boolean
  compact?: boolean
  directory?: DirectoryProp
}) {
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

  function currentDirectory(): string {
    if (props.directory !== undefined) {
      const value = typeof props.directory === "function" ? props.directory() : props.directory
      const directory = String(value || "").trim()
      configureApi({ directory })
      return directory
    }
    return syncActiveDirectoryApiContext().trim()
  }

  function requireActiveDirectory(): boolean {
    if (currentDirectory()) return true
    setPanelNotice(t("workspace.no_directory"), "warn")
    return false
  }

  const skills = createMemo((): SkillItem[] => [...(appStore.skills as SkillItem[])])
  const mounts = createMemo(() => skillMountMatrix(appStore.skillMounts))
  const poolSkills = createMemo(() => mounts()?.skills ?? skills())
  const agentRows = createMemo(() => {
    const matrix = mounts()
    if (!matrix) return []
    const rows = new Map(matrix.matrix.map((row) => [row.agent, row.mounted]))
    return matrix.agents.map((agent) => ({
      ...agent,
      mounted: rows.get(agent.name) ?? [],
    })) as AgentSkillRow[]
  })
  const matrixGridTemplate = createMemo(() => {
    const agentColumns = agentRows()
      .map(() => "minmax(calc(28px * var(--ui-scale)), calc(28px * var(--ui-scale)))")
      .join(" ")
    return `minmax(calc(120px * var(--ui-scale)), 1fr) ${agentColumns}`.trim()
  })
  const mcp = createMemo((): Record<string, McpItem> => ({ ...(appStore.mcp as Record<string, McpItem>) }))
  const market = createMemo((): MarketItem[] => [...(appStore.skillMarket as MarketItem[])])

  const customSkills = createMemo(() => poolSkills().filter((item) => !item.builtin))
  const removableSkills = createMemo(() => customSkills().filter(skillRemovable))
  const builtinCount = createMemo(() => poolSkills().length - customSkills().length)
  const mcpEntries = createMemo(() => Object.entries(mcp()))

  async function refreshInstalledSkills() {
    return (await loadInstalledSkills()) as SkillItem[]
  }

  async function refreshSkillMounts() {
    if (!currentDirectory()) return undefined
    return await loadSkillMountMatrix()
  }

  async function refreshMcpStatus() {
    return (await loadMcpStatus()) as Record<string, McpItem>
  }

  async function reloadAll() {
    if (!requireActiveDirectory()) return
    setLoading(true)
    setNotice("")
    try {
      await Promise.all([refreshInstalledSkills(), refreshSkillMounts(), refreshMcpStatus(), loadSkillMarket()])
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveSkill(source: string, kind: string, name: string) {
    if (!(await nativeConfirm(t("skill.delete_confirm", { name })))) return
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
      const opened = await nativeOpen(location)
      if (!opened) throw new Error("native open returned false")
    } catch (e) {
      setPanelNotice(t("skill.open_failed", { error: errorDetail(e) }))
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
    if (!(await nativeConfirm(message))) return
    try {
      await deleteAllSkills()
      await reloadAll()
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDeleteAllMcp() {
    const names = mcpEntries().map(([name]) => name)
    if (names.length === 0) return
    if (!(await nativeConfirm(t("mcp.delete_all_confirm", { count: names.length })))) return
    try {
      await deleteAllMcp()
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

  async function droppedSkillImportPayload(payload: SkillDropPayload): Promise<Record<string, unknown> | undefined> {
    if (payload.archive) {
      return {
        filename: payload.archive.name,
        archiveBase64: await fileToBase64(payload.archive),
        policy: skillForm.policy,
      }
    }
    if (payload.files) {
      return {
        sourceName: payload.sourceName,
        files: payload.files,
        policy: skillForm.policy,
      }
    }
    if (payload.file) {
      return {
        filename: payload.file.name,
        content: await payload.file.text(),
        policy: skillForm.policy,
      }
    }
    return undefined
  }

  async function handleOpenHomepage(url: string | undefined) {
    if (!url) return
    if (!canOpenRemoteUrl()) return
    try {
      const opened = await nativeOpen(url)
      if (!opened) throw new Error("native open returned false")
    } catch (e) {
      setPanelNotice(t("skill.open_failed", { error: errorDetail(e) }))
    }
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
    if (!requireActiveDirectory()) return
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
    if (!currentDirectory()) {
      setPanelNotice(t("workspace.no_directory"), "warn")
      return
    }
    try {
      const payload = await droppedSkillPayload(event)
      if (!payload) return
      if (!(await nativeConfirm(t("skill.drop_confirm", { name: payload.sourceName })))) return
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

  async function handleMount(agent: string, skill: string) {
    if (!requireActiveDirectory()) return
    try {
      setLoading(true)
      setNotice("")
      await mountSkill(agent, skill)
      setPanelNotice(t("skill.mount.success", { skill, agent }), "active")
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleUnmount(agent: string, skill: string) {
    if (!requireActiveDirectory()) return
    try {
      setLoading(true)
      setNotice("")
      await unmountSkill(agent, skill)
      setPanelNotice(t("skill.mount.removed", { skill, agent }), "active")
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleAgentDrop(agent: string, event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    setSkillDragActive(false)
    if (!requireActiveDirectory()) return
    const skillName = event.dataTransfer?.getData("application/x-opencorvus-skill")
    if (skillName) {
      await handleMount(agent, skillName)
      return
    }
    try {
      const payload = await droppedSkillPayload(event)
      if (!payload) return
      if (!(await nativeConfirm(t("skill.drop_mount_confirm", { name: payload.sourceName, agent })))) return
      const body = await droppedSkillImportPayload(payload)
      if (!body) return
      setLoading(true)
      setNotice("")
      await importAndMountSkill(agent, body)
      setPanelNotice(t("skill.drop_mount_success", { name: payload.sourceName, agent }), "active")
    } catch (e) {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    } finally {
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
    } catch (e) {
      setPanelNotice(t("skill.pick_folder_failed", { error: errorDetail(e) }))
    }
  }

  async function handleReloadSkills() {
    await reloadAll()
  }

  // Ensure market data is loaded once per active project directory.
  createEffect(() => {
    if (props.mode !== "skill-market" || props.active !== true) return
    const directory = currentDirectory()
    if (!directory) {
      setLoadedMarketDirectory("")
      setPanelNotice(t("workspace.no_directory"), "warn")
      return
    }
    if (loadedMarketDirectory() === directory) return
    setNotice("")
    loadSkillMarket()
      .then(() => setLoadedMarketDirectory(directory))
      .catch((e) => {
        setPanelNotice(e instanceof Error ? e.message : String(e))
      })
  })

  createEffect(() => {
    if (!props.compact) return
    if (props.active !== true) return
    const directory = currentDirectory()
    if (!directory) return

    if (props.mode === "skill") {
      refreshSkillMounts().catch((e) => {
        setPanelNotice(e instanceof Error ? e.message : String(e))
      })
      return
    }
    if (props.mode === "mcp") {
      refreshMcpStatus().catch((e) => {
        setPanelNotice(e instanceof Error ? e.message : String(e))
      })
    }
  })

  createEffect(() => {
    if (props.mode !== "skill" || props.active !== true) return
    const directory = currentDirectory()
    if (!directory) {
      setPanelNotice(t("workspace.no_directory"), "warn")
      return
    }

    setNotice("")
    refreshSkillMounts().catch((e) => {
      setPanelNotice(e instanceof Error ? e.message : String(e))
    })
  })

  createEffect(() => {
    if (props.mode !== "mcp" || props.active !== true) return
    const directory = currentDirectory()
    if (!directory) {
      setPanelNotice(t("workspace.no_directory"), "warn")
      return
    }

    const refresh = () => {
      refreshMcpStatus().catch((e) => {
        setPanelNotice(e instanceof Error ? e.message : String(e))
      })
    }
    setNotice("")
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
      const target = requireManagedSkillDirectory(dirs)
      const opened = await nativeOpen(target)
      if (!opened) throw new Error("native open returned false")
    } catch (e) {
      setPanelNotice(t("skill.open_dir_failed", { error: errorDetail(e) }))
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
    if (!requireActiveDirectory()) return
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
          <span class="config-status-box__text">{notice()}</span>
          <Button
            type="button"
            variant="ghost"
            size={props.compact ? "icon" : "sm"}
            tone="neutral"
            title={t("common.dismiss")}
            aria-label={t("common.dismiss")}
            onClick={() => setNotice("")}
          >
            <Show when={props.compact} fallback={t("common.dismiss")}>
              <Icon name="cancel" />
            </Show>
          </Button>
        </div>
      </Show>

      {/* ── Installed Skills ── */}
      <Show when={props.mode === "skill"}>
        <SettingsGroup
          class="extension-settings-group"
          data-compact={props.compact ? "true" : "false"}
          data-skill-drop-active={skillDragActive() ? "true" : "false"}
          title={props.compact ? undefined : t("skill.title")}
          actions={
            props.compact ? undefined : (
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
            )
          }
          onDragEnter={(event) => {
            if (props.compact) return
            event.preventDefault()
            setSkillDragActive(true)
          }}
          onDragOver={(event) => {
            if (props.compact) return
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
            if (props.compact) return
            void handleDroppedSkillDrop(event)
          }}
        >
          <Show when={props.compact}>
            <div class="tool-panel-toolbar" role="toolbar" aria-label={t("skill.title")}>
              <PanelActionButton compact icon="refresh" label={t("common.reload")} onClick={handleReloadSkills} />
              <Show when={canOpenLocalPath()}>
                <PanelActionButton
                  compact
                  icon="folder-open"
                  label={t("skill.open_dir")}
                  onClick={handleOpenSkillDir}
                />
              </Show>
              <PanelActionButton
                compact
                icon="plus"
                  label={t("skill.add")}
                  onClick={() => void setShowAddSkill(!showAddSkill())}
                />
            </div>
          </Show>
          <div class="extension-settings-body">
            <div class="agent-skill-matrix" data-unmounted={mounts()?.unmounted_count ? "true" : "false"}>
              <div class="agent-skill-matrix__summary">
                <strong>{t("skill.mount.matrix")}</strong>
                <Show when={mounts()?.unmounted_count}>
                  <SettingsPill tone="warn">
                    {t("skill.mount.unmounted_count", { count: mounts()?.unmounted_count ?? 0 })}
                  </SettingsPill>
                </Show>
              </div>
              <Show when={poolSkills().length > 0} fallback={<div class="empty-hint">{t("skill.none_custom")}</div>}>
                <div
                  class="agent-skill-matrix-grid"
                  style={{ "grid-template-columns": matrixGridTemplate() }}
                  aria-label={t("skill.mount.matrix")}
                >
                  <div class="agent-skill-grid-corner" role="columnheader">
                    {t("skill.mount.pool")}
                  </div>
                  <For each={agentRows()}>
                    {(agent) => (
                      <div
                        class="agent-skill-grid-agent"
                        data-skill-tool={agent.skill_tool_available ? "true" : "false"}
                        role="columnheader"
                        title={agent.name}
                        onDragOver={(event) => {
                          if (!agent.skill_tool_available) return
                          event.preventDefault()
                          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
                        }}
                        onDrop={(event) => {
                          if (!agent.skill_tool_available) return
                          void handleAgentDrop(agent.name, event)
                        }}
                      >
                        <span>{agentColumnLabel(agent.name)}</span>
                        <Show when={!agent.skill_tool_available}>
                          <span class="agent-skill-grid-cell__reason">{t("skill.mount.no_skill_tool")}</span>
                        </Show>
                      </div>
                    )}
                  </For>
                  <For each={poolSkills()}>
                    {(item) => {
                      const mountedAgents = () => mountedAgentsFor(item)
                      const sourceRoot = () => skillSourceRoot(item)
                      const skillTitle = () =>
                        [
                          item.name,
                          item.description,
                          sourceRoot(),
                          mountedAgents().join(", ") || t("skill.mount.unmounted"),
                          item.location,
                        ]
                          .filter(Boolean)
                          .join("\n")
                      return (
                        <>
                          <button
                            type="button"
                            class="agent-skill-grid-skill"
                            data-unmounted={item.unmounted ? "true" : "false"}
                            title={skillTitle()}
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer?.setData("application/x-opencorvus-skill", item.name)
                              if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
                            }}
                          >
                            <span class="agent-skill-grid-skill__name">{item.name}</span>
                            <span class="agent-skill-grid-skill__meta">
                              <Show when={sourceRoot()}>
                                <span>{sourceRoot()}</span>
                              </Show>
                              <span>{mountedAgentLabel(mountedAgents().length)}</span>
                              <Show when={skillDuplicateLocations(item).length > 1}>
                                <span title={skillDuplicateTitle(item)}>{t("skill.duplicate")}</span>
                              </Show>
                            </span>
                          </button>
                          <For each={agentRows()}>
                            {(agent) => {
                              const mounted = () => mountedSkillFor(agent, item)
                              const cellState = () => {
                                if (!agent.skill_tool_available) return "unavailable"
                                const current = mounted()
                                if (!current) return "available"
                                return current.enabled ? "mounted" : "conflict"
                              }
                              const cellLabel = () => {
                                const current = mounted()
                                if (!agent.skill_tool_available) {
                                  return `${agent.name}: ${t("skill.mount.no_skill_tool")}`
                                }
                                if (!current) return `${t("skill.mount.add")}: ${item.name} -> ${agent.name}`
                                if (current.enabled) return `${t("skill.mount.remove")}: ${item.name} -> ${agent.name}`
                                return `${item.name} -> ${agent.name}: ${current.reason || ""}`
                              }
                              return (
                                <button
                                  type="button"
                                  class="agent-skill-grid-cell"
                                  data-state={cellState()}
                                  disabled={!agent.skill_tool_available || loading()}
                                  title={cellLabel()}
                                  aria-label={cellLabel()}
                                  onClick={() => {
                                    if (!agent.skill_tool_available) return
                                    const current = mounted()
                                    if (current) {
                                      void handleUnmount(agent.name, item.name)
                                      return
                                    }
                                    void handleMount(agent.name, item.name)
                                  }}
                                  onDragOver={(event) => {
                                    if (!agent.skill_tool_available) return
                                    event.preventDefault()
                                    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
                                  }}
                                  onDrop={(event) => {
                                    if (!agent.skill_tool_available) return
                                    void handleAgentDrop(agent.name, event)
                                  }}
                                >
                                  <Show when={cellState() === "mounted"}>
                                    <Icon name="check" />
                                  </Show>
                                  <Show when={cellState() === "conflict"}>
                                    <Icon name="info-circle" />
                                    <span class="agent-skill-grid-cell__reason">{mounted()?.reason || ""}</span>
                                  </Show>
                                  <Show when={cellState() === "available"}>
                                    <Icon name="plus" />
                                  </Show>
                                  <Show when={cellState() === "unavailable"}>
                                    <Icon name="cancel" />
                                  </Show>
                                </button>
                              )
                            }}
                          </For>
                        </>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </div>

            <Show when={!props.compact}>
              <div class="skill-drop-zone" data-active={skillDragActive() ? "true" : "false"}>
                <span class="skill-drop-zone__icon" aria-hidden="true">
                  <Icon name="upload" />
                </span>
                <span class="skill-drop-zone__copy">
                  <strong>{t("skill.drop_title")}</strong>
                  <span>{t("skill.drop_hint")}</span>
                </span>
              </div>
            </Show>

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
                      <Button
                        type="button"
                        variant="ghost"
                        size={props.compact ? "icon" : "sm"}
                        tone="neutral"
                        title={t("skill.browse_folder")}
                        aria-label={t("skill.browse_folder")}
                        data-ui={props.compact ? "skill-form-icon-action" : undefined}
                        onClick={handleBrowseFolder}
                      >
                        <Show when={props.compact} fallback={t("skill.browse_folder")}>
                          <Icon name="folder-open" />
                        </Show>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size={props.compact ? "icon" : "sm"}
                    tone="neutral"
                    title={t("common.cancel")}
                    aria-label={t("common.cancel")}
                    data-ui={props.compact ? "skill-form-icon-action" : undefined}
                    onClick={() => setShowAddSkill(false)}
                  >
                    <Show when={props.compact} fallback={t("common.cancel")}>
                      <Icon name="cancel" />
                    </Show>
                  </Button>
                  <Button
                    type="button"
                    variant="solid"
                    size={props.compact ? "icon" : "sm"}
                    tone="accent"
                    disabled={!skillForm.value.trim()}
                    title={t("skill.install")}
                    aria-label={t("skill.install")}
                    data-ui={props.compact ? "skill-form-icon-action" : undefined}
                    onClick={handleAddSkill}
                  >
                    <Show when={props.compact} fallback={t("skill.install")}>
                      <Icon name="plus" />
                    </Show>
                  </Button>
                </div>
              </div>
            </Show>
            <Show when={!props.compact}>
              <div class="extension-list" id="skillList">
                <Show when={poolSkills().length > 0} fallback={<div class="empty-hint">{t("skill.none_custom")}</div>}>
                  <For each={poolSkills()}>
                    {(item) => (
                      <SettingsRow
                        class="extension-settings-row"
                        title={
                          <>
                            <span>{item.name}</span>
                            <Show when={skillDuplicateLocations(item).length > 1}>
                              <SettingsPill tone="warn" title={skillDuplicateTitle(item)}>
                                {t("skill.duplicate")}
                              </SettingsPill>
                            </Show>
                          </>
                        }
                        desc={item.description || ""}
                        meta={<small>{item.location || ""}</small>}
                        interactive
                        actions={
                          <div class="extension-settings-actions">
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
                            <SettingsPill tone="ok">
                              {item.builtin ? t("skill.builtin") : t("common.loaded")}
                            </SettingsPill>
                          </div>
                        }
                      />
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
        </SettingsGroup>
      </Show>

      {/* ── MCP Servers ── */}
      <Show when={props.mode === "mcp"}>
        <SettingsGroup
          class="extension-settings-group"
          data-compact={props.compact ? "true" : "false"}
          title={props.compact ? undefined : t("mcp.title")}
          actions={
            props.compact ? undefined : (
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
            )
          }
        >
          <Show when={props.compact}>
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
          <div class="extension-settings-body">
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
                    const status = item?.status
                    const label = mcpConnectionStatusOrDisabledLabel(status)
                    const detail = item?.error || ""
                    return (
                      <SettingsRow
                        class="extension-settings-row"
                        title={name}
                        desc={detail ? detail : label}
                        interactive
                        actions={<SettingsPill tone={mcpConnectionStatusOrDisabledTone(status)}>{label}</SettingsPill>}
                      />
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        </SettingsGroup>
      </Show>

      {/* ── Skill Market ── */}
      <Show when={props.mode === "skill-market"}>
        <SettingsGroup class="extension-settings-group" title={t("skill.market.title")}>
          <div class="extension-settings-body">
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
                          <SettingsPill tone={policyTone(item.recommended_policy || "")}>
                            {policyLabel(item.recommended_policy || "")}
                          </SettingsPill>
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
        </SettingsGroup>
      </Show>
    </>
  )
}

export function SkillsPanel(props: { active?: boolean; compact?: boolean; directory?: DirectoryProp } = {}) {
  return (
    <ExtensionSettingsPanel
      mode="skill"
      active={props.active ?? true}
      compact={props.compact}
      directory={props.directory}
    />
  )
}

export function McpPanel(props: { active?: boolean; compact?: boolean; directory?: DirectoryProp } = {}) {
  return (
    <ExtensionSettingsPanel
      mode="mcp"
      active={props.active ?? true}
      compact={props.compact}
      directory={props.directory}
    />
  )
}

export function SkillMarketPanel(props: { active?: boolean; directory?: DirectoryProp }) {
  return <ExtensionSettingsPanel mode="skill-market" active={props.active} directory={props.directory} />
}

export default SkillMarketPanel
