import { rm } from "fs/promises"
import matter from "gray-matter"
import path from "path"
import z from "zod"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { PermissionNext } from "@/permission/next"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import { Process } from "@/util/process"
import { Discovery } from "./discovery"
import { Skill } from "./skill"
import { which } from "@/util/which"
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"

const MANIFEST = ".opencorvus-skill-source.json"
const ExpirationTimestamp = z
  .preprocess(
    (value) => {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? value : value.toISOString()
      if (typeof value === "number" && Number.isFinite(value)) {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? value : date.toISOString()
      }
      if (typeof value === "string") return value.trim()
      return value
    },
    z.string().refine((value) => !Number.isNaN(Date.parse(value)), "expires_at must be a valid timestamp"),
  )
  .optional()
const SkillInfo = z.object({
  name: z.string(),
  description: z.string(),
  platforms: z
    .array(z.enum(["win32", "darwin", "linux"]))
    .optional()
    .default([]),
  builtin: z.boolean().optional().default(false),
  location: z.string(),
  content: z.string(),
  auto_detect: z
    .object({
      files: z.array(z.string()).optional(),
      deps: z.array(z.string()).optional(),
      task_signals: z
        .object({
          has_attachment_image: z.boolean().optional(),
          request_contains_url: z.boolean().optional(),
          request_contains_figma_url: z.boolean().optional(),
          package_has_script: z.array(z.string()).optional(),
          request_text_any: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  priority: z.number().optional().default(0),
  required_tools: z.array(z.string()).optional().default([]),
  agents: z.array(z.string()).optional().default([]),
  expires_at: ExpirationTimestamp,
  duplicate_locations: z.array(z.string()).optional().default([]),
})

export namespace SkillManager {
  export const Policy = PermissionNext.Action
  export const Trust = z.enum(["builtin", "official", "curated", "community", "local", "external", "unknown"])
  export const Risk = z.object({
    level: z.enum(["low", "medium", "high"]),
    has_scripts: z.boolean(),
    has_agents: z.boolean(),
    has_references: z.boolean(),
    has_templates: z.boolean(),
  })

  // Mirror Skill.Info locally to avoid a circular route-loading dependency on the Skill namespace.
  export const Installed = SkillInfo.extend({
    dir: z.string().optional(),
    source_type: z.enum(["builtin", "managed_git", "config_path", "config_url", "external", "unknown"]),
    source: z.string().optional(),
    trust: Trust,
    risk: Risk,
    recommended_policy: Policy,
    policy: Policy,
    managed: z.boolean(),
    writable: z.boolean(),
  })

  export const MarketEntry = z.object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    description: z.string(),
    homepage: z.string().url(),
    source: z.string().optional(),
    install_kind: z.enum(["git", "url", "manual"]),
    trust: z.enum(["official", "curated", "community"]),
    recommended_policy: Policy,
    notes: z.string().optional(),
  })

  export const Directories = z.object({
    global_config: z.string(),
    managed_skills: z.string(),
    remote_cache: z.string(),
  })

  export const InstallInput = z.object({
    kind: z.enum(["path", "url", "git"]),
    value: z.string().min(1),
    policy: Policy.optional(),
  })

  export const ImportBundleFile = z
    .object({
      path: z.string().min(1),
      content: z.string().optional(),
      contentBase64: z.string().optional(),
    })
    .refine((item) => item.content !== undefined || item.contentBase64 !== undefined, {
      message: "Import file requires content or contentBase64",
    })

  export const ImportFileInput = z
    .object({
      filename: z.string().min(1).optional(),
      content: z.string().optional(),
      sourceName: z.string().min(1).optional(),
      files: ImportBundleFile.array().optional(),
      archiveBase64: z.string().optional(),
      policy: Policy.optional(),
    })
    .refine((input) => input.content !== undefined || input.files?.length || input.archiveBase64, {
      message: "Import requires a SKILL.md file, a directory file list, or a zip archive",
    })

  export const RemoveInput = z.object({
    source: z.string().min(1),
    kind: z.enum(["path", "url", "git"]).optional(),
  })

  export const PolicyInput = z.object({
    name: z.string().min(1),
    action: Policy,
  })

  export function managedRoot() {
    return path.join(Global.Path.config, "skills-market")
  }

  export function directories() {
    return Directories.parse({
      global_config: Global.Path.config,
      managed_skills: managedRoot(),
      remote_cache: Discovery.dir(),
    })
  }

  /** 内置默认市场条目 */
  const BUILTIN_MARKET: z.input<typeof MarketEntry>[] = [
    {
      id: "openai-skills",
      name: "OpenAI Skills",
      provider: "OpenAI",
      description: "Official public repository for Agent Skills and related skill plugins.",
      homepage: "https://github.com/openai/skills",
      source: "https://github.com/openai/skills.git",
      install_kind: "git",
      trust: "official",
      recommended_policy: "ask",
      notes: "Installable as a Git source; review individual skills before allowing always.",
    },
    {
      id: "anthropic-skills",
      name: "Anthropic Skills",
      provider: "Anthropic",
      description: "Official skill repository curated for Claude-style agent workflows.",
      homepage: "https://github.com/anthropics/skills",
      source: "https://github.com/anthropics/skills.git",
      install_kind: "git",
      trust: "official",
      recommended_policy: "ask",
      notes: "Official source, but still prefer ask-by-default for script-bearing skills.",
    },
    {
      id: "skills-sh",
      name: "skills.sh",
      provider: "skills.sh",
      description: "Large searchable skill directory with repo-based install flows and popularity signals.",
      homepage: "https://skills.sh",
      install_kind: "manual",
      trust: "curated",
      recommended_policy: "ask",
      notes: "Best used to discover repo URLs, then install via Git source in OpenCorvus.",
    },
    {
      id: "skillstore",
      name: "Skillstore",
      provider: "Skillstore",
      description: "Marketplace focused on install guides, packaging patterns, and skill submission review.",
      homepage: "https://skillstore.io",
      install_kind: "manual",
      trust: "curated",
      recommended_policy: "ask",
      notes: "Useful discovery surface; installation method depends on the linked repository.",
    },
    {
      id: "skills-pub",
      name: "skills.pub",
      provider: "skills.pub",
      description: "High-volume community index covering hundreds of public skills across ecosystems.",
      homepage: "https://skills.pub",
      install_kind: "manual",
      trust: "community",
      recommended_policy: "ask",
      notes: "Community directory only; import the referenced repo or path after review.",
    },
  ]

  /**
   * 返回市场条目：内置默认 + 从配置的 registry URL 动态拉取。
   * registry URL 应返回 MarketEntry[] JSON 数组。
   */
  export async function market() {
    const entries = [...BUILTIN_MARKET]
    const global = await Config.getGlobal().catch(() => undefined)
    const registries = ((global?.skills as Record<string, unknown> | undefined)?.registries ?? []) as string[]
    const seenIDs = new Set(entries.map((e) => e.id))

    // 并行拉取所有配置的 registry
    const fetched = await Promise.all(
      registries.map(async (url: string) => {
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) })
          if (!resp.ok) return []
          const data = await resp.json()
          return MarketEntry.array().parse(data)
        } catch {
          return []
        }
      }),
    )
    for (const list of fetched) {
      for (const entry of list) {
        if (!seenIDs.has(entry.id)) {
          entries.push(entry)
          seenIDs.add(entry.id)
        }
      }
    }

    return MarketEntry.array().parse(entries)
  }

  export async function installed() {
    const global = await Config.getGlobal()
    const rules = PermissionNext.fromConfig(global.permission ?? {})
    const configuredPaths = (global.skills?.paths ?? []).map(resolveSource)
    const configuredUrls = global.skills?.urls ?? []
    const root = managedRoot()
    const cache = Discovery.dir()

    return Installed.array().parse(
      await Promise.all(
        (await Skill.all()).map(async (skill) => {
          const dir = skill.location === "builtin" ? undefined : path.dirname(skill.location)
          const manifest = dir ? await readManifest(dir, root, cache) : undefined
          const sourceType = dir ? sourceTypeFor(dir, configuredPaths, cache, manifest?.kind) : "builtin"
          const trust = trustFor(skill, manifest?.source)
          const risk = dir
            ? await riskFor(dir, trust)
            : {
                level: "low" as const,
                has_scripts: false,
                has_agents: false,
                has_references: false,
                has_templates: false,
              }
          return {
            ...skill,
            dir,
            source_type:
              manifest?.kind === "git" ? "managed_git" : manifest?.kind === "url" ? "config_url" : sourceType,
            source:
              manifest?.source ??
              (sourceType === "config_path"
                ? configuredPaths.find((item) => Filesystem.contains(item, dir!))
                : undefined) ??
              (sourceType === "config_url" && configuredUrls.length === 1 ? configuredUrls[0] : undefined),
            trust,
            risk,
            recommended_policy: recommendedPolicy(trust, risk),
            policy: PermissionNext.evaluate("skill", skill.name, rules).action,
            managed: !!dir && Filesystem.contains(root, dir),
            writable: !!dir && (await Filesystem.isDir(dir)),
          }
        }),
      ),
    )
  }

  export async function install(raw: z.input<typeof InstallInput>) {
    const input = InstallInput.parse(raw)
    if (input.kind === "path") {
      const resolved = resolveSource(input.value)
      await ensureSkillDir(resolved)
      await patchGlobal((next) => {
        next.skills = next.skills || {}
        next.skills.paths = dedupe([...(next.skills.paths ?? []), resolved])
      })
      if (input.policy) {
        await applyPolicyToSource(resolved, input.policy)
      }
      return { source: resolved, kind: input.kind }
    }

    if (input.kind === "url") {
      const value = normalizeUrl(input.value)
      const pulled = await Discovery.pull(value)
      if (pulled.length === 0) {
        throw new Error(`No skills discovered from ${value}`)
      }
      await patchGlobal((next) => {
        next.skills = next.skills || {}
        next.skills.urls = dedupe([...(next.skills.urls ?? []), value])
      })
      await Promise.all(
        pulled.map((dir) =>
          Filesystem.writeJson(path.join(dir, MANIFEST), {
            kind: "url",
            source: value,
            installed_at: Date.now(),
          }),
        ),
      )
      if (input.policy) {
        await applyPolicyToNames((await Promise.all(pulled.map(listSkillNamesInDir))).flat(), input.policy)
      }
      return { source: value, kind: input.kind }
    }

    const source = normalizeGit(input.value)
    const target = managedGitTarget(source)
    await ensureManagedRepo(source, target)
    await ensureSkillDir(target)
    await Filesystem.writeJson(path.join(target, MANIFEST), {
      kind: "git",
      source,
      installed_at: Date.now(),
    })
    await patchGlobal((next) => {
      next.skills = next.skills || {}
      next.skills.paths = dedupe([...(next.skills.paths ?? []), target])
    })
    if (input.policy) {
      await applyPolicyToSource(target, input.policy)
    }
    return { source, path: target, kind: input.kind }
  }

  export async function importFile(raw: z.input<typeof ImportFileInput>) {
    const input = ImportFileInput.parse(raw)
    const files = input.archiveBase64
      ? await readZipSkillFiles(input.filename ?? input.sourceName ?? "skill.zip", input.archiveBase64)
      : input.files?.length
        ? input.files
        : [
            {
              path: input.filename ?? "SKILL.md",
              content: input.content ?? "",
            },
          ]

    const projectConfigDir = Config.projectConfigDirectory()
    const normalized = normalizeBundleFiles(files)
    const skillRoots = parseSkillRoots(normalized)
    const imported: Array<{ name: string; source: string }> = []

    for (const root of skillRoots) {
      const dirName = slug(root.info.name)
      if (!dirName) throw new Error(`Invalid skill name: ${root.info.name}`)
      const targetDir = path.join(projectConfigDir, "skill", dirName)

      for (const file of root.files) {
        const target = path.join(targetDir, ...file.relativePath.split("/"))
        if (!Filesystem.contains(projectConfigDir, target)) {
          throw new Error(`Refusing to write skill outside project config directory: ${file.sourcePath}`)
        }
        await Filesystem.write(target, file.bytes)
      }
      imported.push({ name: root.info.name, source: path.join(targetDir, "SKILL.md") })
    }

    await Config.state.reset()
    await Skill.state.reset()
    if (input.policy) {
      await applyPolicyToNames(
        imported.map((item) => item.name),
        input.policy,
      )
    }
    return {
      name: imported[0]!.name,
      source: imported[0]!.source,
      kind: "path" as const,
      names: imported.map((item) => item.name),
      sources: imported.map((item) => item.source),
    }
  }

  export async function remove(raw: z.input<typeof RemoveInput>) {
    const input = RemoveInput.parse(raw)
    const source =
      input.kind === "git"
        ? managedGitTarget(normalizeGit(input.source))
        : input.kind === "url"
          ? input.source
          : resolveSource(input.source)

    await patchGlobal((next) => {
      next.skills = next.skills || {}
      next.skills.paths = (next.skills.paths ?? []).filter((item) => resolveSource(item) !== source)
      next.skills.urls = (next.skills.urls ?? []).filter((item) => item !== input.source)
    })

    if (Filesystem.contains(managedRoot(), source)) {
      await rm(source, { recursive: true, force: true })
    }

    await Config.state.reset()
    await Skill.state.reset()

    return true
  }

  export async function setPolicy(raw: z.input<typeof PolicyInput>) {
    const input = PolicyInput.parse(raw)
    await patchGlobal((next) => {
      if (typeof next.permission !== "object" || !next.permission) next.permission = {}
      const current = next.permission.skill
      const table: Record<string, Config.PermissionAction> =
        typeof current === "string" ? { "*": current } : current && typeof current === "object" ? { ...current } : {}
      table[input.name] = input.action
      next.permission.skill = table
    })
    return true
  }
}

function resolveSource(value: string) {
  const expanded = value.startsWith("~/") ? path.join(Global.Path.home, value.slice(2)) : value
  return path.isAbsolute(expanded) ? expanded : path.resolve(Instance.directory, expanded)
}

function dedupe(list: string[]) {
  return [...new Set(list.filter(Boolean))]
}

function normalizeUrl(value: string) {
  const url = new URL(value)
  return url.toString().replace(/\/+$/, "") + "/"
}

function normalizeGit(value: string) {
  const trimmed = value.trim()
  if (/^[a-z]+:\/\//i.test(trimmed) || trimmed.startsWith("git@")) return trimmed
  if (/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?$/.test(trimmed)) {
    const parts = trimmed.split("/")
    return `https://github.com/${parts[0]}/${parts[1]}.git`
  }
  return trimmed
}

function slug(value: string) {
  return value
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\.git$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

function managedGitTarget(source: string) {
  const root = SkillManager.managedRoot()
  const name = slug(source)
  if (
    !name ||
    name === "." ||
    name === ".." ||
    path.basename(name) !== name ||
    path.isAbsolute(name) ||
    path.win32.isAbsolute(name)
  ) {
    throw new Error(`Invalid git skill source slug: ${source}`)
  }
  const target = path.resolve(root, name)
  if (target === path.resolve(root) || !Filesystem.contains(root, target)) {
    throw new Error(`Invalid git skill source slug: ${source}`)
  }
  return target
}

async function ensureManagedRepo(source: string, dest: string) {
  const git = which("git")
  if (!git) throw new Error("git is required to install skills from repositories")
  await Filesystem.write(path.join(dest, ".keep"), "")
  await rm(path.join(dest, ".keep"), { force: true })

  if (await Filesystem.isDir(path.join(dest, ".git"))) {
    await Process.run([git, "-C", dest, "pull", "--ff-only"])
    return
  }

  if (await Filesystem.isDir(dest)) {
    await rm(dest, { recursive: true, force: true })
  }

  await Process.run([git, "clone", "--depth", "1", source, dest])
}

async function ensureSkillDir(dir: string) {
  if (!(await Filesystem.isDir(dir))) {
    throw new Error(`Skill directory not found: ${dir}`)
  }
  const matches = await Glob.scan("**/SKILL.md", {
    cwd: dir,
    absolute: true,
    include: "file",
    dot: true,
    symlink: true,
  })
  if (matches.length === 0) {
    throw new Error(`No SKILL.md files found in ${dir}`)
  }
}

async function patchGlobal(mutator: (next: z.infer<typeof Config.Info>) => void) {
  const next = structuredClone(await Config.getGlobal())
  mutator(next)
  await Config.updateGlobal(next)
}

async function applyPolicyToSource(source: string, policy: z.infer<typeof SkillManager.Policy>) {
  const names = await listSkillNamesInDir(source)
  if (names.length === 0) return
  await applyPolicyToNames(names, policy)
}

async function applyPolicyToNames(names: string[], policy: z.infer<typeof SkillManager.Policy>) {
  await patchGlobal((next) => {
    if (typeof next.permission !== "object" || !next.permission) next.permission = {}
    const current = next.permission.skill
    const table: Record<string, Config.PermissionAction> =
      typeof current === "string" ? { "*": current } : current && typeof current === "object" ? { ...current } : {}
    for (const name of names) {
      table[name] = policy
    }
    next.permission.skill = table
  })
}

function sourceTypeFor(dir: string, configuredPaths: string[], cache: string, kind?: string) {
  if (kind === "git") return "managed_git"
  if (kind === "url") return "config_url"
  if (Filesystem.contains(SkillManager.managedRoot(), dir)) return "managed_git"
  if (Filesystem.contains(cache, dir)) return "config_url"
  if (configuredPaths.some((item) => Filesystem.contains(item, dir))) return "config_path"
  if (
    dir.includes(`${path.sep}.claude${path.sep}`) ||
    dir.includes(`${path.sep}.agents${path.sep}`) ||
    dir.includes(`${path.sep}.codex${path.sep}`) ||
    dir.includes(`${path.sep}.opencorvus${path.sep}skills${path.sep}`)
  )
    return "external"
  return "unknown"
}

function trustFor(skill: z.infer<typeof SkillInfo>, source?: string) {
  if (skill.builtin) return "builtin" as const
  if (source?.includes("github.com/openai/skills")) return "official" as const
  if (source?.includes("github.com/anthropics/skills")) return "official" as const
  if (source?.includes("skills.sh")) return "curated" as const
  if (source?.includes("skillstore.io")) return "curated" as const
  if (source?.includes("skills.pub")) return "community" as const
  if (
    skill.location.includes(`${path.sep}.claude${path.sep}`) ||
    skill.location.includes(`${path.sep}.agents${path.sep}`) ||
    skill.location.includes(`${path.sep}.codex${path.sep}`) ||
    skill.location.includes(`${path.sep}.opencorvus${path.sep}skills${path.sep}`)
  ) {
    return "external" as const
  }
  if (skill.location !== "builtin") return "local" as const
  return "unknown" as const
}

async function riskFor(dir: string, trust: z.infer<typeof SkillManager.Trust>) {
  const [scripts, agents, references, templates] = await Promise.all([
    Glob.scan("{script,scripts}/**/*", { cwd: dir, absolute: true, include: "file", dot: true, symlink: true }).catch(
      () => [],
    ),
    Glob.scan("{agent,agents}/**/*", { cwd: dir, absolute: true, include: "file", dot: true, symlink: true }).catch(
      () => [],
    ),
    Glob.scan("{reference,references}/**/*", {
      cwd: dir,
      absolute: true,
      include: "file",
      dot: true,
      symlink: true,
    }).catch(() => []),
    Glob.scan("{template,templates,asset,assets}/**/*", {
      cwd: dir,
      absolute: true,
      include: "file",
      dot: true,
      symlink: true,
    }).catch(() => []),
  ])
  const hasScripts = scripts.length > 0
  const hasAgents = agents.length > 0
  const hasReferences = references.length > 0
  const hasTemplates = templates.length > 0
  const level = hasScripts
    ? "high"
    : trust === "community" || trust === "unknown" || trust === "external"
      ? "medium"
      : hasAgents || hasReferences
        ? "medium"
        : "low"
  return {
    level,
    has_scripts: hasScripts,
    has_agents: hasAgents,
    has_references: hasReferences,
    has_templates: hasTemplates,
  } as const
}

function recommendedPolicy(trust: z.infer<typeof SkillManager.Trust>, risk: z.infer<typeof SkillManager.Risk>) {
  if (trust === "builtin") return "allow" as const
  if (risk.level === "high") return "ask" as const
  if (trust === "community" || trust === "unknown" || trust === "external") return "ask" as const
  return "ask" as const
}

async function readManifest(dir: string, ...roots: string[]) {
  let current = dir
  while (true) {
    const file = path.join(current, MANIFEST)
    const manifest = await Filesystem.readJson<{ kind?: string; source?: string }>(file).catch(() => undefined)
    if (manifest) return manifest
    const parent = path.dirname(current)
    if (parent === current) return undefined
    if (roots.some((root) => current === root)) return undefined
    current = parent
  }
}

async function listSkillNamesInDir(dir: string) {
  if (!(await Filesystem.isDir(dir))) return []
  const matches = await Glob.scan("**/SKILL.md", {
    cwd: dir,
    absolute: true,
    include: "file",
    dot: true,
    symlink: true,
  })
  const names = await Promise.all(
    matches.map(async (file) => {
      const text = await Filesystem.readText(file).catch(() => "")
      if (!text) return undefined
      const parsed = matter(text)
      return typeof parsed.data.name === "string" && parsed.data.name.trim() ? parsed.data.name.trim() : undefined
    }),
  )
  return dedupe(names.filter((item): item is string => !!item))
}

type SkillImportFileInput = z.infer<typeof SkillManager.ImportBundleFile>
type NormalizedSkillFile = {
  path: string
  bytes: Uint8Array
}
type ParsedSkillRoot = {
  info: Pick<z.infer<typeof Skill.Info>, "name" | "description">
  files: Array<{
    sourcePath: string
    relativePath: string
    bytes: Uint8Array
  }>
}

async function readZipSkillFiles(filename: string, archiveBase64: string): Promise<SkillImportFileInput[]> {
  const archive = Uint8Array.from(Buffer.from(archiveBase64, "base64"))
  const reader = new ZipReader(new Uint8ArrayReader(archive))
  try {
    const entries = await reader.getEntries()
    const files: SkillImportFileInput[] = []
    for (const entry of entries) {
      if (entry.directory) continue
      const data = await entry.getData?.(new Uint8ArrayWriter())
      if (!data) continue
      files.push({
        path: entry.filename,
        contentBase64: Buffer.from(data).toString("base64"),
      })
    }
    if (files.length === 0) throw new Error(`No files found in ${filename}`)
    return files
  } finally {
    await reader.close()
  }
}

function normalizeBundleFiles(files: SkillImportFileInput[]): NormalizedSkillFile[] {
  return files.map((file) => {
    const relativePath = normalizeImportPath(file.path)
    return {
      path: relativePath,
      bytes:
        file.contentBase64 !== undefined
          ? Uint8Array.from(Buffer.from(file.contentBase64, "base64"))
          : new TextEncoder().encode(file.content ?? ""),
    }
  })
}

function normalizeImportPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "")
  const segments = normalized.split("/").filter(Boolean)
  if (segments.length === 0) throw new Error(`Invalid empty skill import path: ${value}`)
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Refusing unsafe skill import path: ${value}`)
  }
  if (/^[a-zA-Z]:/.test(segments[0]!)) {
    throw new Error(`Refusing absolute skill import path: ${value}`)
  }
  return segments.join("/")
}

function parseSkillRoots(files: NormalizedSkillFile[]): ParsedSkillRoot[] {
  const skillFiles = files.filter((file) => path.posix.basename(file.path).toLowerCase() === "skill.md")
  if (skillFiles.length === 0) {
    throw new Error("No SKILL.md files found in dropped skill source")
  }

  return skillFiles.map((skillFile) => {
    const rootPath = path.posix.dirname(skillFile.path)
    const root = rootPath === "." ? "" : rootPath
    const siblingSkillRoots = skillFiles
      .filter((file) => file.path !== skillFile.path)
      .map((file) => {
        const dir = path.posix.dirname(file.path)
        return dir === "." ? "" : dir
      })
      .filter(Boolean)
    const parsed = matter(new TextDecoder().decode(skillFile.bytes))
    const info = Skill.Info.pick({ name: true, description: true }).parse(parsed.data)
    const rootFiles = files
      .filter((file) => {
        if (root) return file.path === root || file.path.startsWith(`${root}/`)
        if (skillFiles.length === 1) return true
        return !siblingSkillRoots.some((siblingRoot) => file.path.startsWith(`${siblingRoot}/`))
      })
      .map((file) => ({
        sourcePath: file.path,
        relativePath: root ? file.path.slice(root.length + 1) : file.path,
        bytes: file.bytes,
      }))
      .filter((file) => file.relativePath)
    return { info, files: rootFiles }
  })
}
