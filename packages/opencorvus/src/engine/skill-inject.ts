/**
 * Skill injection for headless agents (spec, planner, delivery, goal).
 *
 * Loads skills by:
 * 1. Explicit names from config (orchestrator.{stage}.skills)
 * 2. Auto-detect from project files/deps (skill.auto_detect + skill.stage)
 *
 * Skills declare which stage they belong to and what project characteristics
 * trigger them. Adding a new SKILL.md file with stage + auto_detect is
 * sufficient — no code changes needed.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Skill } from "@/skill/skill"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "skill-inject" })

/**
 * Load skills for a pipeline stage: explicit config + auto-detected.
 * @param explicitNames - skill names from orchestrator config
 * @param stage - pipeline stage ("spec", "planner", "delivery", "goal")
 */
export async function loadStageSkills(explicitNames: string[], stage?: string): Promise<string> {
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

  // 2. Auto-detect skills matching this stage + project characteristics.
  if (stage) {
    const candidates = all.filter((s) =>
      s.stage === stage &&
      s.auto_detect &&
      !seen.has(s.name),
    )
    for (const skill of candidates) {
      if (matchesProject(skill.auto_detect!)) {
        seen.add(skill.name)
        loaded.push(skill)
        log.info("auto-detected skill", { name: skill.name, stage })
      }
    }
  }

  if (loaded.length === 0) return ""

  // Sort by priority (higher first), then by name for stability
  loaded.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name))

  const sections = loaded.map((s) => `## Skill: ${s.name}\n\n${s.content.trim()}`)
  return "\n\n# Injected Skills\n\n" + sections.join("\n\n---\n\n")
}

function matchesProject(detect: { files?: string[]; deps?: string[] }): boolean {
  const dir = Instance.directory
  if (detect.files?.some((f) => existsSync(join(dir, f)))) return true
  if (detect.deps) {
    const pkg = tryReadPackageJson(dir)
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (detect.deps.some((d) => d in allDeps)) return true
    }
  }
  return false
}

function tryReadPackageJson(dir: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
  try {
    const raw = require(join(dir, "package.json"))
    return raw && typeof raw === "object" ? raw : null
  } catch {
    return null
  }
}
