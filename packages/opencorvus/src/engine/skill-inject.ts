/**
 * Skill injection for headless agents (requirements, architect, design, build,
 * acceptance).
 *
 * Loads skills by:
 * 1. Explicit names from config (orchestrator.{stage}.skills)
 * 2. Auto-detect from project files/deps AND task signals
 *
 * Skills can declare which stage owns their required tools, but auto-detected
 * skill bodies are visible cross-stage. The prompt receives the matched
 * SKILL.md instructions; `stage` only scopes required-tool ownership.
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
 * reminders ("if any loaded skill declares required_tools, the stage-owned
 * terminal output tool will enforce them") — the LLM must see them so it knows why the schema
 * validation will reject a verdict that skips the mandatory tool calls.
 *
 * These are NOT overridable: no config field can replace or suppress this
 * section. That is the whole point — bypassing the skill system bypasses
 * the contract, which historically let acceptance pass on weak evidence.
 * Single source of truth for stage contracts lives here, not in per-stage
 * CORE constants that could drift.
 */
const STAGE_INVARIANTS: Record<string, string> = {
  build: `## Skill-system invariants (enforced by BuildAgent)

Injected skills can declare \`required_tools\` in their frontmatter. When a
build-stage skill declares required tools, \`status='passed'\` is rejected by
BuildAgent unless every required tool completed in the build session. Mirror
extraction tools are not build-stage tools; visual/page references must arrive
from design_analysis as PRD/SPEC decision-log entries plus optional task.design_specs anchors.
Build records its own verification evidence; Integrity owns the final workflow gate inside a review session.`,
  design_analyst: `## Skill-system invariants (design-analysis)

Design-analysis is the only stage that owns mirror extraction. Use the matched
reference skill to gather mirror artifacts, then persist both visual specs and
the complete PRD/SPEC through StructuredOutput. Do not implement application
source files in this stage.`,
  acceptance: `## Skill-system invariants (acceptance review)

Injected skills can declare \`required_tools\` in their frontmatter. When an
acceptance-stage skill declares required tools, \`verdict='accepted'\` is
invalid unless the integrity session contains concrete evidence that every
required tool completed successfully. If a check cannot be made to pass,
submit a rejected acceptance verdict with exact reproduction steps.`,
}

/** Characteristics of the active task used to auto-detect skills. */
export interface TaskSignals {
  /** Task carries a reference image attachment (PNG/JPEG/WEBP). */
  has_attachment_image?: boolean
  /** The request text contains an http(s):// URL — explicitly EXCLUDING
   *  figma.com URLs (those land on `request_contains_figma_url`). The split
   *  prevents Figma references from loading webpage-generation skills. Figma
   *  references are materialized by design_analysis through MCP, not by a
   *  mirror skill. */
  request_contains_url?: boolean
  /** The request text contains a figma.com URL (file / design / proto /
   *  board path). `request_contains_url` only tracks non-Figma URLs, so both
   *  signals can be true when the text contains both URL kinds. */
  request_contains_figma_url?: boolean
  /** Raw request text — matchers may peek for keywords; prefer signals over regex. */
  request_text?: string
}

const FIGMA_URL_REGEX =
  /\bhttps?:\/\/(?:[\w-]+\.)?figma\.com\/(?:file|design|proto|board)(?:\/[^\s<>"'`)\]]*)?/i
const FIGMA_URL_GLOBAL_REGEX =
  /\bhttps?:\/\/(?:[\w-]+\.)?figma\.com\/(?:file|design|proto|board)(?:\/[^\s<>"'`)\]]*)?/gi
const HTTP_URL_REGEX = /\bhttps?:\/\/[^\s<>"'`)\]]+/i

/** Derive the URL-shaped signals from the active task's request text in
 *  one place (rule 22 single source). Figma URLs are partitioned off the
 *  generic URL signal — they do not double-count. */
export function deriveUrlSignals(text: string | undefined): {
  request_contains_url: boolean
  request_contains_figma_url: boolean
} {
  const raw = text ?? ""
  const hasFigma = FIGMA_URL_REGEX.test(raw)
  // Strip every figma URL before testing for any other URL so the generic
  // signal means "non-figma http(s) URL is present".
  const stripped = raw.replace(FIGMA_URL_GLOBAL_REGEX, "")
  const hasGeneric = HTTP_URL_REGEX.test(stripped)
  return {
    request_contains_url: hasGeneric,
    request_contains_figma_url: hasFigma,
  }
}

/** Result of resolving the skills for one stage invocation. Exposed so callers
 *  that need more than the prompt string (e.g. acceptance `required_tools`
 *  enforcement) can inspect the matched skill set. */
export interface ResolvedSkills {
  prompt: string
  skills: Skill.Info[]
  /** Union of `required_tools` across all matched skills — what the stage
   *  agent MUST have called (and passed) before reporting success. */
  requiredTools: string[]
}

/**
 * Load skills for a pipeline stage: explicit config + auto-detected.
 * @param explicitNames - skill names from orchestrator config
 * @param stage - active pipeline stage. Skill instruction visibility is no
 * longer gated by this value; it only selects the stage invariant and stage-owned
 * required_tools.
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

  // 2. Auto-detect skills matching the project / task signals. Stage no longer
  // gates instruction visibility: a candidate from another stage is still
  // useful context, but stage ownership still controls required_tools below.
  const candidates = all.filter((s) => s.auto_detect && !seen.has(s.name))
  for (const skill of candidates) {
    if (matchesProjectOrTask(skill.auto_detect!, taskSignals)) {
      seen.add(skill.name)
      loaded.push(skill)
      log.info("auto-detected skill", { name: skill.name, stage, skillStage: skill.stage })
    }
  }

  // Sort by priority (higher first), then by name for stability
  loaded.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name))

  const stageOwned = loaded.filter((s) => skillOwnsRequiredToolsInStage(s, stage))
  const requiredTools = Array.from(new Set(stageOwned.flatMap((s) => s.required_tools ?? [])))

  const invariant = stage ? STAGE_INVARIANTS[stage] : undefined
  const sections = loaded.map((s) => {
    const sourceStage = s.stage ?? "global"
    const stageNote = s.stage && stage && s.stage !== stage
      ? `Context-only in ${stage}: full instructions are injected for task guidance, but required_tools remain owned by ${s.stage}.`
      : s.stage && !stage
        ? "Context-only without an active stage: staged required_tools are not enforced."
        : `Required_tools owner: ${sourceStage}.`
    const required = (s.required_tools ?? []).length > 0 ? s.required_tools.join(", ") : "none"
    return [
      `## Skill: ${s.name}`,
      "",
      `Description: ${s.description}`,
      `Source stage: ${sourceStage}.`,
      stageNote,
      `Declared required_tools: ${required}`,
      "",
      s.content.trim(),
    ].join("\n")
  })

  const parts: string[] = []
  if (invariant) parts.push(invariant)
  if (sections.length > 0) {
    parts.push([
      "# Injected Skills",
      "",
      "The following skill bodies matched this task. Stage labels only decide required_tools ownership; they do not hide matched instructions.",
      "",
      sections.join("\n\n---\n\n"),
    ].join("\n"))
  }

  const prompt = parts.length > 0 ? "\n\n" + parts.join("\n\n") : ""
  return { prompt, skills: loaded, requiredTools }
}

function skillOwnsRequiredToolsInStage(skill: Skill.Info, stage: string | undefined): boolean {
  if (!skill.stage) return true
  return stage !== undefined && skill.stage === stage
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
  // task_signals semantics:
  //   - undefined field   → no constraint on that signal
  //   - true               → signal must be present (truthy)
  //   - false              → signal must be ABSENT (falsy / undefined)
  //   - request_text_any   → at least one case-insensitive literal substring
  //                          must appear in the task request text
  // All explicitly-declared signals must hold (AND across the block).
  // The prior implementation OR'd positives only and silently ignored `false`,
  // which made it impossible to express "image but not URL" — image-generate
  // and webpage-generate both fired on image-only requests, causing the build
  // agent to mix URL-flow steps (webpage_extract on a screenshot) into an
  // image task. Rule 1: `false` cannot be a no-op masquerading as a constraint.
  const wanted = detect.task_signals
  if (wanted && taskSignals) {
    const checks: boolean[] = []
    if (wanted.has_attachment_image !== undefined) {
      checks.push(wanted.has_attachment_image === Boolean(taskSignals.has_attachment_image))
    }
    if (wanted.request_contains_url !== undefined) {
      checks.push(wanted.request_contains_url === Boolean(taskSignals.request_contains_url))
    }
    if (wanted.request_contains_figma_url !== undefined) {
      checks.push(wanted.request_contains_figma_url === Boolean(taskSignals.request_contains_figma_url))
    }
    if (wanted.package_has_script && wanted.package_has_script.length > 0) {
      const pkg = tryReadPackageJson(dir)
      const scripts = (pkg?.scripts ?? {}) as Record<string, string>
      checks.push(wanted.package_has_script.some((s) => typeof scripts[s] === "string"))
    }
    if (wanted.request_text_any && wanted.request_text_any.length > 0) {
      const text = (taskSignals.request_text ?? "").toLocaleLowerCase()
      checks.push(wanted.request_text_any.some((needle) => text.includes(needle.toLocaleLowerCase())))
    }
    if (checks.length > 0 && checks.every(Boolean)) return true
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
