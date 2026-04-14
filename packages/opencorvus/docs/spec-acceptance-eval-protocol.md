# Spec — Acceptance Evaluation Protocol (AEP)

## Summary

Let the **Requirements Agent** emit machine-readable *acceptance specs* through a
tool-call protocol, and let the **Architect** translate them into
`CheckConfig` entries the existing evaluator / delivery pipeline already
consumes. Replaces the freeform `GoalContractFields.done_definition` string with
a typed, rubric-first structure that supports both deterministic code checks
and LLM-graded rubrics.

Design is derived from industry-standard eval frameworks — Inspect AI
(Task/Solver/Scorer), Braintrust/autoevals (three-class scorer taxonomy),
MLflow `make_judge` (declarative rubric), Ragas rubric metrics, DeepEval
G-Eval, and the AutoUAT two-phase pipeline (user story → Gherkin → scorer).
The protocol is not invented here; it follows what these frameworks converge on.

## Motivation

`done_definition: string` has three concrete failure modes observed in this
codebase:
- Evaluator must re-interpret NL every run → non-deterministic verdict drift.
- No typed surface for the Architect to attach *deterministic* checks (build /
  lint / verify_cmd) against a specific requirement.
- Severity is implicit: one vague sentence can be essential or cosmetic, the
  evaluator has no signal to distinguish.

Adjacent fields already hint at the right shape — `GoalQaProfile.goal_check_prompt`,
`rule_selectors`, `PluginCheck`, `CheckConfig.checks[]`. AEP unifies them.

## Non-goals

- Not a general-purpose test framework; executable bodies are delegated to
  existing check runners (`verify_cmd`, `PluginCheck`).
- No custom-DSL assertion grammar (`{metric, op, value}` style). Industry
  frameworks all reject this in favor of named pre-built scorers.
- No sandboxed arbitrary JS/TS execution. If a rule is code, it lives in the
  repo and is referenced by path.

## IR — AcceptanceSpec

Produced by `RequirementsAgent` through a new tool `declare_acceptance_spec`.
One `AcceptanceSpec` is bound to exactly one `ParsedRequirement`. Multiple
specs may exist per requirement.

```typescript
export interface AcceptanceSpec {
  id: string                               // stable, e.g. "acc-login-3s"
  source_requirement_id: string            // FK to ParsedRequirement.id
  title: string                            // short human-readable name

  // Gherkin-style behavioral anchor. Optional — omit for pure code rules
  // where a scenario doesn't add information.
  scenario?: {
    given: string[]
    when:  string[]
    then:  string[]
  }

  // One AcceptanceSpec resolves to >= 1 Scorer. Scorers follow the Braintrust
  // / MLflow trichotomy. No other scorer kinds.
  scorers: Scorer[]

  // Severity drives evaluator verdict aggregation. Four levels borrowed from
  // rubric literature (essential/important/optional/pitfall).
  severity: "essential" | "important" | "optional" | "pitfall"

  // When the scorer must run. Default per kind (see "Trigger defaults").
  trigger?: "on_goal" | "on_delivery"
}

export type Scorer =
  | HeuristicScorer
  | LlmJudgeScorer
  | PrebuiltScorer

export interface HeuristicScorer {
  type: "heuristic"
  name: string                              // unique within spec
  spec:
    | { kind: "shell";      cmd: string; cwd?: string }
    | { kind: "script_ref"; path: string; args?: string[] }  // repo-relative
  expect?: { exit_code?: number }           // default: 0 = pass
}

export interface LlmJudgeScorer {
  type: "llm_judge"
  name: string
  criteria: string                          // single-criterion NL description
  rubric?: RubricLevel[]                    // ordinal anchors, 2-5 levels
  inputs?: Array<"delivery_summary" | "changed_files" | "requirement_text">
  // Judge runs one call per criterion (no halo effect).
}

export interface RubricLevel {
  score: number                             // 0..max, integers only
  label: string                             // e.g. "fully met"
  anchor: string                            // behavioral description for this score
  passes: boolean                           // does this level count as pass
}

export interface PrebuiltScorer {
  type: "prebuilt"
  name: "factuality" | "relevance" | "contains" | "exact_match"
       | "length_within" | "json_schema"    // registry — extensible in code
  config: Record<string, unknown>           // validated by per-scorer zod schema
}
```

### Trigger defaults

| Scorer kind | Default trigger | Rationale |
|---|---|---|
| heuristic  | `on_goal`     | Cheap; fail fast prevents cascade |
| prebuilt   | `on_goal`     | Ditto |
| llm_judge (severity=essential) | `on_goal`     | Blocking rubric must gate the goal |
| llm_judge (other severity)     | `on_delivery` | Batch at final acceptance to save tokens |

This overrides the user's earlier "delivery only" preference. Rationale in
Risks §1.

## Pipeline Placement

```
User request
  → RequirementsAgent
      · emits ParsedRequirement[]  (existing)
      · emits AcceptanceSpec[]     (NEW, via declare_acceptance_spec)
  → GoalCompiler                    (existing: requirements → GoalContract)
  → Architect
      · binds specs to goals        (NEW, via bind_goal_specs)
      · translates to CheckConfig   (NEW, `spec/translator.ts`)
  → Planner → Executor → Evaluator → Delivery
      · existing runners execute the translated checks
      · llm_judge runner is NEW    (`evaluator/llm-judge-runner.ts`)
```

## Translation — AcceptanceSpec → CheckConfig

Rules (`src/spec/translator.ts`):

| Scorer | CheckConfig entry | Runner |
|---|---|---|
| `heuristic.shell`       | `{ name: "spec:<id>:<scorer>", family: "verify_cmd", mode: strictOf(severity), cmd }`  | existing verify_cmd |
| `heuristic.script_ref`  | same shape, cmd = `bun run <path> <args…>`                                              | existing verify_cmd |
| `prebuilt`              | `{ name, family: "prebuilt", mode, config }`                                            | new dispatch table in `evaluator/prebuilt/` |
| `llm_judge`             | `{ name, family: "rubric", mode, criteria, rubric?, inputs }`                           | new `llm-judge-runner.ts` |

`strictOf(severity)`:
- `essential` → `strict`
- `important` → `strict`
- `optional`  → `soft`
- `pitfall`   → `soft`

A *strict* check failing rejects the goal. *soft* failures only annotate the
verdict with `concerns`.

## Evaluator Verdict Aggregation

`EvaluatorAnalysis.verdict` becomes a function of per-scorer outcomes:

- Any `essential` scorer failing → `rejected`.
- Any `important` scorer failing → `rejected` unless all essential pass AND
  evaluator judges the important failure as a false positive (requires
  explicit `concerns` entry; no silent downgrade).
- `optional` / `pitfall` failures → `accepted` with `concerns`, never reject.

## New Tools (gateway + orchestrator scope)

Both live under the existing `src/gateway/tools.ts` registration pattern
(zod-validated, named functions).

```ts
declare_acceptance_spec(input: AcceptanceSpec): { id: string }
bind_goal_specs(input: { goal_id: string; spec_ids: string[] }): { bound: number }
```

`declare_acceptance_spec` persists into a new table `acceptance_specs`
(columns: id, task_id, requirement_id, json, created_at). `bind_goal_specs`
writes to a join table `goal_acceptance_specs` (goal_id, spec_id).

## Storage

Single JSON blob per spec in DB, plus a lightweight index on
`(task_id, requirement_id)`. `CheckConfig` in memory is derived — not
persisted separately — by re-translating from the spec blob at pipeline
start. This keeps the translator the single source of truth.

## Deprecations

| Field / code | Action | Timing |
|---|---|---|
| `GoalContractFields.done_definition` | **remove** — all callers must read AcceptanceSpec | M2 |
| `GoalQaProfile.goal_check_prompt`    | **fold into** `llm_judge` scorer | M2 |
| `GoalQaProfile.rule_selectors`       | **fold into** `bind_goal_specs` | M2 |
| requirements/parse.ts YAML parser    | already removed, no-op | — |

Explicit death list — nothing is kept "for compat". Per project rule: no
fallback, no shim.

## Risks & Warnings

1. **"LLM judge only at delivery" is a regression**, not an optimization.
   Per-goal essential rubrics catch errors 1 goal back instead of a full run
   back; the extra tokens are 1-2 cents vs. a multi-minute replan. Default
   overrides the user's earlier choice; severity switch is the escape hatch.
2. **LLM-judge reliability is capped at ~85%** (G-Eval baseline). Essential
   scorers should favor heuristic/prebuilt when feasible. Rubric anchors and
   single-criterion-per-call are both mandatory (not optional) to hit that
   ceiling.
3. **Gherkin is optional by design**. Forcing scenarios onto every spec
   (including "build must pass") adds noise. The translator must never
   require `scenario` to emit a CheckConfig entry.
4. **Persistence migration**: new tables are additive; existing goals with
   `done_definition` must be re-processed by RequirementsAgent before their
   tasks restart. No runtime translation of legacy strings.

## Acceptance (for this spec itself)

This document is accepted when:
- A benchmark (`script/benchmark/acceptance-eval-benchmark.ts`) exists and
  exercises the full chain under the criteria listed below.
- That benchmark passes without fallback / retry / mocked LLM.

### Benchmark acceptance criteria

- IR schema zod-validation: 100% of emitted specs parse.
- Requirement coverage: ≥ 90% of seeded NL requirements map to ≥ 1 spec
  (matches AutoUAT 92% baseline).
- Heuristic determinism: on a seeded pass fixture, 100% of heuristic scorers
  pass; on a seeded fail fixture, 100% fail. No flakes.
- LLM-judge calibration: on a 10-sample labeled fixture (5 pass, 5 fail),
  accuracy ≥ 85%.
- Translation idempotency: translating the same spec twice produces
  byte-identical CheckConfig entries.
- No-activity timeout: 3 min per benchmark stage.

## Milestones

- **M0** — this spec lands + benchmark skeleton runs the happy path with
  stubbed LLM judge.
- **M1** — `declare_acceptance_spec` + `bind_goal_specs` tools; translator
  for heuristic + prebuilt; evaluator aggregation by severity.
- **M2** — llm-judge runner; RequirementsAgent prompt updated; deprecations
  removed.
- **M3** — benchmark hits all acceptance criteria; legacy paths deleted.

## Open Questions

- Prebuilt scorer registry: ship which N scorers in v1? Proposed:
  `factuality`, `contains`, `exact_match`, `length_within`. Others by demand.
- Do we need per-spec timeout? Architect can set `verify_cmd` timeout today
  via CheckConfig; propose reuse, no new field.

## References

- Inspect AI — Task/Solver/Scorer decomposition (https://inspect.aisi.org.uk)
- Braintrust Scorers — code / LLM-as-judge / autoevals trichotomy
- MLflow `make_judge` — declarative judge factory (instructions + rubric)
- Ragas DomainSpecific / InstanceSpecific rubrics — rubric schema shape
- DeepEval G-Eval — CoT rubric, 0–10 integer scale
- AutoUAT (arXiv 2504.07244) — user-story → Gherkin → executable tests,
  92–95% helpful rate at industrial scale
- Recursive Rubric Decomposition (arXiv 2603.00077) — single-criterion,
  behavioral anchors, ordinal levels
