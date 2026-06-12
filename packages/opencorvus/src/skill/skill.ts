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
import { Bus } from "@/bus"
import { Session } from "@/session"
import { Discovery } from "./discovery"
import { Glob } from "../util/glob"
import researchReportMd from "./builtin/research-report.md" with { type: "text" }

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
    required_tools: z.array(z.string()).optional().default([]),
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
  const BUILTIN_PATH = path.join(Global.Path.cache, "builtin-skills")

  type BuiltinFile =
    | string
    | {
        encoding: "utf8" | "base64"
        content: string
      }

  const builtins = [{ skill: researchReportMd, files: {} }] as const

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

  async function install(id: string, skill: string, files: Readonly<Record<string, BuiltinFile>>) {
    const dir = path.join(BUILTIN_PATH, id)
    await Filesystem.write(path.join(dir, "SKILL.md"), skill)
    await Promise.all(
      Object.entries(files).map(([file, content]) =>
        Filesystem.write(path.join(dir, file), decodeBuiltinFile(content)),
      ),
    )
    return path.join(dir, "SKILL.md")
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
        expires_at: true,
      }).safeParse(md.data)
      if (!parsed.success) continue
      if (isExpired(parsed.data)) continue
      const location =
        Object.keys(raw.files).length === 0 ? "builtin" : await install(parsed.data.name, raw.skill, raw.files)
      registerSkill(skills, skillLocations, {
        name: parsed.data.name,
        description: parsed.data.description,
        platforms: parsed.data.platforms,
        builtin: true,
        location,
        content: md.content,
        auto_detect: parsed.data.auto_detect,
        priority: parsed.data.priority,
        required_tools: parsed.data.required_tools,
        expires_at: parsed.data.expires_at,
        duplicate_locations: [],
      })
    }

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
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
        expires_at: true,
      }).safeParse(md.data)
      if (!parsed.success) return
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
        expires_at: parsed.data.expires_at,
        duplicate_locations: [],
      })
    }

    const scanExternal = async (root: string, scope: "global" | "project") => {
      return Glob.scan(EXTERNAL_SKILL_PATTERN, {
        cwd: root,
        absolute: true,
        include: "file",
        dot: true,
        symlink: true,
      })
        .then((matches) => Promise.all(matches.map(addSkill)))
        .catch((error) => {
          log.error(`failed to scan ${scope} skills`, { dir: root, error })
        })
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
