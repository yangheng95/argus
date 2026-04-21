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
import panelMd from "./builtin/panel.md" with { type: "text" }
import specResearchMd from "./builtin/spec-research.md" with { type: "text" }
import prdSpecMd from "./builtin/prd-spec.md" with { type: "text" }
import deliveryVerifyWebMd from "./builtin/delivery-verify-web.md" with { type: "text" }
import deliveryVerifyApiMd from "./builtin/delivery-verify-api.md" with { type: "text" }
import webpageCloneMd from "./builtin/webpage-clone.md" with { type: "text" }

export namespace Skill {
  const log = Log.create({ service: "skill" })
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
    /** Which pipeline stage this skill is for (e.g. "delivery", "spec",
     *  "build"). Skills are instruction manuals for ONE stage at a time:
     *  executors read implementation skills ("build"), validators read
     *  verification skills ("delivery"), etc. Planning-stage agents
     *  (requirements / architect / planner) must NOT see executor skills —
     *  they plan goals, they don't implement. */
    stage: z.string().optional(),
    /** Auto-detect conditions — skill is loaded when any condition matches the project. */
    auto_detect: z.object({
      files: z.array(z.string()).optional(),
      deps: z.array(z.string()).optional(),
    }).optional(),
    /** Priority for ordering when multiple skills match (higher = first). */
    priority: z.number().optional().default(0),
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
  // These follow the directory layout used by Claude Code and other agents.
  const EXTERNAL_DIRS = [".claude", ".agents"]
  const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
  const OPENCORVUS_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
  const SKILL_PATTERN = "**/SKILL.md"
  const BUILTIN_PATH = path.join(Global.Path.cache, "builtin-skills")

  const builtins = [
    { skill: panelMd, files: {} },
    { skill: specResearchMd, files: {} },
    { skill: prdSpecMd, files: {} },
    { skill: deliveryVerifyWebMd, files: {} },
    { skill: deliveryVerifyApiMd, files: {} },
    { skill: webpageCloneMd, files: {} },
  ] as const

  async function install(id: string, skill: string, files: Readonly<Record<string, string>>) {
    const dir = path.join(BUILTIN_PATH, id)
    await Filesystem.write(path.join(dir, "SKILL.md"), skill)
    await Promise.all(Object.entries(files).map(([file, content]) => Filesystem.write(path.join(dir, file), content)))
    return path.join(dir, "SKILL.md")
  }

  export const state = lazyInstanceState(async () => {
    const skills: Record<string, Info> = {}
    const dirs = new Set<string>()

    // Register built-in skills (lowest priority — user skills with same name override)
    for (const raw of builtins) {
      const md = matter(raw.skill)
      const parsed = Info.pick({ name: true, description: true, platforms: true, stage: true, auto_detect: true, priority: true }).safeParse(md.data)
      if (!parsed.success) continue
      const location =
        Object.keys(raw.files).length === 0 ? "builtin" : await install(parsed.data.name, raw.skill, raw.files)
      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        platforms: parsed.data.platforms,
        builtin: true,
        location,
        content: md.content,
        stage: parsed.data.stage,
        auto_detect: parsed.data.auto_detect,
        priority: parsed.data.priority,
      }
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

      const parsed = Info.pick({ name: true, description: true, platforms: true, stage: true, auto_detect: true, priority: true }).safeParse(md.data)
      if (!parsed.success) return

      // Warn on duplicate skill names
      if (skills[parsed.data.name]) {
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      dirs.add(path.dirname(match))

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        platforms: parsed.data.platforms,
        builtin: false,
        location: match,
        content: md.content,
        stage: parsed.data.stage,
        auto_detect: parsed.data.auto_detect,
        priority: parsed.data.priority,
      }
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

    // Scan external skill directories (.claude/skills/, .agents/skills/, etc.)
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

