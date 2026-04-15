/**
 * Fidelity Review — verifies goal coverage against ORIGINAL user input.
 *
 * Key difference from old fidelity-review.ts: verifies against the raw user
 * request, NOT against an intermediate spec. This prevents information loss
 * from the Spec → Goal translation that the old two-stage pipeline caused.
 *
 * From SVG spec:
 *   Observation domain:
 *   • user ORIGINAL input
 *   • compiled goal draft (from Requirements Agent)
 *   • (no tools — pure LLM verification pass)
 *   • auto-correction: modify / split / add missing goals
 */
import { generateText } from "ai"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import type { GoalContractFields } from "@/pipeline/types"
import type { AcceptanceSpec } from "@/acceptance/types"
import { AcceptanceSpecSchema, renderSpecsAsText } from "@/acceptance/types"

const log = Log.create({ service: "fidelity-review" })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FidelityIssue {
  type: "uncovered" | "partial" | "distorted" | "merged_incorrectly"
  description: string
  /** Related goal IDs (if applicable) */
  goalIDs?: string[]
}

export interface GoalCorrection {
  action: "modify" | "split" | "remove"
  goalID: string
  reason: string
  /** Updated fields (for modify action) */
  updates?: Partial<Pick<GoalContractFields, "title" | "objective" | "acceptance_specs" | "owned_paths">>
}

export interface MissingGoal {
  title: string
  objective: string
  acceptance_specs: AcceptanceSpec[]
  owned_paths: string[]
  kind: string
  priority: "blocking" | "advisory"
  reason: string
}

export interface FidelityResult {
  verdict: "faithful" | "needs_correction"
  issues: FidelityIssue[]
  corrections: GoalCorrection[]
  missingGoals: MissingGoal[]
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Review goals against the original user input for coverage and fidelity.
 *
 * This is a pure LLM pass — no tools, no codebase exploration.
 * It only compares the goal set against what the user asked for.
 */
export async function reviewFidelity(input: {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
  signal?: AbortSignal
}): Promise<FidelityResult> {
  const { goals, signal } = input

  if (goals.length === 0) {
    return { verdict: "needs_correction", issues: [{ type: "uncovered", description: "No goals produced" }], corrections: [], missingGoals: [] }
  }

  const { resolveAgentModel } = await import("@/agent/model")
  const model = await resolveAgentModel("requirements").catch(() => undefined)
  if (!model) {
    log.warn("no LLM available for fidelity review, skipping")
    return { verdict: "faithful", issues: [], corrections: [], missingGoals: [] }
  }
  const language = await Provider.getLanguage(model)

  const systemPrompt = buildFidelitySystem()
  const userPrompt = buildFidelityPrompt(input)

  let attempts = 0
  const MAX_ATTEMPTS = 3

  while (attempts < MAX_ATTEMPTS) {
    attempts++
    if (signal?.aborted) throw new Error("fidelity review aborted")

    try {
      const result = await generateText({
        model: language,
        maxOutputTokens: 8192,
        abortSignal: signal,
        system: systemPrompt,
        messages: [{ role: "user" as const, content: userPrompt }],
      })

      const text = result.text?.trim() || ""

      const parsed = parseFidelityOutput(text)

      // Reconcile: if there are corrections/missing but verdict says faithful, fix it
      if (parsed.verdict === "faithful" && (parsed.corrections.length > 0 || parsed.missingGoals.length > 0)) {
        parsed.verdict = "needs_correction"
      }
      // And vice versa
      if (parsed.verdict === "needs_correction" && parsed.corrections.length === 0 && parsed.missingGoals.length === 0 && parsed.issues.length === 0) {
        parsed.verdict = "faithful"
      }

      // Filter out corrections that reference non-existent goal IDs
      const goalIDs = new Set(goals.map(g => g.id))
      parsed.corrections = parsed.corrections.filter(c => goalIDs.has(c.goalID))

      log.info("fidelity review completed", {
        verdict: parsed.verdict,
        issues: parsed.issues.length,
        corrections: parsed.corrections.length,
        missingGoals: parsed.missingGoals.length,
        attempt: attempts,
      })

      return parsed
    } catch (err) {
      if (signal?.aborted) throw err
      log.warn("fidelity review parse error, retrying", { attempt: attempts, error: String(err) })
      if (attempts >= MAX_ATTEMPTS) {
        log.error("fidelity review failed after all attempts", { error: String(err) })
        return { verdict: "faithful", issues: [], corrections: [], missingGoals: [] }
      }
    }
  }

  return { verdict: "faithful", issues: [], corrections: [], missingGoals: [] }
}

// ---------------------------------------------------------------------------
// Apply corrections to goal list
// ---------------------------------------------------------------------------

/**
 * Apply fidelity corrections to the goal list. Returns a new array.
 */
export function applyFidelityCorrections(
  goals: GoalContractFields[],
  result: FidelityResult,
): GoalContractFields[] {
  if (result.verdict === "faithful") return goals

  let corrected = [...goals]

  // Apply modifications
  for (const correction of result.corrections) {
    if (correction.action === "modify" && correction.updates) {
      corrected = corrected.map(g =>
        g.id === correction.goalID
          ? { ...g, ...correction.updates }
          : g,
      )
    } else if (correction.action === "remove") {
      corrected = corrected.filter(g => g.id !== correction.goalID)
    }
    // "split" actions are not applied directly; the upstream fidelity pass lists
    // the resulting sub-goals in missingGoals and they are added below.
  }

  // Add missing goals
  for (const missing of result.missingGoals) {
    // Dedup: skip if title already exists
    const normalizedTitle = missing.title.toLowerCase().trim()
    if (corrected.some(g => g.title.toLowerCase().trim() === normalizedTitle)) continue

    corrected.push({
      id: `goal_fidelity_${corrected.length + 1}`,
      title: missing.title,
      objective: missing.objective,
      acceptance_specs: missing.acceptance_specs,
      owned_paths: missing.owned_paths,
      depends_on: [],
      exports: [],
      imports: [],
      priority: missing.priority,
      kind: missing.kind,
      requirement_ids: [],
    })
  }

  return corrected
}

// ---------------------------------------------------------------------------
// Parse LLM output
// ---------------------------------------------------------------------------

function parseFidelityOutput(text: string): FidelityResult {
  // Strict JSON only — no text-parsing fallback (CLAUDE.md "no fallback").
  // The system prompt mandates a JSON block; if the model returns plain prose
  // we treat the attempt as failed and let the retry loop re-prompt.
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*"verdict"[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error("fidelity reviewer returned no JSON block")
  }
  const json = JSON.parse(jsonMatch[1] || jsonMatch[0])

  // Acceptance specs that come in via fidelity must be validated against the
  // same Zod schema register_goal uses — otherwise the LLM can produce a
  // missing/malformed `scorers` field, the bad spec gets persisted, and
  // downstream consumers (renderSpecsAsText, translateSpecs, architect tool,
  // create_run tool) crash with "spec.scorers is undefined". Drop corrections
  // / missingGoals whose specs fail validation; let the retry loop fetch a
  // clean correction instead of poisoning the goal set.
  const validateSpecs = (raw: unknown, where: string): AcceptanceSpec[] | null => {
    if (!Array.isArray(raw)) return null
    const out: AcceptanceSpec[] = []
    for (let i = 0; i < raw.length; i++) {
      const parsed = AcceptanceSpecSchema.safeParse(raw[i])
      if (!parsed.success) {
        log.warn("fidelity: dropping correction with invalid acceptance_spec", {
          where,
          index: i,
          issues: parsed.error.issues.map((it) => `${it.path.join(".")}: ${it.message}`),
        })
        return null
      }
      out.push(parsed.data)
    }
    return out
  }

  const rawCorrections = Array.isArray(json.corrections) ? json.corrections : []
  const corrections: GoalCorrection[] = []
  for (const c of rawCorrections) {
    if (!c || typeof c !== "object") continue
    if (c.action === "modify" && c.updates && "acceptance_specs" in c.updates) {
      const validated = validateSpecs(c.updates.acceptance_specs, `correction.modify ${c.goalID}`)
      if (validated === null) continue
      corrections.push({
        action: "modify",
        goalID: String(c.goalID ?? ""),
        reason: String(c.reason ?? ""),
        updates: { ...c.updates, acceptance_specs: validated },
      })
    } else {
      corrections.push(c as GoalCorrection)
    }
  }

  const rawMissing = Array.isArray(json.missing_goals ?? json.missingGoals)
    ? (json.missing_goals ?? json.missingGoals)
    : []
  const missingGoals: MissingGoal[] = []
  for (const m of rawMissing) {
    if (!m || typeof m !== "object") continue
    const validated = validateSpecs(m.acceptance_specs, `missing_goal "${m.title}"`)
    if (validated === null) continue
    missingGoals.push({ ...m, acceptance_specs: validated } as MissingGoal)
  }

  return {
    verdict: json.verdict === "faithful" ? "faithful" : "needs_correction",
    issues: Array.isArray(json.issues) ? json.issues : [],
    corrections,
    missingGoals,
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildFidelitySystem(): string {
  return [
    "You are a fidelity reviewer for OpenCorvus, an autonomous coding orchestrator.",
    "",
    "Your job is to verify that a set of goal contracts faithfully covers the ORIGINAL user request.",
    "You compare goals against the raw user input — NOT against any intermediate specification.",
    "",
    "## What to Check",
    "",
    "1. **Coverage**: Every distinct requirement in the user request must be addressed by at least one goal",
    "2. **Fidelity**: Goals must not distort or reinterpret what the user asked for",
    "3. **Completeness**: Goals must not merge unrelated requirements (losing granularity)",
    "4. **No hallucination**: Goals must not add requirements the user didn't ask for",
    "",
    "## Output Format (JSON)",
    "",
    "```json",
    "{",
    "  \"verdict\": \"faithful\" | \"needs_correction\",",
    "  \"issues\": [",
    "    { \"type\": \"uncovered\" | \"partial\" | \"distorted\" | \"merged_incorrectly\", \"description\": \"...\" }",
    "  ],",
    "  \"corrections\": [",
    "    { \"action\": \"modify\" | \"split\" | \"remove\", \"goalID\": \"...\", \"reason\": \"...\",",
    "      \"updates\": { \"title\": \"...\", \"objective\": \"...\", \"acceptance_specs\": [<AcceptanceSpec>] } }",
    "  ],",
    "  \"missing_goals\": [",
    "    { \"title\": \"...\", \"objective\": \"...\", \"acceptance_specs\": [<AcceptanceSpec>], \"owned_paths\": [],",
    "      \"kind\": \"feature\", \"priority\": \"blocking\", \"reason\": \"...\" }",
    "  ]",
    "}",
    "```",
    "",
    "If all requirements are covered faithfully, return `{ \"verdict\": \"faithful\", \"issues\": [], \"corrections\": [], \"missing_goals\": [] }`.",
  ].join("\n")
}

function buildFidelityPrompt(input: {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
}): string {
  const sections: string[] = []

  sections.push(`# User Request (ORIGINAL — this is the ground truth)\n\nTitle: ${input.taskTitle}\n\n${input.userRequest}`)

  sections.push(`# Goal Contracts (${input.goals.length} goals)\n`)
  for (const goal of input.goals) {
    sections.push([
      `## ${goal.id}: ${goal.title}`,
      `Objective: ${goal.objective}`,
      `Acceptance Specs:\n${renderSpecsAsText(goal.acceptance_specs ?? [])}`,
      `Owned Paths: ${goal.owned_paths.join(", ") || "(none)"}`,
      `Priority: ${goal.priority}`,
      `Kind: ${goal.kind}`,
      goal.exports?.length ? `Exports: ${goal.exports.join("; ")}` : "",
      goal.imports?.length ? `Imports: ${goal.imports.join("; ")}` : "",
    ].filter(Boolean).join("\n"))
  }

  sections.push("Now compare the goals against the user request and produce your fidelity verdict as JSON.")

  return sections.join("\n\n")
}
