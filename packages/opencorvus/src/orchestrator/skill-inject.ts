/**
 * Skill injection for headless agents (spec, planner, evaluator, delivery).
 *
 * Loads skills by name from the Skill registry and formats them as
 * system prompt sections that can be appended to agent system prompts.
 *
 * Usage in opencorvus.jsonc:
 * ```jsonc
 * {
 *   "orchestrator": {
 *     "spec": { "skills": ["spec-quality-checklist"] },
 *     "planner": { "skills": ["plan-quality-gate", "goal-sizing"] },
 *     "evaluator": { "skills": ["evaluation-rubric"] },
 *     "delivery": { "skills": ["runtime-verify-checklist"] }
 *   }
 * }
 * ```
 */
import { Skill } from "@/skill/skill"
import { Log } from "@/util/log"

const log = Log.create({ service: "skill-inject" })

/**
 * Load named skills and format them as a system prompt section.
 * Returns empty string if no skills are configured or none are found.
 */
export async function loadStageSkills(skillNames: string[]): Promise<string> {
  if (!skillNames || skillNames.length === 0) return ""

  const sections: string[] = []

  for (const name of skillNames) {
    try {
      const skill = await Skill.get(name)
      if (!skill) {
        log.warn("stage skill not found", { name })
        continue
      }
      sections.push(
        `## Skill: ${skill.name}\n\n${skill.content.trim()}`,
      )
    } catch (err) {
      log.warn("stage skill load failed", {
        name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (sections.length === 0) return ""
  return "\n\n# Injected Skills\n\n" + sections.join("\n\n---\n\n")
}
