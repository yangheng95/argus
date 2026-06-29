import z from "zod"
import path from "path"
import os from "os"
import matter from "gray-matter"
import { Config } from "../config/config"
import { Instance, lazyInstanceState } from "../project/instance"
import { NamedError } from "@opencorvus-ai/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { Discovery } from "./discovery"
import { Glob } from "../util/glob"
import { SkillRequiredTools } from "./required-tools"
import researchReportMd from "./builtin/research-report.md" with { type: "text" }
import frontendReplicaExpertSquadMd from "./builtin/frontend-replica-expert-squad.md" with { type: "text" }
import frontendAutomationDebugExpertSquadMd from "./builtin/frontend-automation-debug-expert-squad.md" with { type: "text" }

export namespace Skill {
  const log = Log.create({ service: "skill" })
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

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    platforms: z
      .array(z.enum(["win32", "darwin", "linux"]))
      .optional()
      .default([]),
    builtin: z.boolean().optional().default(false),
    location: z.string(),
    content: z.string(),
    /** Auto-detect conditions — skill is loaded when any condition matches the project
     *  OR the active task. File / deps scan the Instance directory; task_signals are
     *  derived from the current task's request, attachments, and scripts. Any single
     *  matching condition (across all three buckets) is sufficient. */
    auto_detect: z
      .object({
        files: z.array(z.string()).optional(),
        deps: z.array(z.string()).optional(),
        task_signals: z
          .object({
            has_attachment_image: z
              .boolean()
              .optional()
              .describe("True when the task carries a reference image attachment."),
            request_contains_url: z
              .boolean()
              .optional()
              .describe(
                "True when the task request text contains an http(s) URL — explicitly EXCLUDING figma.com URLs (those drive `request_contains_figma_url`).",
              ),
            request_contains_figma_url: z
              .boolean()
              .optional()
              .describe(
                "True when the task request text contains a figma.com URL (file / design / proto / board path). Mutually exclusive with `request_contains_url` by construction in deriveUrlSignals.",
              ),
            package_has_script: z
              .array(z.string())
              .optional()
              .describe("Any of the listed npm/bun scripts exists in the project's package.json."),
            request_text_any: z
              .array(z.string())
              .optional()
              .describe("Any listed case-insensitive substring must appear in the task request text."),
          })
          .optional(),
      })
      .optional(),
    /** Priority for ordering when multiple skills match (higher = first). */
    priority: z.number().optional().default(0),
    /** Descriptive tool hints for agents that load this skill. Empty or
     *  omitted = no tool hints. */
    required_tools: SkillRequiredTools,
    /** Optional agent-name allow list. Empty or omitted means any compatible agent may load it. */
    agents: z.array(z.string()).optional().default([]),
    /** Explicit OpenCorvus mount list. Empty or omitted means this skill is in the pool but unavailable. */
    mounted_agents: z.array(z.string()).optional().default([]),
    expires_at: ExpirationTimestamp,
    duplicate_locations: z.array(z.string()).optional().default([]),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  // External skill directories to search for (project-level and global)
  // These follow the directory layout used by Claude Code, Codex, OpenCorvus, and other agents.
  const EXTERNAL_DIRS = [".claude", ".agents", ".codex", ".opencorvus"]
  const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
  const OPENCORVUS_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
  const SKILL_PATTERN = "**/SKILL.md"
  function builtinPath() {
    return path.join(Global.Path.cache, "builtin-skills")
  }

  type BuiltinFile =
    | string
    | {
        encoding: "utf8" | "base64"
        content: string
      }

  const builtins = [
    { skill: researchReportMd, files: {} },
    { skill: frontendReplicaExpertSquadMd, files: {} },
    { skill: frontendAutomationDebugExpertSquadMd, files: {} },
  ] as const

  function isExpired(info: Pick<Info, "expires_at">) {
    return info.expires_at !== undefined && Date.parse(info.expires_at) <= Date.now()
  }

  function registerSkill(skills: Record<string, Info>, locations: Map<string, string[]>, skill: Info) {
    const existingLocations = locations.get(skill.name) ?? []
    const seenLocation = existingLocations.includes(skill.location)
    const duplicateLocations = seenLocation ? existingLocations : [...existingLocations, skill.location]
    locations.set(skill.name, duplicateLocations)
    if (!seenLocation && existingLocations.length > 0) {
      log.warn("duplicate skill name", {
        name: skill.name,
        locations: duplicateLocations,
      })
    }
    skills[skill.name] = {
      ...skill,
      duplicate_locations: duplicateLocations.length > 1 ? duplicateLocations : [],
    }
  }

  function decodeBuiltinFile(file: BuiltinFile) {
    if (typeof file === "string") return file
    if (file.encoding === "base64") return Buffer.from(file.content, "base64")
    return file.content
  }

  function builtinProjectSlug(value: string) {
    return value
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
  }

  function builtinProjectSkillPath(name: string) {
    const slug = builtinProjectSlug(name)
    if (!slug || slug === "." || slug === ".." || path.basename(slug) !== slug) {
      throw new Error(`Invalid builtin skill name: ${name}`)
    }
    return path.join(Config.projectConfigDirectory(), "skills", slug, "SKILL.md")
  }

  function builtinSource(name: string) {
    for (const raw of builtins) {
      const md = matter(raw.skill)
      const parsed = Info.pick({ name: true }).safeParse(md.data)
      if (parsed.success && parsed.data.name === name) return raw
    }
    return undefined
  }

  export async function writeMountedAgents(location: string, agents: string[]) {
    if (location === "builtin") throw new Error("Built-in skills must be materialized before mounting.")
    const uniqueAgents = Array.from(new Set(agents.map((agent) => agent.trim()).filter(Boolean)))
    const md = await ConfigMarkdown.parse(location)
    const next = matter.stringify(md.content, {
      ...md.data,
      mounted_agents: uniqueAgents,
    })
    await Filesystem.write(location, next)
    await state.reset()
  }

  async function install(id: string, skill: string, files: Readonly<Record<string, BuiltinFile>>) {
    const dir = path.join(builtinPath(), id)
    const skillPath = path.join(dir, "SKILL.md")
    const source = matter(skill)
    const existing = await ConfigMarkdown.parse(skillPath).catch(() => undefined)
    const existingMountedAgents = existing
      ? Info.pick({ mounted_agents: true }).safeParse(existing.data).data?.mounted_agents
      : undefined
    const hasExistingMountField = existing
      ? Object.prototype.hasOwnProperty.call(existing.data, "mounted_agents")
      : false
    const next = matter.stringify(source.content, {
      ...source.data,
      ...(existingMountedAgents || hasExistingMountField ? { mounted_agents: existingMountedAgents ?? [] } : {}),
    })
    await Filesystem.write(skillPath, next)
    await Promise.all(
      Object.entries(files).map(([file, content]) =>
        Filesystem.write(path.join(dir, file), decodeBuiltinFile(content)),
      ),
    )
    return skillPath
  }

  export async function materializeBuiltinProjectSkill(name: string, mountedAgents: string[] = []) {
    const raw = builtinSource(name)
    if (!raw) throw new Error(`Unknown builtin skill: ${name}`)
    const target = builtinProjectSkillPath(name)
    const existing = await ConfigMarkdown.parse(target).catch(() => undefined)
    if (existing) {
      const parsed = Info.pick({ name: true }).safeParse(existing.data)
      if (parsed.success && parsed.data.name !== name) {
        throw new NameMismatchError({ path: target, expected: name, actual: parsed.data.name })
      }
      return target
    }

    const source = matter(raw.skill)
    const next = matter.stringify(source.content, {
      ...source.data,
      mounted_agents: Array.from(new Set(mountedAgents.map((agent) => agent.trim()).filter(Boolean))),
    })
    await Filesystem.write(target, next)
    await Promise.all(
      Object.entries(raw.files as Readonly<Record<string, BuiltinFile>>).map(([file, content]) =>
        Filesystem.write(path.join(path.dirname(target), file), decodeBuiltinFile(content)),
      ),
    )
    await Config.state.reset()
    await state.reset()
    return target
  }

  export const state = lazyInstanceState(async () => {
    const skills: Record<string, Info> = {}
    const skillLocations = new Map<string, string[]>()
    const dirs = new Set<string>()

    // Register built-in skills (lowest priority — user skills with same name override)
    for (const raw of builtins) {
      const md = matter(raw.skill)
      const parsed = Info.pick({
        name: true,
        description: true,
        platforms: true,
        auto_detect: true,
        priority: true,
        required_tools: true,
        agents: true,
        mounted_agents: true,
        expires_at: true,
      }).safeParse(md.data)
      if (!parsed.success) continue
      if (isExpired(parsed.data)) continue
      if (await Filesystem.exists(builtinProjectSkillPath(parsed.data.name))) continue
      const location = await install(parsed.data.name, raw.skill, raw.files)
      const installed = await ConfigMarkdown.parse(location)
      const installedParsed = Info.pick({
        name: true,
        description: true,
        platforms: true,
        auto_detect: true,
        priority: true,
        required_tools: true,
        agents: true,
        mounted_agents: true,
        expires_at: true,
      }).parse(installed.data)
      if (isExpired(installedParsed)) continue
      registerSkill(skills, skillLocations, {
        name: installedParsed.name,
        description: installedParsed.description,
        platforms: installedParsed.platforms,
        builtin: true,
        location,
        content: installed.content,
        auto_detect: installedParsed.auto_detect,
        priority: installedParsed.priority,
        required_tools: installedParsed.required_tools,
        agents: installedParsed.agents,
        mounted_agents: installedParsed.mounted_agents,
        expires_at: installedParsed.expires_at,
        duplicate_locations: [],
      })
    }

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        log.error("failed to load skill", { skill: match, err })
        return undefined
      })

      if (!md) return

      const parsed = Info.pick({
        name: true,
        description: true,
        platforms: true,
        auto_detect: true,
        priority: true,
        required_tools: true,
        agents: true,
        mounted_agents: true,
        expires_at: true,
      }).safeParse(md.data)
      if (!parsed.success) {
        throw new InvalidError(
          {
            path: match,
            message: parsed.error.message,
            issues: parsed.error.issues,
          },
          { cause: parsed.error },
        )
      }
      if (isExpired(parsed.data)) return

      dirs.add(path.dirname(match))

      registerSkill(skills, skillLocations, {
        name: parsed.data.name,
        description: parsed.data.description,
        platforms: parsed.data.platforms,
        builtin: false,
        location: match,
        content: md.content,
        auto_detect: parsed.data.auto_detect,
        priority: parsed.data.priority,
        required_tools: parsed.data.required_tools,
        agents: parsed.data.agents,
        mounted_agents: parsed.data.mounted_agents,
        expires_at: parsed.data.expires_at,
        duplicate_locations: [],
      })
    }

    const scanExternal = async (root: string, scope: "global" | "project") => {
      const matches = await Glob.scan(EXTERNAL_SKILL_PATTERN, {
        cwd: root,
        absolute: true,
        include: "file",
        dot: true,
        symlink: true,
      }).catch((error) => {
        log.error(`failed to scan ${scope} skills`, { dir: root, error })
        throw error
      })
      await Promise.all(matches.map(addSkill))
    }

    // Scan external skill directories (.claude/skills/, .agents/skills/, .codex/skills/, etc.)
    // Load global (home) first, then project-level (so project-level overwrites)
    if (!Flag.OPENCORVUS_DISABLE_EXTERNAL_SKILLS) {
      for (const dir of EXTERNAL_DIRS) {
        const root = path.join(Global.Path.home, dir)
        if (!(await Filesystem.isDir(root))) continue
        await scanExternal(root, "global")
      }

      for await (const root of Filesystem.up({
        targets: EXTERNAL_DIRS,
        start: Instance.directory,
        stop: Instance.worktree,
      })) {
        await scanExternal(root, "project")
      }
    }

    // Scan .opencorvus/skill/ directories
    for (const dir of await Config.directories()) {
      const matches = await Glob.scan(OPENCORVUS_SKILL_PATTERN, {
        cwd: dir,
        absolute: true,
        include: "file",
        symlink: true,
      })
      for (const match of matches) {
        await addSkill(match)
      }
    }

    // Scan additional skill paths from config
    const config = await Config.get()
    for (const skillPath of config.skills?.paths ?? []) {
      const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
      const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
      if (!(await Filesystem.isDir(resolved))) {
        log.warn("skill path not found", { path: resolved })
        continue
      }
      const matches = await Glob.scan(SKILL_PATTERN, {
        cwd: resolved,
        absolute: true,
        include: "file",
        dot: true,
        symlink: true,
      })
      for (const match of matches) {
        await addSkill(match)
      }
    }

    // Download and load skills from URLs
    for (const url of config.skills?.urls ?? []) {
      const list = await Discovery.pull(url)
      for (const dir of list) {
        dirs.add(dir)
        const matches = await Glob.scan(SKILL_PATTERN, {
          cwd: dir,
          absolute: true,
          include: "file",
          dot: true,
          symlink: true,
        })
        for (const match of matches) {
          await addSkill(match)
        }
      }
    }

    return {
      skills,
      dirs: Array.from(dirs),
    }
  })

  export async function get(name: string) {
    return state().then((x) => x.skills[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x.skills))
  }

  export async function dirs() {
    return state().then((x) => x.dirs)
  }
}
