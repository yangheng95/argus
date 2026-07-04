import { createSignal } from "solid-js"
import { appStore } from "../store/app"
import { apiJson } from "./api"
import { patchSessionConfig, updateConfig, type SessionConfigResponse } from "./config"

export interface ExpertSquadCapabilityProjectionEntry {
  built_in_tool_ids: string[]
  default_skill_refs: string[]
  package_skill_refs: string[]
  default_tool_refs: string[]
  package_tool_refs: string[]
  default_mcp_server_refs: string[]
  package_mcp_server_refs: string[]
  default_mcp_tool_refs: string[]
  package_mcp_tool_refs: string[]
  default_mcp_prompt_refs: string[]
  package_mcp_prompt_refs: string[]
  default_mcp_resource_refs: string[]
  package_mcp_resource_refs: string[]
}

export interface ExpertSquadCapabilityProjection {
  scheduler: ExpertSquadCapabilityProjectionEntry
  agents: Record<string, ExpertSquadCapabilityProjectionEntry>
}

export interface ExpertSquadCatalogSource {
  kind: "built_in" | "project_package"
  root?: string
  manifest_path?: string
  readme_path?: string
}

export interface ExpertSquadCatalogReadme {
  path: "README.md"
  append_target: "orchestrator"
  content: string
}

export interface ExpertSquadCatalogSelector {
  ref: string
  id: string
  label: string
  description?: string
  summary: string
  selection_guidance: string
  instructions_path: "selector.md"
  instructions: string
}

export interface ExpertSquadOption {
  id: string
  label: string
  description?: string
  version?: string
  built_in: boolean
  editable: boolean
  agents: Record<string, string>
  capability_profile_id: string
  projection_hash: string
  projected_agents: string[]
  capability_projection: ExpertSquadCapabilityProjection
  source: ExpertSquadCatalogSource
  readme: ExpertSquadCatalogReadme
  selector?: ExpertSquadCatalogSelector
  dynamic_attributes: Record<string, unknown>
}

export interface ExpertSquadTarget {
  id: string
  label: string
  description?: string
  editable: boolean
  built_in_only: boolean
}

export interface ExpertSquadActiveSkillProjection {
  active_squad_id: string
  capability_profile_id: string
  built_in: boolean
  projection_hash: string
  projected_tool_ids: string[]
  projected_agent_ids: string[]
  selector_skill_names: string[]
  production_skill_names: string[]
  projected_skill_names: string[]
  skills: Array<{
    name: string
    description: string
    builtin: boolean
    location: string
    required_tools: string[]
    mounted_agents: string[]
  }>
}

export interface ExpertSquadCatalog {
  active: {
    effective: string
    project: string
    session_override: string | null
  }
  default: string
  scope: ExpertSquadCatalogScope
  targets: ExpertSquadTarget[]
  squads: ExpertSquadOption[]
  active_skill_projection: ExpertSquadActiveSkillProjection
}

export type ExpertSquadCatalogScope =
  | { kind: "project"; directory: string }
  | { kind: "session"; sessionID: string; directory: string }

export interface ExpertSquadImportFolderInput {
  directory: string
  sourceDirectory: string
  replace: boolean
}

export interface ExpertSquadImportFileInput {
  directory: string
  archiveBase64: string
  filename?: string
  replace: boolean
}

export interface ExpertSquadImportResult {
  id: string
  targetRoot: string
  replaced: boolean
}

export interface ExpertSquadExportResult {
  id: string
  filename: string
  archiveBase64: string
  fileCount: number
}

const [expertSquadCatalogRefreshTokenValue, setExpertSquadCatalogRefreshTokenValue] = createSignal(0)
let pendingExpertSquadCatalogLoad: { key: string; promise: Promise<ExpertSquadCatalog> } | null = null

export function expertSquadCatalogRefreshToken(): number {
  return expertSquadCatalogRefreshTokenValue()
}

export function markExpertSquadCatalogStale(): void {
  setExpertSquadCatalogRefreshTokenValue((value) => value + 1)
}

function directoryScopedPath(path: string, directory: string, label: string): string {
  const trimmed = directory.trim()
  if (!trimmed) throw new Error(`${label}: directory is required`)
  const params = new URLSearchParams({ directory: trimmed })
  return `${path}?${params.toString()}`
}

export function expertSquadCatalogPath(scope: ExpertSquadCatalogScope): string {
  const directory = scope.directory.trim()
  if (!directory) throw new Error("loadExpertSquadCatalog: directory is required")
  const sessionID = scope.kind === "session" ? scope.sessionID.trim() : ""
  if (scope.kind === "session" && !sessionID) throw new Error("loadExpertSquadCatalog: sessionID is required")
  const params = new URLSearchParams({ directory })
  if (sessionID) params.set("sessionID", sessionID)
  return `expert-squad/catalog?${params.toString()}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function loadExpertSquadCatalog(scope: ExpertSquadCatalogScope): Promise<ExpertSquadCatalog> {
  if (!appStore.connected) {
    throw new Error("Cannot load expert squads while disconnected")
  }
  const path = expertSquadCatalogPath(scope)
  const key = path
  if (pendingExpertSquadCatalogLoad?.key === key) return await pendingExpertSquadCatalogLoad.promise
  const promise = apiJson(path) as Promise<ExpertSquadCatalog>
  pendingExpertSquadCatalogLoad = { key, promise }
  try {
    return await promise
  } catch (error) {
    throw new Error(`GET /${path} failed: ${errorMessage(error)}`)
  } finally {
    if (pendingExpertSquadCatalogLoad?.promise === promise) pendingExpertSquadCatalogLoad = null
  }
}

export async function setProjectExpertSquadActive(expertSquadID: string, directory: string): Promise<any> {
  const saved = await updateConfig((current) => {
    const promptProfile =
      current.prompt_profile && typeof current.prompt_profile === "object" && !Array.isArray(current.prompt_profile)
        ? { ...current.prompt_profile }
        : {}
    current.prompt_profile = {
      ...promptProfile,
      active: expertSquadID,
    }
  }, { directory })
  markExpertSquadCatalogStale()
  return saved
}

export async function setSessionExpertSquadActive(
  sessionID: string,
  expertSquadID: string,
  directory: string,
): Promise<SessionConfigResponse> {
  const saved = await patchSessionConfig({ sessionID, directory, diff: { prompt_profile: { active: expertSquadID } } })
  markExpertSquadCatalogStale()
  return saved
}

export async function importExpertSquadFolder(input: ExpertSquadImportFolderInput): Promise<ExpertSquadImportResult> {
  const sourceDirectory = input.sourceDirectory.trim()
  if (!sourceDirectory) throw new Error("importExpertSquadFolder: sourceDirectory is required")
  const result = (await apiJson(
    directoryScopedPath("expert-squad/import-folder", input.directory, "importExpertSquadFolder"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceDirectory, replace: input.replace }),
    },
  )) as ExpertSquadImportResult
  markExpertSquadCatalogStale()
  return result
}

export async function importExpertSquadArchive(input: ExpertSquadImportFileInput): Promise<ExpertSquadImportResult> {
  const archiveBase64 = input.archiveBase64.trim()
  if (!archiveBase64) throw new Error("importExpertSquadArchive: archiveBase64 is required")
  const result = (await apiJson(directoryScopedPath("expert-squad/import-file", input.directory, "importExpertSquadArchive"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      archiveBase64,
      filename: input.filename,
      replace: input.replace,
    }),
  })) as ExpertSquadImportResult
  markExpertSquadCatalogStale()
  return result
}

export async function exportExpertSquadArchive(directory: string, expertSquadID: string): Promise<ExpertSquadExportResult> {
  const id = expertSquadID.trim()
  if (!id) throw new Error("exportExpertSquadArchive: expertSquadID is required")
  return (await apiJson(directoryScopedPath("expert-squad/export", directory, "exportExpertSquadArchive"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })) as ExpertSquadExportResult
}
