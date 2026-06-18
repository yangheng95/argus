/**
 * AcceptanceSpec — typed, rubric-first representation of a goal's acceptance
 * criteria. Emitted by the Requirements Agent via `register_acceptance_spec`,
 * translated to executable checks + rubric evaluations by
 * `src/spec/translator.ts`, and executed by the per-goal evaluator.
 *
 * Shape follows cross-framework convergence from Inspect AI, Braintrust
 * autoevals, MLflow make_judge, Ragas rubric metrics, DeepEval G-Eval, and
 * AutoUAT. Three scorer families — heuristic / llm_judge / prebuilt — cover
 * every case without inventing a new DSL.
 */
import z from "zod"

export const AcceptanceSeverity = z.enum(["essential", "important", "optional", "pitfall"])
export const AcceptanceTrigger = z.enum(["on_goal", "on_integrity"])
export const LlmJudgeInputKind = z.enum(["acceptance_summary", "changed_files", "requirement_text", "visual_evidence"])

const GherkinScenarioSchema = z
  .object({
    given: z.array(z.string().min(1)).min(1),
    when: z.array(z.string().min(1)).min(1),
    then: z.array(z.string().min(1)).min(1),
  })
  .describe("Gherkin Given/When/Then scenario. Optional — omit for pure code checks.")

export const RubricLevelSchema = z.object({
  score: z.number().int().min(0).describe("Integer score for this level."),
  label: z.string().min(1).describe("Short level label, e.g. 'fully met'."),
  anchor: z.string().min(1).describe("Behavioral description: what earns this score."),
  passes: z.boolean().describe("Does this level count as pass for binary verdict?"),
})

const HeuristicScorerSchema = z.object({
  type: z
    .literal("heuristic")
    .describe("heuristic — deterministic shell/script check, pass/fail by exit code. Requires: name, spec{kind}."),
  name: z.string().min(1),
  spec: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("shell").describe("shell — run an inline command. Requires: cmd; optional cwd."),
      cmd: z.string().min(1).describe("Shell command. Exit 0 = pass unless expect.exit_code set."),
      cwd: z.string().optional(),
    }),
    z.object({
      kind: z
        .literal("script_ref")
        .describe(
          "script_ref — run an existing repo script. Requires: path; optional args. Not for contract_audit; contract_audit is its own scorer type.",
        ),
      path: z.string().min(1).describe("Repo-relative script path that already exists at registration time."),
      args: z.array(z.string()).optional(),
    }),
  ]),
  expect: z
    .object({
      exit_code: z.number().int().optional(),
    })
    .optional(),
})

const LlmJudgeScorerSchema = z.object({
  type: z
    .literal("llm_judge")
    .describe("llm_judge — natural-language rubric evaluation. Requires: name, criteria; optional rubric, inputs."),
  name: z.string().min(1),
  criteria: z.string().min(10).describe("Single-criterion evaluation question in natural language."),
  rubric: z
    .array(RubricLevelSchema)
    .min(2)
    .max(5)
    .optional()
    .describe("Ordinal anchors, 2-5 levels. Omit for binary MET/UNMET."),
  inputs: z
    .array(LlmJudgeInputKind)
    .optional()
    .describe("Which parts of the acceptance to feed the judge. Default: acceptance_summary."),
})

const PREBUILT_SCORER_NAMES = [
  "factuality",
  "relevance",
  "contains",
  "exact_match",
  "length_within",
  "json_schema",
  "visual-evidence-bundle",
] as const

const PrebuiltScorerSchema = z.object({
  type: z
    .literal("prebuilt")
    .describe(
      "prebuilt — a named library metric. Requires: name from the fixed PREBUILT_SCORER_NAMES set; optional config.",
    ),
  name: z.enum(PREBUILT_SCORER_NAMES),
  config: z.record(z.string(), z.unknown()).default({}),
  spec: z
    .object({
      kind: z.literal("visual_evidence_bundle"),
      viewport: z.string().min(1).optional(),
    })
    .optional()
    .describe("For name=visual-evidence-bundle, identifies the required visual evidence bundle shape."),
  expect: z
    .object({
      status: z.literal("passed"),
    })
    .optional()
    .describe("For name=visual-evidence-bundle, requires a passing current bundle."),
})

const ContractAuditScorerSchema = z.object({
  type: z
    .literal("contract_audit")
    .describe(
      "contract_audit — static audit of typed-contract field literals against registered graph contract_ids. This is a scorer type, not a script_ref path. Requires: name, spec.contract_ids, expect.status='passed'.",
    ),
  name: z.string().min(1),
  spec: z.object({
    kind: z.literal("contract_graph"),
    contract_ids: z.array(z.string().min(1)).min(1),
  }),
  expect: z.object({
    status: z.literal("passed"),
  }),
})

export const ScorerSchema = z.discriminatedUnion("type", [
  HeuristicScorerSchema,
  LlmJudgeScorerSchema,
  PrebuiltScorerSchema,
  ContractAuditScorerSchema,
])

export const AcceptanceSpecSchema = z.object({
  id: z.string().min(1).describe("Stable spec ID, e.g. 'acc-login-3s'."),
  source_requirement_id: z.string().min(1).describe("Requirement ID this spec was derived from (REQ-N)."),
  goal_id: z
    .string()
    .min(1)
    .describe("Goal ID this spec belongs to. Specs are goal-local; multiple specs may share a goal."),
  title: z.string().min(1),
  scenario: GherkinScenarioSchema.optional(),
  scorers: z.array(ScorerSchema).min(1).describe("At least one scorer — a spec without a scorer is untestable."),
  severity: AcceptanceSeverity,
  trigger: AcceptanceTrigger.optional().describe(
    "Override default trigger. Defaults: heuristic/prebuilt=on_goal; llm_judge essential=on_goal; other=on_integrity.",
  ),
})

export type AcceptanceSpec = z.infer<typeof AcceptanceSpecSchema>
export type AcceptanceScorer = z.infer<typeof ScorerSchema>
export type HeuristicScorer = Extract<AcceptanceScorer, { type: "heuristic" }>
export type LlmJudgeScorer = Extract<AcceptanceScorer, { type: "llm_judge" }>
export type PrebuiltScorer = Extract<AcceptanceScorer, { type: "prebuilt" }>
export type ContractAuditScorer = Extract<AcceptanceScorer, { type: "contract_audit" }>
export type RubricLevel = z.infer<typeof RubricLevelSchema>

/**
 * Resolve the effective trigger for a scorer given its spec's severity.
 * Centralizes the default rules so evaluator/architect/tests agree.
 */
export function resolveTrigger(spec: AcceptanceSpec, scorer: AcceptanceScorer): "on_goal" | "on_integrity" {
  if (spec.trigger === "on_goal") return "on_goal"
  if (spec.trigger === "on_integrity") return "on_integrity"
  if (scorer.type === "heuristic" || scorer.type === "prebuilt" || scorer.type === "contract_audit") return "on_goal"
  // llm_judge: essential runs per-goal so failures fail fast; others batch at integrity acceptance.
  return spec.severity === "essential" ? "on_goal" : "on_integrity"
}

/**
 * Render a spec list as a single human-readable block for prompts, logs and
 * operator-facing docs. Deterministic, stable ordering.
 */
export function renderSpecsAsText(specs: readonly AcceptanceSpec[]): string {
  if (specs.length === 0) return "(no acceptance specs)"
  const lines: string[] = []
  for (const spec of specs) {
    lines.push(`• [${spec.severity}] ${spec.title} (${spec.id} ← ${spec.source_requirement_id})`)
    if (spec.scenario) {
      for (const g of spec.scenario.given) lines.push(`    Given ${g}`)
      for (const w of spec.scenario.when) lines.push(`    When  ${w}`)
      for (const t of spec.scenario.then) lines.push(`    Then  ${t}`)
    }
    for (const sc of spec.scorers) {
      if (sc.type === "heuristic") {
        const desc = sc.spec.kind === "shell" ? `shell: ${sc.spec.cmd}` : `script: ${sc.spec.path}`
        lines.push(`    - [heuristic] ${sc.name} — ${desc}`)
      } else if (sc.type === "llm_judge") {
        lines.push(`    - [judge] ${sc.name} — ${sc.criteria}`)
      } else if (sc.type === "contract_audit") {
        lines.push(
          `    - [contract_audit] ${sc.name} — ${sc.spec.kind} contracts=${sc.spec.contract_ids.join(", ")} expect=${sc.expect.status}`,
        )
      } else {
        const visualBundle =
          sc.name === "visual-evidence-bundle" && sc.spec?.kind === "visual_evidence_bundle"
            ? ` — ${sc.spec.kind}${sc.spec.viewport ? ` viewport=${sc.spec.viewport}` : ""} expect=${sc.expect?.status ?? "(unspecified)"}`
            : ""
        lines.push(`    - [prebuilt:${sc.name}] ${JSON.stringify(sc.config)}${visualBundle}`)
      }
    }
  }
  return lines.join("\n")
}
