/**
 * Skill injection for headless agents (spec, planner, delivery, goal).
 *
 * Loads skills by:
 * 1. Explicit names from config (orchestrator.{stage}.skills)
 * 2. Auto-detect from project files/deps AND task signals
 *    (skill.auto_detect + skill.stage)
 *
 * Skills declare which stage they belong to and what project / task
 * characteristics trigger them. Adding a new SKILL.md file with stage +
 * auto_detect is sufficient — no code changes needed.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Skill } from "@/skill/skill"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "skill-inject" })

/** Characteristics of the active task used to auto-detect skills. */
export interface TaskSignals {
  /** Task carries a reference image attachment (PNG/JPEG/WEBP). */
  has_attachment_image?: boolean
  /** The request text contains an http(s):// URL. */
  request_contains_url?: boolean
  /** Raw request text — matchers may peek for keywords; prefer signals over regex. */
  request_text?: string
}

/** Result of resolving the skills for one stage invocation. Exposed so callers
 *  that need more than the prompt string (e.g. delivery's `required_tools`
 *  enforcement) can inspect the matched skill set. */
export interface ResolvedSkills {
  prompt: string
  skills: Skill.Info[]
  /** Union of `required_tools` across all matched skills — what the delivery
   *  agent MUST have called (and passed) before submit_verdict(accepted). */
  requiredTools: string[]
}

/**
 * Load skills for a pipeline stage: explicit config + auto-detected.
 * @param explicitNames - skill names from orchestrator config
 * @param stage - pipeline stage ("spec", "planner", "delivery", "goal")
 * @param taskSignals - task-level detection signals (attachments, request text)
 */
export async function loadStageSkills(
  explicitNames: string[],
  stage?: string,
  taskSignals?: TaskSignals,
): Promise<string> {
  const resolved = await resolveStageSkills(explicitNames, stage, taskSignals)
  return resolved.prompt
}

export async function resolveStageSkills(
  explicitNames: string[],
  stage?: string,
  taskSignals?: TaskSignals,
): Promise<ResolvedSkills> {
  const all = await Skill.all()
  const seen = new Set<string>()
  const loaded: Skill.Info[] = []

  // 1. Explicit skills from config (always loaded, highest priority)
  for (const name of explicitNames ?? []) {
    if (seen.has(name)) continue
    const skill = all.find((s) => s.name === name)
    if (!skill) {
      log.warn("stage skill not found", { name, stage })
      continue
    }
    seen.add(name)
    loaded.push(skill)
  }

  // 2. Auto-detect skills matching this stage + project / task signals.
  if (stage) {
    const candidates = all.filter((s) =>
      s.stage === stage &&
      s.auto_detect &&
      !seen.has(s.name),
    )
    for (const skill of candidates) {
      if (matchesProjectOrTask(skill.auto_detect!, taskSignals)) {
        seen.add(skill.name)
        loaded.push(skill)
        log.info("auto-detected skill", { name: skill.name, stage })
      }
    }
  }

  // Sort by priority (higher first), then by name for stability
  loaded.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name))

  const requiredTools = Array.from(
    new Set(loaded.flatMap((s) => s.required_tools ?? [])),
  )

  if (loaded.length === 0) {
    return { prompt: "", skills: [], requiredTools }
  }

  const sections = loaded.map((s) => `## Skill: ${s.name}\n\n${s.content.trim()}`)
  const prompt = "\n\n# Injected Skills\n\n" + sections.join("\n\n---\n\n")
  return { prompt, skills: loaded, requiredTools }
}

function matchesProjectOrTask(
  detect: NonNullable<Skill.Info["auto_detect"]>,
  taskSignals: TaskSignals | undefined,
): boolean {
  const dir = Instance.directory
  if (detect.files?.some((f) => existsSync(join(dir, f)))) return true
  if (detect.deps) {
    const pkg = tryReadPackageJson(dir)
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (detect.deps.some((d) => d in allDeps)) return true
    }
  }
  const wanted = detect.task_signals
  if (wanted && taskSignals) {
    if (wanted.has_attachment_image && taskSignals.has_attachment_image) return true
    if (wanted.request_contains_url && taskSignals.request_contains_url) return true
    if (wanted.package_has_script && wanted.package_has_script.length > 0) {
      const pkg = tryReadPackageJson(dir)
      const scripts = (pkg?.scripts ?? {}) as Record<string, string>
      if (wanted.package_has_script.some((s) => typeof scripts[s] === "string")) return true
    }
  }
  return false
}

function tryReadPackageJson(
  dir: string,
): { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } | null {
  try {
    const raw = require(join(dir, "package.json"))
    return raw && typeof raw === "object" ? raw : null
  } catch {
    return null
  }
}
