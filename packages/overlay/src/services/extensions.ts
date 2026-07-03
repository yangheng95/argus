// ── Extensions Service ──
// TypeScript port of skill/extension and MCP functions
// loadExtensions, loadSkillMarket, installSkill,
// removeSkillSource, deleteSkill, deleteAllSkills.
// Retired DOM-rendering functions are intentionally not ported here; Solid
// components own rendering, while this service only updates store data.

import { appStore, setSkills, setMcp, setSkillMarket, setSkillMounts } from "../store/app"
import { apiJson } from "./api"

// ── Types ──

export interface SkillDescriptor {
  name: string
  description?: string
  location?: string
  source?: string
  source_type?: string
  builtin?: boolean
  [key: string]: any
}

export interface AgentSkillMountMatrix {
  scope: "project" | "session"
  active_profile: string
  capability_profile_id: string
  projection_hash: string
  projected_tool_ids: string[]
  projected_agents: string[]
  selector_skill_names: string[]
  production_skill_names: string[]
  projected_skill_names: string[]
  skills: Array<SkillDescriptor & { mounted_agents?: string[]; unmounted?: boolean; warning?: string }>
  agents: Array<{
    name: string
    description?: string
    mode: "subagent" | "primary" | "all"
    native?: boolean
    hidden?: boolean
    skill_mountable: boolean
    skill_tool_available: boolean
  }>
  matrix: Array<{
    agent: string
    mounted: Array<{
      name: string
      description?: string
      location?: string
      enabled: boolean
      reason?: string
    }>
  }>
  unmounted_count: number
  project_mounts?: unknown
}

interface SkillMountRequestOptions {
  sessionID?: string
  refresh?: boolean
  directory?: string
  isCurrentDirectory?: (directory: string) => boolean
}

export interface DirectoryOwnedRequestOptions {
  directory?: string
  isCurrentDirectory?: (directory: string) => boolean
}

// ── Helpers ──

function stabilizeSkillOrder(matrix: AgentSkillMountMatrix): AgentSkillMountMatrix {
  const previousSkills =
    appStore.skillMounts && Array.isArray(appStore.skillMounts.skills) ? appStore.skillMounts.skills : appStore.skills
  if (!Array.isArray(previousSkills) || previousSkills.length === 0 || !Array.isArray(matrix.skills)) return matrix
  const order = new Map<string, number>()
  previousSkills.forEach((skill: SkillDescriptor, index: number) => {
    if (typeof skill?.name === "string" && !order.has(skill.name)) order.set(skill.name, index)
  })
  const sortedSkills = matrix.skills
    .map((skill, index) => ({ skill, index }))
    .sort((left, right) => {
      const leftOrder = order.get(left.skill.name)
      const rightOrder = order.get(right.skill.name)
      if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
      if (leftOrder !== undefined) return -1
      if (rightOrder !== undefined) return 1
      return left.index - right.index
    })
    .map((entry) => entry.skill)
  return { ...matrix, skills: sortedSkills }
}

function commitSkillMountMatrix(matrix: AgentSkillMountMatrix): AgentSkillMountMatrix {
  const stable = stabilizeSkillOrder(matrix)
  setSkillMounts(stable)
  if (Array.isArray(stable.skills)) setSkills(stable.skills)
  return stable
}

function skillMountPath(base: string, options: Pick<SkillMountRequestOptions, "directory" | "refresh" | "sessionID">): string {
  const query = new URLSearchParams()
  if (options.sessionID) query.set("sessionID", options.sessionID)
  if (options.refresh) query.set("refresh", "true")
  if (options.directory) query.set("directory", options.directory)
  const suffix = query.toString()
  return suffix ? `${base}?${suffix}` : base
}

function directoryOwnedPath(base: string, options: Pick<DirectoryOwnedRequestOptions, "directory">): string {
  const directory = String(options.directory || "").trim()
  if (!directory) return base
  const query = new URLSearchParams({ directory })
  return `${base}?${query.toString()}`
}

function ownsDirectoryRequest(options: DirectoryOwnedRequestOptions): boolean {
  const directory = String(options.directory || "").trim()
  return !directory || !options.isCurrentDirectory || options.isCurrentDirectory(directory)
}

function commitOwnedSkillMountMatrix(
  matrix: AgentSkillMountMatrix,
  options: Pick<SkillMountRequestOptions, "directory" | "isCurrentDirectory">,
): AgentSkillMountMatrix {
  const directory = String(options.directory || "").trim()
  if (directory && options.isCurrentDirectory && !options.isCurrentDirectory(directory)) return matrix
  return commitSkillMountMatrix(matrix)
}

function skillMountOptions(
  sessionIDOrOptions?: string | SkillMountRequestOptions,
): SkillMountRequestOptions {
  if (typeof sessionIDOrOptions === "string") return { sessionID: sessionIDOrOptions }
  return sessionIDOrOptions ?? {}
}

/**
 * Returns the removal kind for a skill, used when calling removeSkillSource.
 * Mirrors skillRemoveKind.
 */
export function skillRemoveKind(item: SkillDescriptor): string {
  if (item?.source_type === "managed_git") return "git"
  if (item?.source_type === "config_url") return "url"
  if (item?.source_type === "config_path") return "path"
  return ""
}

/**
 * Returns true when a skill can be removed (non-builtin, has a source and a
 * known removal kind).
 * Mirrors skillRemovable.
 */
export function skillRemovable(item: SkillDescriptor): boolean {
  return !item?.builtin && !!item?.source && !!skillRemoveKind(item)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ── Loaders ──

/**
 * Fetches both installed skills and MCP config from the server and updates
 * the app store.
 * NOTE: renderExtensions() DOM call is omitted — callers should
 * react to store updates via Solid reactivity.
 */
export async function loadExtensions(
  options: DirectoryOwnedRequestOptions = {},
): Promise<{ skills: SkillDescriptor[]; mcp: Record<string, any> }> {
  const [matrix, mcp] = await Promise.all([loadSkillMountMatrix(options), loadMcpStatus(options)])
  return { skills: matrix.skills, mcp }
}

export async function loadInstalledSkills(options: DirectoryOwnedRequestOptions = {}): Promise<SkillDescriptor[]> {
  const skills = await apiJson(directoryOwnedPath("skill/installed", options))
  if (!Array.isArray(skills)) {
    throw new Error("skill/installed returned a non-array payload")
  }
  if (ownsDirectoryRequest(options)) setSkills(skills)
  return skills
}

export async function loadSkillMountMatrix(
  options: SkillMountRequestOptions = {},
): Promise<AgentSkillMountMatrix> {
  const matrix = await apiJson(skillMountPath("skill/mounts", options))
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    throw new Error("skill/mounts returned a non-object payload")
  }
  return commitOwnedSkillMountMatrix(matrix as AgentSkillMountMatrix, options)
}

export async function mountSkill(
  agent: string,
  skill: string,
  sessionIDOrOptions?: string | SkillMountRequestOptions,
): Promise<AgentSkillMountMatrix> {
  const options = skillMountOptions(sessionIDOrOptions)
  const matrix = await apiJson(skillMountPath("skill/mount", options), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, skill, sessionID: options.sessionID || undefined }),
  })
  return commitOwnedSkillMountMatrix(matrix as AgentSkillMountMatrix, options)
}

export async function unmountSkill(
  agent: string,
  skill: string,
  sessionIDOrOptions?: string | SkillMountRequestOptions,
): Promise<AgentSkillMountMatrix> {
  const options = skillMountOptions(sessionIDOrOptions)
  const matrix = await apiJson(skillMountPath("skill/unmount", options), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, skill, sessionID: options.sessionID || undefined }),
  })
  return commitOwnedSkillMountMatrix(matrix as AgentSkillMountMatrix, options)
}

export async function importAndMountSkill(
  agent: string,
  payload: Record<string, unknown>,
  sessionIDOrOptions?: string | SkillMountRequestOptions,
): Promise<AgentSkillMountMatrix> {
  const options = skillMountOptions(sessionIDOrOptions)
  const matrix = await apiJson(skillMountPath("skill/import-and-mount", options), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, sessionID: options.sessionID || undefined, import: payload }),
  })
  return commitOwnedSkillMountMatrix(matrix as AgentSkillMountMatrix, options)
}

export async function loadMcpStatus(options: DirectoryOwnedRequestOptions = {}): Promise<Record<string, any>> {
  const mcp = await apiJson(directoryOwnedPath("mcp", options))
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) {
    throw new Error("mcp returned a non-object payload")
  }
  if (ownsDirectoryRequest(options)) setMcp(mcp)
  return mcp
}

/**
 * Fetches the skill marketplace catalogue from the server and updates the app
 * store.
 * NOTE: This only refreshes store data; callers own dialog visibility.
 */
export async function loadSkillMarket(options: DirectoryOwnedRequestOptions = {}): Promise<any[]> {
  const items = await apiJson(directoryOwnedPath("skill/market", options))
  if (!Array.isArray(items)) {
    throw new Error("skill/market returned a non-array payload")
  }
  if (ownsDirectoryRequest(options)) setSkillMarket(items)
  return items
}

// ── Mutations ──

/**
 * Removes a skill source via the API.
 * Mirrors removeSkillSource.
 */
export async function removeSkillSource(
  source: string,
  kind: string,
  options: DirectoryOwnedRequestOptions = {},
): Promise<void> {
  await apiJson(directoryOwnedPath("skill/remove", options), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, kind }),
  })
}

/**
 * Installs a skill via the API.
 * Mirrors installSkill.
 */
export async function installSkill(
  kind: string,
  value: string,
  policy?: string,
  options: DirectoryOwnedRequestOptions = {},
): Promise<void> {
  await apiJson(directoryOwnedPath("skill/install", options), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, value, policy: policy || undefined }),
  })
}

export async function importSkillFile(
  filename: string,
  content: string,
  policy?: string,
  options: DirectoryOwnedRequestOptions = {},
): Promise<{ name: string; source: string; kind: "path"; names?: string[]; sources?: string[] }> {
  return await apiJson(directoryOwnedPath("skill/import-file", options), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content, policy: policy || undefined }),
  })
}

export interface SkillImportPackageFile {
  path: string
  contentBase64: string
}

export async function importSkillPackage(
  sourceName: string,
  files: SkillImportPackageFile[],
  policy?: string,
  options: DirectoryOwnedRequestOptions = {},
): Promise<{ name: string; source: string; kind: "path"; names?: string[]; sources?: string[] }> {
  return await apiJson(directoryOwnedPath("skill/import-file", options), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceName, files, policy: policy || undefined }),
  })
}

export async function importSkillArchive(
  filename: string,
  archiveBase64: string,
  policy?: string,
  options: DirectoryOwnedRequestOptions = {},
): Promise<{ name: string; source: string; kind: "path"; names?: string[]; sources?: string[] }> {
  return await apiJson(directoryOwnedPath("skill/import-file", options), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, archiveBase64, policy: policy || undefined }),
  })
}

/**
 * Removes a single skill after optional UI confirmation.
 * NOTE: The native confirm dialog call
 * responsible for confirming before calling this function.
 * Mirrors the API call portion of deleteSkill.
 */
export async function deleteSkill(
  source: string,
  kind: string,
  options: DirectoryOwnedRequestOptions = {},
): Promise<void> {
  if (!source || !kind) return
  await removeSkillSource(source, kind, options)
}

/**
 * Removes all removable (non-builtin) skills sequentially.
 * NOTE: The native confirm dialog call
 * responsible for confirming before calling this function.
 * Mirrors the API call portion of deleteAllSkills.
 */
export async function deleteAllSkills(
  options: DirectoryOwnedRequestOptions & { skills?: readonly SkillDescriptor[] } = {},
): Promise<void> {
  const skills: readonly SkillDescriptor[] = options.skills ?? appStore.skills
  const custom = skills.filter((item) => !item.builtin)
  const list = custom.filter(skillRemovable)
  if (list.length === 0) return
  let removalError: unknown
  for (const item of list) {
    try {
      await removeSkillSource(item.source!, skillRemoveKind(item), options)
    } catch (error) {
      removalError = error
      break
    }
  }

  try {
    await loadInstalledSkills(options)
  } catch (refreshError) {
    if (removalError) {
      throw new Error(
        `Failed to delete all skills: ${errorMessage(removalError)}; failed to refresh installed skills: ${errorMessage(
          refreshError,
        )}`,
      )
    }
    throw refreshError
  }

  if (removalError) throw removalError
}
