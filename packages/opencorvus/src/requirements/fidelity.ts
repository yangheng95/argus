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

  // Liveness: fidelity makes a non-streaming LLM call that can run 60–180s.
  // Without a visible marker + periodic progress tick the SSE stream goes
  // silent long enough to trip the benchmark alive-stall (cap 120s) and
  // the operator has no signal that the review is in flight. The Started
  // event + Progress tick below are the ONLY source of liveness during
  // this window; they are not rendered by the overlay (see event-policy
  // noop list) and carry no LLM output.
  emitFidelityLifecycle("started", input.taskID, input.sessionID, 0, 0)
  const startedAt = Date.now()
  let currentAttempt = 0
  const progressTicker =
    input.taskID && input.sessionID
      ? setInterval(() => {
          emitFidelityLifecycle(
            "progress",
            input.taskID,
            input.sessionID,
            currentAttempt,
            Date.now() - startedAt,
          )
        }, 20_000)
      : null

  try {
    return await reviewFidelityInner(input, (attempt) => {
      currentAttempt = attempt
    })
  } finally {
    if (progressTicker) clearInterval(progressTicker)
  }
}

async function reviewFidelityInner(
  input: Parameters<typeof reviewFidelity>[0],
  recordAttempt: (attempt: number) => void,
): Promise<FidelityResult> {
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

  // Throttled chunk forwarding: onChunk fires per token; a 500ms flush
  // window amortises that into ~2 events/sec, which keeps protocol_event
  // row counts sane (≤ ~360 rows per 180s review) without visibly lagging
  // the overlay's reasoning panel. One flusher shared across attempts; the
  // attempt counter travels with every emit so the overlay opens a fresh
  // reasoning part when the retry loop rolls over.
  const chunkFlush = createChunkFlusher({
    taskID: input.taskID,
    sessionID: input.sessionID,
    intervalMs: 500,
  })

  try {
  while (attempts < MAX_ATTEMPTS) {
    attempts++
    recordAttempt(attempts)
    if (signal?.aborted) throw new Error("fidelity review aborted")

    try {
      // ProviderLLM.stream is the ONLY sanctioned LLM entry point — direct
      // generateText/streamText bypass auth headers (hexin sticky x-user),
      // providerOptions, maxOutputTokens normalization, and tracing. That
      // bypass produced a recurring HTTP 401 here when fidelity reviewed
      // hexin-routed sonnet-4-6 because the gateway's per-key sticky
      // routing rejected requests without `x-user`.
      //
      // onChunk forwards text-delta tokens into a reasoning part on the
      // fidelity card itself (not the requirements agent card). Attaching
      // to the agent card is what originally poisoned the UX — schema
      // tokens surfaced as "reasoning" on an unrelated session. The
      // fidelity card is already a separate card, so the noise stays
      // scoped. Post-parse the structured FidelityReviewCompleted event
      // still owns the verdict render (see FidelityBody); the reasoning
      // stream is purely observational.
      const llmResult = await ProviderLLM.stream({
        model,
        system: systemPrompt,
        messages,
        maxOutputTokens: 8192,
        abortSignal: signal,
        cacheKey: input.taskID,
        onChunk: async ({ chunk }: { chunk: any }) => {
          // Forward both text-delta (the final JSON) AND reasoning-delta
          // (the model's intermediate thinking). A reasoning-heavy provider
          // (qwq, deepseek-r1, o1) can spend 2–3 minutes emitting ONLY
          // reasoning-delta tokens before a single text-delta lands; if we
          // filter to text-delta the card reads as "hung 3 min then dumps
          // JSON in one burst" even though the stream is live the whole
          // time. Both kinds feed the same reasoning part — the overlay
          // renders them as one collapsible "思考过程" block, which is
          // exactly what the operator needs for liveness.
          const type = chunk?.type
          if (type !== "text-delta" && type !== "reasoning-delta") return
          const delta = typeof chunk.text === "string"
            ? chunk.text
            : typeof chunk.delta === "string"
              ? chunk.delta
              : ""
          if (!delta) return
          chunkFlush.append(attempts, delta)
        },
      })
      const text = (await llmResult.text)?.trim() || ""
      // Flush any residual tokens before moving on — the throttle timer may
      // have been armed when the stream ended; without an explicit flush the
      // last 0–500ms of text would never reach the overlay.
      await chunkFlush.flushAttempt(attempts)
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
  } finally {
    // Cancels the throttle timer and drops any tokens still buffered. We do
    // NOT await a final flush here: on the success path the per-attempt
    // flushAttempt() already drained the buffer; on the failure path the
    // partial delta has no caller willing to read it (the task errors out).
    chunkFlush.dispose()
  }
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

/** Throttled buffer that forwards fidelity text-delta tokens into the
 *  FidelityReviewChunk event stream. Created once per reviewFidelity call
 *  and reused across retry attempts — the `attempt` passed into append()
 *  lets the overlay open a fresh reasoning part each time the loop rolls.
 *
 *  Flush rules:
 *    • First token in an idle window → schedule a flush at +intervalMs
 *    • Subsequent tokens within the window → append to buffer, no new timer
 *    • flushAttempt() is called by the producer after `await llmResult.text`
 *      to drain any residual tokens before the next attempt begins
 *    • dispose() clears the timer and drops the buffer (failure path)
 *
 *  Emits nothing when taskID/sessionID are missing (CLI dry-runs). */
interface FidelityChunkFlusher {
  append(attempt: number, delta: string): void
  flushAttempt(attempt: number): Promise<void>
  dispose(): void
}

function createChunkFlusher(opts: {
  taskID: string | undefined
  sessionID: string | undefined
  intervalMs: number
}): FidelityChunkFlusher {
  const inactive: FidelityChunkFlusher = {
    append: () => {},
    flushAttempt: async () => {},
    dispose: () => {},
  }
  if (!opts.taskID || !opts.sessionID) return inactive

  let buffer = ""
  let pendingAttempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const emit = async (attempt: number, delta: string): Promise<void> => {
    if (!delta) return
    try {
      await EngineProtocol.emit(
        EngineEvent.FidelityReviewChunk,
        { taskID: opts.taskID!, sessionID: opts.sessionID!, attempt, textDelta: delta },
        { source: "requirements.fidelity" },
      )
    } catch (err) {
      log.error("fidelity chunk emit failed", {
        taskID: opts.taskID,
        sessionID: opts.sessionID,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const flushNow = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (buffer.length === 0) return
    const attempt = pendingAttempt
    const delta = buffer
    buffer = ""
    await emit(attempt, delta)
  }

  return {
    append(attempt: number, delta: string): void {
      // Attempt boundary: if the producer advanced to the next attempt while
      // tokens from a prior attempt still sit in the buffer, ship those tokens
      // under their original attempt number before starting the new group.
      if (buffer.length > 0 && attempt !== pendingAttempt) {
        const prevAttempt = pendingAttempt
        const prevDelta = buffer
        buffer = ""
        void emit(prevAttempt, prevDelta)
      }
      pendingAttempt = attempt
      buffer += delta
      if (!timer) {
        timer = setTimeout(() => {
          timer = null
          void flushNow()
        }, opts.intervalMs)
      }
    },
    async flushAttempt(_attempt: number): Promise<void> {
      await flushNow()
    },
    dispose(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      buffer = ""
    },
  }
}

/** Emit fidelity review lifecycle events — Started and Progress — while the
 *  LLM call is in flight. Started fires once before the first attempt; Progress
 *  fires every 20s while we wait. Both advance the benchmark alive-stall
 *  detector and feed the overlay's running-fidelity card header (tree-writer's
 *  handleFidelityStarted / handleFidelityProgress own the card lifecycle).
 *  Silently skips when taskID or sessionID is missing — CLI dry-runs don't
 *  need liveness events. */
function emitFidelityLifecycle(
  phase: "started" | "progress",
  taskID: string | undefined,
  sessionID: string | undefined,
  attempt: number,
  elapsedMs: number,
): void {
  if (!taskID || !sessionID) {
    log.warn("fidelity lifecycle event skipped — missing taskID/sessionID", {
      phase,
      hasTaskID: !!taskID,
      hasSessionID: !!sessionID,
    })
    return
  }
  const def = phase === "started" ? EngineEvent.FidelityReviewStarted : EngineEvent.FidelityReviewProgress
  const properties =
    phase === "started"
      ? { taskID, sessionID }
      : { taskID, sessionID, attempt, elapsedMs }
  log.info("fidelity lifecycle emit", { phase, taskID, sessionID, attempt, elapsedMs })
  EngineProtocol.emit(def as any, properties as any, { source: "requirements.fidelity" }).catch(
    (err) => {
      log.error("fidelity lifecycle emit failed", {
        phase,
        taskID,
        sessionID,
        error: err instanceof Error ? err.message : String(err),
      })
    },
  )
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
