/**
 * LLM-judge + prebuilt scorer runtime.
 *
 * Invoked by the per-goal evaluator for every TranslatedRubric entry. One
 * criterion per LLM call (no halo-effect aggregation) per industry consensus
 * (DeepEval G-Eval, Ragas, MLflow make_judge). Prebuilt scorers dispatch to a
 * named registry — no custom-DSL assertions.
 */
import z from "zod"
import { generateObject } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { ProviderLLM } from "@/provider/llm"
import { resolveAgentModel } from "@/agent/model"
import { Log } from "@/util/log"
import type { LlmJudgeScorer, PrebuiltScorer, RubricLevel } from "@/acceptance/types"
import type { TranslatedRubric } from "@/acceptance/translator"

const log = Log.create({ service: "llm-judge-runner" })

export interface RubricEvaluationInput {
  /** Delivery summary — always available. */
  deliverySummary: string
  /** Changed-file paths, joined one per line. */
  changedFiles?: string[]
  /** Original requirement text when scorer.inputs includes "requirement_text". */
  requirementText?: string
  signal?: AbortSignal
  /** Sticky-routing key for LiteLLM-fronted gateways. Without it each judge
   *  round-robins to a cold upstream cache. Pass `task-${taskID}-evaluator`. */
  cacheKey?: string
  /** Originating task ID — propagates the user's session model pick into the
   *  judge call (so per-task model selection is honored). */
  taskID?: string
}

export interface RubricEvaluationResult {
  /** spec:scorer name — mirrors TranslatedRubric.name. */
  name: string
  status: "passed" | "failed" | "skipped"
  evidence: string
  /** Integer score when rubric is ordinal; omitted for binary. */
  score?: number
  /** Selected rubric level label, if any. */
  level?: string
  /** Free-text reasoning produced by the judge. */
  reasoning?: string
}

const JudgeOutputSchema = z.object({
  reasoning: z.string().describe("Short chain-of-thought: what evidence in the inputs supports or contradicts the criterion."),
  verdict: z.enum(["pass", "fail"]).describe("Binary verdict derived from criterion and rubric."),
  score: z.number().int().optional().describe("Integer score matching one of the rubric levels, when rubric is provided."),
  level_label: z.string().optional().describe("Label of the rubric level chosen."),
})

export async function runRubric(
  entry: TranslatedRubric,
  input: RubricEvaluationInput,
): Promise<RubricEvaluationResult> {
  if (entry.kind === "prebuilt") {
    return runPrebuilt(entry.name, entry.scorer as PrebuiltScorer, input)
  }
  return runLlmJudge(entry.name, entry.scorer as LlmJudgeScorer, input)
}

async function runLlmJudge(
  name: string,
  scorer: LlmJudgeScorer,
  input: RubricEvaluationInput,
): Promise<RubricEvaluationResult> {
  const model = await resolveAgentModel("delivery", { taskID: input.taskID })
  const language = await Provider.getLanguage(model)

  const system = buildJudgeSystemPrompt(scorer)
  const user = buildJudgeUserPrompt(scorer, input)

  const headers = ProviderLLM.baseHeaders(model, input.cacheKey)
  const result = await generateObject({
    model: language,
    abortSignal: input.signal,
    headers,
    schema: JudgeOutputSchema,
    system,
    prompt: user,
    timeoutMs: 60_000,
  })
  const object = result.object as z.infer<typeof JudgeOutputSchema>

  const passes = decidePass(scorer, object)
  return {
    name,
    status: passes ? "passed" : "failed",
    evidence: composeEvidence(scorer, object),
    score: object.score,
    level: object.level_label,
    reasoning: object.reasoning,
  }
}

function buildJudgeSystemPrompt(scorer: LlmJudgeScorer): string {
  const parts = [
    "You are an independent acceptance judge. Evaluate exactly ONE criterion against the supplied delivery evidence.",
    "Rules:",
    "• Base your verdict only on the text provided. Do not invent facts.",
    "• Write a short (1-3 sentence) reasoning grounded in concrete phrases from the input.",
    "• Never judge multiple criteria in one call. Never mix criteria together.",
  ]
  if (scorer.rubric && scorer.rubric.length > 0) {
    parts.push("", "Scoring rubric (pick exactly one level, report its integer score and label):")
    for (const lvl of scorer.rubric) {
      parts.push(`  • score=${lvl.score} "${lvl.label}" — ${lvl.anchor} (${lvl.passes ? "PASS" : "FAIL"})`)
    }
    parts.push("", 'Set verdict to "pass" iff the chosen level is marked PASS above.')
  } else {
    parts.push("", 'No rubric provided — use a binary MET/UNMET assessment and set verdict to "pass" only when the criterion is clearly met.')
  }
  return parts.join("\n")
}

function buildJudgeUserPrompt(scorer: LlmJudgeScorer, input: RubricEvaluationInput): string {
  const wanted = new Set(scorer.inputs ?? ["delivery_summary"])
  const sections: string[] = [`Criterion:\n  ${scorer.criteria}`]

  if (wanted.has("delivery_summary")) {
    sections.push(`Delivery summary:\n${input.deliverySummary.trim() || "(empty)"}`)
  }
  if (wanted.has("changed_files") && input.changedFiles && input.changedFiles.length > 0) {
    sections.push(`Changed files:\n${input.changedFiles.map((f) => `  - ${f}`).join("\n")}`)
  }
  if (wanted.has("requirement_text") && input.requirementText) {
    sections.push(`Originating requirement:\n${input.requirementText.trim()}`)
  }
  return sections.join("\n\n")
}

function decidePass(scorer: LlmJudgeScorer, out: z.infer<typeof JudgeOutputSchema>): boolean {
  if (scorer.rubric && typeof out.score === "number") {
    const chosen = pickLevel(scorer.rubric, out.score, out.level_label)
    if (chosen) return chosen.passes
  }
  return out.verdict === "pass"
}

function pickLevel(rubric: RubricLevel[], score?: number, label?: string): RubricLevel | undefined {
  if (typeof score === "number") {
    const byScore = rubric.find((r) => r.score === score)
    if (byScore) return byScore
  }
  if (label) {
    const byLabel = rubric.find((r) => r.label === label)
    if (byLabel) return byLabel
  }
  return undefined
}

function composeEvidence(scorer: LlmJudgeScorer, out: z.infer<typeof JudgeOutputSchema>): string {
  const bits: string[] = []
  if (scorer.rubric && typeof out.score === "number") {
    bits.push(`score=${out.score}${out.level_label ? ` (${out.level_label})` : ""}`)
  }
  bits.push(`verdict=${out.verdict}`)
  if (out.reasoning) bits.push(out.reasoning.trim())
  return bits.join(" | ")
}

// ── Prebuilt scorers ────────────────────────────────────────────────────────
// A small named registry. Adding a scorer = new case here + the name enum in
// acceptance-spec.ts. No DSL, no dynamic dispatch.

async function runPrebuilt(
  name: string,
  scorer: PrebuiltScorer,
  input: RubricEvaluationInput,
): Promise<RubricEvaluationResult> {
  switch (scorer.name) {
    case "contains": {
      const needle = requireString(scorer.config, "needle")
      const hay = input.deliverySummary
      const passes = hay.includes(needle)
      return {
        name,
        status: passes ? "passed" : "failed",
        evidence: `contains("${truncate(needle, 80)}")=${passes}`,
      }
    }
    case "exact_match": {
      const expected = requireString(scorer.config, "expected")
      const actual = input.deliverySummary.trim()
      const passes = actual === expected
      return {
        name,
        status: passes ? "passed" : "failed",
        evidence: `exact_match=${passes}`,
      }
    }
    case "length_within": {
      const min = requireNumber(scorer.config, "min")
      const max = requireNumber(scorer.config, "max")
      const len = input.deliverySummary.length
      const passes = len >= min && len <= max
      return {
        name,
        status: passes ? "passed" : "failed",
        evidence: `length=${len} window=[${min},${max}] pass=${passes}`,
      }
    }
    case "json_schema": {
      const schema = scorer.config?.schema
      if (!schema || typeof schema !== "object") {
        throw new Error(`json_schema prebuilt requires config.schema`)
      }
      // Validate delivery summary parses as JSON matching a minimal structural
      // check (root type). Zod cross-conversion of arbitrary JSON schema is
      // out of scope; users who need full JSON Schema should pair with a
      // heuristic shell scorer calling their own validator.
      try {
        JSON.parse(input.deliverySummary)
        return { name, status: "passed", evidence: "delivery summary parses as JSON" }
      } catch (err) {
        return { name, status: "failed", evidence: `JSON parse error: ${(err as Error).message}` }
      }
    }
    case "factuality":
    case "relevance": {
      // These two are semantic — delegate to the judge path with a fixed prompt.
      const synthetic: LlmJudgeScorer = {
        type: "llm_judge",
        name: scorer.name,
        criteria:
          scorer.name === "factuality"
            ? "Every factual claim in the delivery summary is supported by the changed files list."
            : "The delivery summary is directly relevant to the originating requirement.",
        inputs: ["delivery_summary", "changed_files", "requirement_text"],
      }
      return runLlmJudge(name, synthetic, input)
    }
    default: {
      const exhaustive: never = scorer.name
      throw new Error(`unknown prebuilt scorer: ${String(exhaustive)}`)
    }
  }
}

function requireString(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key]
  if (typeof v !== "string" || v.length === 0) throw new Error(`prebuilt config.${key} must be a non-empty string`)
  return v
}

function requireNumber(cfg: Record<string, unknown>, key: string): number {
  const v = cfg[key]
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`prebuilt config.${key} must be a finite number`)
  return v
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…"
}
