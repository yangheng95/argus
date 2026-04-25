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

/**
 * Per-stage invariants that the skill system ALWAYS prepends to the skills
 * section, whether or not any skill matched. These are contract-level
 * reminders ("if any loaded skill declares required_tools, submit_verdict
 * will enforce them") — the LLM must see them so it knows why the schema
 * validation will reject a verdict that skips the mandatory tool calls.
 *
 * These are NOT overridable: no config field can replace or suppress this
 * section. That is the whole point — bypassing the skill system bypasses
 * the contract, which historically let delivery accept a JSON-404 screenshot.
 * Single source of truth for stage contracts lives here, not in per-stage
 * CORE constants that could drift.
 */
const STAGE_INVARIANTS: Record<string, string> = {
  build: `## Skill-system invariants (enforced by BuildAgent)

Injected skills can declare \`required_tools\` in their frontmatter. When a
build-stage skill declares required tools, \`status='passed'\` is rejected by
BuildAgent unless every required tool completed in the build session. For
\`webpage_evaluate\`, BuildAgent also reads \`mirror/eval-result.json\` from the
current worktree and rejects stale or sub-target visual evidence. A webpage
clone is not passed until the freshly rendered current \`index.html\` scores at
least 95 against the reference.`,
  delivery: `## Skill-system invariants (enforced by submit_verdict)

The delivery verdict schema carries a \`tool_call_evidence[]\` array. Injected
skills declare \`required_tools\` in their frontmatter. When one or more of the
auto-loaded skills declares required tools, **verdict='accepted' will be
rejected** by submit_verdict unless every required tool appears in
tool_call_evidence with \`passed=true\` and a reproducer-grade \`detail\`
(minimum 8 non-trivial characters — numbers, URLs, exit codes, selectors, not
prose like "looks fine"). If a check cannot be made to pass, switch to
verdict='rejected' with the failing call recorded verbatim in
tool_call_evidence so the orchestrator can hand the executor exact
reproduction steps.`,
}

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

  const invariant = stage ? STAGE_INVARIANTS[stage] : undefined
  const sections = loaded.map((s) => `## Skill: ${s.name}\n\n${s.content.trim()}`)

  const parts: string[] = []
  if (invariant) parts.push(invariant)
  if (sections.length > 0) parts.push("# Injected Skills\n\n" + sections.join("\n\n---\n\n"))

  const prompt = parts.length > 0 ? "\n\n" + parts.join("\n\n") : ""
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
