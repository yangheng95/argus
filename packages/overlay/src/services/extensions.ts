// ── Extensions Service ──
// TypeScript port of skill/extension and MCP functions
// loadExtensions, loadSkillMarket, installSkill,
// removeSkillSource, deleteSkill, deleteAllSkills.
// DOM-rendering functions (renderExtensions, renderSkillMarket,
// renderConfigToggleMeta) are intentionally NOT ported here — they are dead
// code in the Solid.js world and are superseded by declarative components.

import { appStore, setSkills, setMcp, setSkillMarket } from "../store/app"
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

// ── Helpers ──

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

// ── Loaders ──

/**
 * Fetches both installed skills and MCP config from the server and updates
 * the app store.
 * NOTE: renderExtensions() DOM call is omitted — callers should
 * react to store updates via Solid reactivity.
 */
export async function loadExtensions(): Promise<void> {
  const [skills, mcp] = await Promise.all([apiJson("skill/installed"), apiJson("mcp")])
  if (!Array.isArray(skills)) {
    throw new Error("skill/installed returned a non-array payload")
  }
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) {
    throw new Error("mcp returned a non-object payload")
  }
  setSkills(skills)
  setMcp(mcp)
}

/**
 * Fetches the skill marketplace catalogue from the server and updates the app
 * store.
 * NOTE: The manipulation (showModal, renderSkillMarket) is omitted
 * — callers should open the marketplace dialog and react to store updates.
 */
export async function loadSkillMarket(): Promise<void> {
  const items = await apiJson("skill/market")
  if (!Array.isArray(items)) {
    throw new Error("skill/market returned a non-array payload")
  }
  setSkillMarket(items)
}

// ── Mutations ──

/**
 * Removes a skill source via the API.
 * Mirrors removeSkillSource.
 */
export async function removeSkillSource(source: string, kind: string): Promise<void> {
  await apiJson("skill/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, kind }),
  })
}

/**
 * Installs a skill via the API.
 * Mirrors installSkill.
 */
export async function installSkill(kind: string, value: string, policy?: string): Promise<void> {
  await apiJson("skill/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, value, policy: policy || undefined }),
  })
}

export async function importSkillFile(
  filename: string,
  content: string,
  policy?: string,
): Promise<{ name: string; source: string; kind: "path"; names?: string[]; sources?: string[] }> {
  return await apiJson("skill/import-file", {
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
): Promise<{ name: string; source: string; kind: "path"; names?: string[]; sources?: string[] }> {
  return await apiJson("skill/import-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceName, files, policy: policy || undefined }),
  })
}

export async function importSkillArchive(
  filename: string,
  archiveBase64: string,
  policy?: string,
): Promise<{ name: string; source: string; kind: "path"; names?: string[]; sources?: string[] }> {
  return await apiJson("skill/import-file", {
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
export async function deleteSkill(source: string, kind: string): Promise<void> {
  if (!source || !kind) return
  await removeSkillSource(source, kind)
}

/**
 * Removes all removable (non-builtin) skills sequentially.
 * NOTE: The native confirm dialog call
 * responsible for confirming before calling this function.
 * Mirrors the API call portion of deleteAllSkills.
 */
export async function deleteAllSkills(): Promise<void> {
  const skills: SkillDescriptor[] = appStore.skills
  const custom = skills.filter((item) => !item.builtin)
  const list = custom.filter(skillRemovable)
  if (list.length === 0) return
  await list.reduce(
    (promise, item) => promise.then(() => removeSkillSource(item.source!, skillRemoveKind(item))),
    Promise.resolve(),
  )
}
