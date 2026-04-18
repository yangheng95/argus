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
import { ProviderLLM } from "@/provider/llm"
import { Log } from "@/util/log"
import { resolveAgentModel } from "@/agent/model"
import { EngineProtocol } from "@/engine/protocol"
import { Event as EngineEvent } from "@/engine/model"
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
  /** Task ID for cache stickiness — same key requirements used keeps hexin
   *  on the same upstream pool, so prompt cache hits across stages. Also
   *  used as the aggregate for the FidelityReviewCompleted event so the
   *  overlay can render a native verdict card. */
  taskID?: string
  /** Requirements agent session ID — forwarded into FidelityReviewCompleted
   *  so the overlay can nest the verdict card under the requirements session
   *  card instead of surfacing it as a top-level escapee. */
  sessionID?: string
}): Promise<FidelityResult> {
  const { goals, signal } = input

  if (goals.length === 0) {
    const result: FidelityResult = {
      verdict: "needs_correction",
      issues: [{ type: "uncovered", description: "No goals produced" }],
      corrections: [],
      missingGoals: [],
    }
    emitFidelityEvent(input.taskID, input.sessionID, result, 0)
    return result
  }

  const model = await resolveAgentModel("requirements", { taskID: input.taskID }).catch(() => undefined)
  if (!model) {
    log.warn("no LLM available for fidelity review, skipping")
    const result: FidelityResult = { verdict: "faithful", issues: [], corrections: [], missingGoals: [] }
    emitFidelityEvent(input.taskID, input.sessionID, result, 0)
    return result
  }

  const systemPrompt = buildFidelitySystem()
  const userPrompt = buildFidelityPrompt(input)

  // Conversation state: each retry appends the validation feedback from the
  // previous attempt as a user message so the LLM sees exactly which entries
  // it malformed and what to fix. Bounded by MAX_ATTEMPTS to prevent an
  // unrecoverable model from looping forever (loud-fail is preferable to
  // silent corruption per CLAUDE.md "no fallback").
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: userPrompt },
  ]
  let attempts = 0
  const MAX_ATTEMPTS = 3
  let lastParseError: unknown = undefined
  let lastResult: FidelityResult | undefined

  while (attempts < MAX_ATTEMPTS) {
    attempts++
    if (signal?.aborted) throw new Error("fidelity review aborted")

    try {
      // ProviderLLM.stream is the ONLY sanctioned LLM entry point — direct
      // generateText/streamText bypass auth headers (hexin sticky x-user),
      // providerOptions, maxOutputTokens normalization, and tracing. That
      // bypass produced a recurring HTTP 401 here when fidelity reviewed
      // hexin-routed sonnet-4-6 because the gateway's per-key sticky
      // routing rejected requests without `x-user`.
      //
      // Intentionally no onChunk/onError hooks — the fidelity LLM's raw
      // output is a JSON contract (verdict + issues + corrections). Piping
      // those tokens into the requirements agent card surfaced the JSON
      // source as a reasoning block to the operator. Replaced by the
      // FidelityReviewCompleted event emitted after parse, which the
      // overlay renders as a structured verdict card.
      const llmResult = await ProviderLLM.stream({
        model,
        system: systemPrompt,
        messages,
        maxOutputTokens: 8192,
        abortSignal: signal,
        cacheKey: input.taskID,
      })
      const text = (await llmResult.text)?.trim() || ""
      const { result: parsed, validationFeedback } = parseFidelityOutput(text)

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

      lastResult = parsed

      log.info("fidelity review attempt completed", {
        verdict: parsed.verdict,
        issues: parsed.issues.length,
        corrections: parsed.corrections.length,
        missingGoals: parsed.missingGoals.length,
        validationDrops: validationFeedback.length,
        attempt: attempts,
      })

      // If every spec validated, return immediately. Otherwise: append
      // assistant turn + a structured user follow-up that names every
      // dropped entry so the next attempt can repair the malformed specs.
      if (validationFeedback.length === 0) {
        emitFidelityEvent(input.taskID, input.sessionID, parsed, attempts)
        return parsed
      }

      if (attempts >= MAX_ATTEMPTS) {
        log.error("fidelity review: validation drops persisted across all attempts", {
          attempts,
          drops: validationFeedback.length,
          firstFew: validationFeedback.slice(0, 5),
        })
        // Loud return: keep validated entries, but verdict reflects that the
        // reviewer could not produce a fully-valid correction set. Operator
        // sees "needs_correction" + log lists exactly what failed.
        const coerced: FidelityResult = { ...parsed, verdict: "needs_correction" }
        emitFidelityEvent(input.taskID, input.sessionID, coerced, attempts)
        return coerced
      }

      messages.push({ role: "assistant", content: text })
      messages.push({
        role: "user",
        content: [
          "Your previous output was almost right, but the following entries were DROPPED because their `acceptance_specs` did not match the required schema. Re-emit the FULL JSON output (verdict + issues + corrections + missing_goals) with these entries fixed:",
          "",
          ...validationFeedback.map((f, i) => `${i + 1}. ${f}`),
          "",
          "Re-read the AcceptanceSpec shape in the system prompt. Every spec MUST include `id`, `source_requirement_id`, `goal_id`, `title`, `severity`, and a non-empty `scorers` array. Default to one heuristic shell scorer per spec. Do not omit any required field.",
        ].join("\n"),
      })
    } catch (err) {
      if (signal?.aborted) throw err
      lastParseError = err
      log.warn("fidelity review parse error, retrying", { attempt: attempts, error: String(err) })
      if (attempts >= MAX_ATTEMPTS) {
        log.error("fidelity review failed after all attempts", { error: String(err) })
        // Loud-fail: surface the parse error rather than silently claiming
        // "faithful". The caller (requirements agent) can decide whether to
        // proceed on the un-reviewed goal set or surface a task error.
        throw new Error(
          `fidelity review unrecoverable after ${MAX_ATTEMPTS} attempts: ${String(err)}`,
        )
      }
      // Append the error as feedback so the next attempt knows to re-emit JSON
      messages.push({
        role: "user",
        content: `Your previous output could not be parsed: ${String(err)}. Emit a single fenced \`\`\`json block as specified in the system prompt and nothing else outside it.`,
      })
    }
  }

  // Loop exited without returning — should be unreachable because every
  // branch above either returns or throws. Guard anyway.
  if (lastResult) {
    emitFidelityEvent(input.taskID, input.sessionID, lastResult, attempts)
    return lastResult
  }
  throw new Error(`fidelity review exhausted retries: ${String(lastParseError ?? "unknown error")}`)
}

/** Broadcast the parsed fidelity verdict so the overlay can render a native
 *  verdict card (badge + issues list + corrections diff). Taking the place
 *  of the previous raw-JSON stream that piped the LLM's JSON tokens into a
 *  reasoning block on the requirements agent card. Silently skips when the
 *  caller did not provide a taskID (e.g. CLI dry-runs) — EngineProtocol.emit
 *  requires a taskID to persist to protocol_event. */
function emitFidelityEvent(
  taskID: string | undefined,
  sessionID: string | undefined,
  result: FidelityResult,
  attempts: number,
): void {
  if (!taskID) return
  if (!sessionID) {
    // sessionID is required for the overlay to attach the verdict card under
    // the requirements session. A missing value would otherwise force the
    // overlay to either escape the card to the top level or silently drop
    // it — both violate project rule 1. Loud-fail here at the source.
    throw new Error(
      `fidelity.review.completed: sessionID required but missing (taskID=${taskID}). ` +
        `Requirements agent must thread its sessionID through RequirementsService.run → reviewFidelity.`,
    )
  }
  const payload = {
    taskID,
    sessionID,
    verdict: result.verdict,
    issues: result.issues.map((i) => ({ type: i.type, description: i.description })),
    corrections: result.corrections.map((c) => ({
      action: c.action,
      goalID: c.goalID,
      reason: c.reason,
      updatesTitle: c.updates?.title,
      updatesObjective: c.updates?.objective,
    })),
    missingGoals: result.missingGoals.map((g) => ({
      title: g.title,
      objective: g.objective,
      reason: g.reason,
    })),
    attempts,
  }
  void EngineProtocol.emit(EngineEvent.FidelityReviewCompleted, payload, { source: "requirements.fidelity" })
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

/** Output of one fidelity-output parse pass. Carries:
 *  - `result`: what survived schema validation
 *  - `validationFeedback`: human-readable per-drop messages, fed back to the
 *    LLM on the next attempt so it can correct the malformed entries.
 *    Empty when nothing was dropped. */
interface ParsedFidelityOutput {
  result: FidelityResult
  validationFeedback: string[]
}

function parseFidelityOutput(text: string): ParsedFidelityOutput {
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
  // create_run tool) crash with "spec.scorers is undefined". Drops are
  // reported via `validationFeedback` so the retry loop can re-prompt the
  // model with the validation errors — silent drop would be a fallback.
  const validationFeedback: string[] = []
  const validateSpecs = (raw: unknown, where: string): AcceptanceSpec[] | null => {
    if (!Array.isArray(raw)) {
      validationFeedback.push(
        `${where}: \`acceptance_specs\` must be a non-empty array of AcceptanceSpec objects (received ${raw === undefined ? "undefined" : typeof raw}).`,
      )
      return null
    }
    const out: AcceptanceSpec[] = []
    for (let i = 0; i < raw.length; i++) {
      const parsed = AcceptanceSpecSchema.safeParse(raw[i])
      if (!parsed.success) {
        const issues = parsed.error.issues.map((it) => `${it.path.join(".")}: ${it.message}`).join("; ")
        log.warn("fidelity: dropping entry with invalid acceptance_spec", {
          where,
          index: i,
          issues: parsed.error.issues.map((it) => `${it.path.join(".")}: ${it.message}`),
        })
        validationFeedback.push(`${where}.acceptance_specs[${i}]: ${issues}`)
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

  const result: FidelityResult = {
    verdict: json.verdict === "faithful" ? "faithful" : "needs_correction",
    issues: Array.isArray(json.issues) ? json.issues : [],
    corrections,
    missingGoals,
  }
  return { result, validationFeedback }
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
    "## AcceptanceSpec — REQUIRED shape for every spec you emit",
    "",
    "Every entry in `acceptance_specs` (whether inside `corrections.updates` or",
    "`missing_goals`) MUST have ALL these fields. Specs missing any required field",
    "are dropped — your correction is wasted.",
    "",
    "```json",
    "{",
    "  \"id\": \"acc-<short-slug>\",",
    "  \"source_requirement_id\": \"REQ-N\",         // REQ id this spec derives from",
    "  \"goal_id\": \"<owning goal id>\",            // for corrections: the goal being modified; for missing_goals: re-state your proposed goal id",
    "  \"title\": \"Short, executable acceptance statement\",",
    "  \"severity\": \"essential\",                   // essential | important | optional | pitfall",
    "  \"scorers\": [",
    "    { \"type\": \"heuristic\", \"name\": \"build\",",
    "      \"spec\": { \"kind\": \"shell\", \"cmd\": \"bun run build\" },",
    "      \"expect\": { \"exit_code\": 0 } }",
    "  ]",
    "}",
    "```",
    "",
    "Default to ONE heuristic scorer per spec. Only add `scenario` (Gherkin),",
    "`llm_judge` scorers, or multi-level `rubric` when the heuristic genuinely",
    "cannot verify the requirement. Every field listed above is REQUIRED — do",
    "NOT omit `id`, `source_requirement_id`, `goal_id`, `title`, `severity`,",
    "or `scorers` (array with at least one entry).",
    "",
    "For `missing_goals`, the proposed goal also needs `owned_paths` (at least one",
    "concrete file path discovered from the user request — not a guess), `kind`",
    "(`bootstrap` | `feature` | `verification` | `integration` | `system`), and",
    "`priority` (`blocking` | `advisory`).",
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
    "    { \"title\": \"...\", \"objective\": \"...\", \"acceptance_specs\": [<AcceptanceSpec>], \"owned_paths\": [\"...\"],",
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
