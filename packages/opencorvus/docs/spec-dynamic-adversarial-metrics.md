# Spec — Dynamic Adversarial Metrics (DAM)

## Summary

Replace the current strict/soft gate + failed-check signature hash with a
**four-layer metric pipeline**:

1. **Modeling layer** — Architect (Requirements Agent) produces a fixed
   `GoalMetricSpec[]` + `GlobalMetricSpec[]` + `ChallengeSeed[]` once at task
   start. Metrics are selected from a supported family and parameterized; they
   are **not** redefined mid-run.
2. **Ground-truth store** — four new tables (`engine_metric_spec`,
   `engine_metric_result`, `engine_counterexample`, `engine_iteration`) hold
   the authoritative evaluation record. `engine_evaluation` is demoted to a
   verdict-wrapper; `task.metadata.criteria_results` becomes a projection only.
3. **Adversarial execution** — each iteration runs Defender → Metric Executor
   → Prosecutor → Arbiter. When Arbiter returns `continue`, the Orchestrator
   hands the full trajectory (iteration snapshots + open counterexamples +
   Defender/Prosecutor rationale) to the next driver. The driver — an LLM
   agent — decides what to do with that signal: patch code at the same goals,
   add tests, or re-invoke the Architect to reshape goals. That decision is
   NOT encoded as an Arbiter verdict or a fixed-pipeline step. The assistant
   has the context and judges.
4. **Judgment layer** — `accept` requires **all blocking metrics met, all
   counterexamples resolved, no global veto**. The aggregate score `S_k` is
   only a convergence/stop signal, never a pass signal.

The central invariant: **the scoring ruler is frozen after the modeling
phase**. Without that, `not converging` as a stop condition is ill-defined
because scores across iterations are incomparable.

## Motivation

Three concrete problems with the current pipeline:

- **Hardcoded two-tier gate.** `src/acceptance/types.ts::scorerMode` maps
  severity → `strict|soft`; `src/delivery/tools.ts::query_criteria` emits a
  "GATE: N strict check(s) failed" directive that forces `verdict=rejected`.
  This is a keyword-matching rule masquerading as judgment — exactly the
  pattern CLAUDE.md rule 12 forbids.
- **Signature-hash convergence.** `src/verification/signature.ts` SHA-256s
  the sorted failed-check tuple and `src/engine/persist.ts::updateEvaluationFromDeliveryVerdict`
  short-circuits when the hash repeats. Two runs that fail *different* checks
  at the same sites collide; two runs that fix a check and regress another
  look identical if counts match. The signal is too lossy to drive iteration.
- **No global view.** Every metric today is per-goal. Per-goal-green /
  task-broken (cross-goal contract drift, regressions on previously passing
  goals, architecture decay) is undetectable.
- **Advertised-but-absent infra.** `spec-acceptance-eval-protocol.md`
  references an Architect-side `translator` that does not exist in the repo;
  the runtime has no typed metric store to build on. DAM has to ship the
  ground-truth layer, not only swap the scorer shape.

## Non-goals

- Not a DSL. Metric specs are JSON, validated by zod; the families are closed.
- Not an online-learning loop. The Architect does not re-tune weights after
  seeing results.
- Not a replacement for CI. DAM runs inside one task; release-gate metrics
  (e.g. benchmark regressions) stay upstream.

## Architecture

```
┌────────────── task start ──────────────┐
│ Architect (RequirementsAgent)          │
│   register_goal (goal contracts)       │
│   register_goal_metric_spec (goal)     │
│   register_global_metric_spec (task)   │
│   register_challenge_seed (task)       │  ← Prosecutor priors
└───────────────┬────────────────────────┘
                │ frozen GLOBAL ruler + goals_v0 + per-goal metrics_v0
                ▼
┌────────── iteration k loop ──────────────────────────────┐
│ 1. Defender (DeliveryAgent, trimmed)                     │
│      reads full trajectory + open counterexamples +      │
│      prior Prosecutor rationale — may patch code, add    │
│      tests, OR invoke the Architect to reshape goals     │
│      → delivery_snapshot_k                               │
│ 2. Metric Executor (pure)                                │
│      → engine_metric_result rows                         │
│ 3. Prosecutor (new sub-agent)                            │
│      → engine_counterexample rows                        │
│      → ≤1 challenge metric/iter,                         │
│        ≤3 total/task, diagnostic class                   │
│        only (never blocking)                             │
│ 4. Arbiter (pure function)                               │
│      reads engine_iteration                              │
│      returns: continue | accept | stalled | abort        │
└──────────────────────────────────────────────────────────┘
```

### Role contract

| Role | Mutates | Reads | LLM? |
|------|---------|-------|------|
| Architect (task start) | `engine_goal`, `engine_metric_spec` (baseline goal+global), `engine_counterexample` (seeds) | requirements | yes |
| Architect (re-invoked by Defender mid-task) | `engine_goal` (add/merge/split only), `engine_metric_spec` (new goals only) | iteration snapshot, counterexamples, defender/prosecutor rationale | yes |
| Defender | workspace files; may invoke Architect | metric results, counterexamples, full trajectory | yes |
| Metric Executor | `engine_metric_result` | spec + delivery snapshot | no (except when spec.evaluator_kind=judge) |
| Prosecutor | `engine_counterexample`, *diagnostic* spec rows | everything read-only | yes |
| Arbiter | `engine_iteration`, verdict wrapper | metric rows + counterexamples | **no** |

The Defender is not a code-patcher with no agency — it is the iteration
driver. Given the full trajectory it self-directs. The Architect is
available as a tool/delegation when the Defender judges the goal structure
itself is the problem. There is no Arbiter-level gatekeeping verdict that
routes to the Architect; the Defender decides, because the Defender has
the full feedback.

### Frozen-ruler rule

Baseline metric specs are **immutable once written** — every row's
`frozen_at` is final; the SQL trigger raises on UPDATE, and the store layer
never emits one. Deletions cascade only when the owning task is deleted.

Mutation rights by role:
- **Global baseline metric rows**: nobody, ever, after the modeling phase.
  These are the ruler of the whole task — changing them invalidates `S_k`
  comparability across iterations.
- **Per-goal baseline metric rows (existing)**: immutable. If the
  Defender/Architect decides to retire a goal, its metric rows stay on
  record but become inert because the goal no longer exists; the accept
  gate ignores metrics on missing goals.
- **Per-goal baseline metric rows (new)**: allowed only for brand-new goals
  added mid-task. New goals plug cleanly into the existing ruler because
  their metrics compose into the same `S_k` formula.
- **Challenge rows (`source='challenge'`)**: inserted by Prosecutor,
  always `gate_class='diagnostic'`, never blocking. Budgeted K=1/iter, ≤3/task.

This is what preserves `S_k` comparability: the global weights, floors, and
targets never move. Per-goal score components can shift as goals come and
go, but that's captured by `delta_vs_prev` and the Arbiter's stalled window.

## Data model

```sql
-- Frozen after modeling phase. scope ∈ {goal, global}.
CREATE TABLE engine_metric_spec (
  id                   TEXT PRIMARY KEY,
  task_id              TEXT NOT NULL,
  scope                TEXT NOT NULL,                  -- 'goal' | 'global'
  goal_id              TEXT NULL,                      -- NULL iff scope='global'
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL,
  unit                 TEXT NOT NULL,                  -- 'ratio'|'count'|'latency_ms'|...
  direction            TEXT NOT NULL,                  -- 'higher_better'|'lower_better'
  target               REAL NOT NULL,                  -- aspirational
  floor                REAL NOT NULL,                  -- below this = veto (blocking only)
  weight               REAL NOT NULL,                  -- for S_k aggregation
  gate_class           TEXT NOT NULL,                  -- 'blocking'|'diagnostic'|'efficiency'
  evaluator_kind       TEXT NOT NULL,                  -- 'shell'|'judge'|'ast'|'query'|'aggregator'
  evaluator_config     TEXT NOT NULL,                  -- JSON, schema per evaluator_kind
  source_requirement_ids TEXT NOT NULL,                -- JSON array
  source              TEXT NOT NULL,                   -- 'baseline'|'challenge'
  frozen_at            INTEGER NOT NULL,
  created_by           TEXT NOT NULL                   -- 'architect'|'prosecutor'
);

CREATE TABLE engine_metric_result (
  id                TEXT PRIMARY KEY,
  metric_spec_id    TEXT NOT NULL REFERENCES engine_metric_spec(id),
  task_id           TEXT NOT NULL,
  iteration         INTEGER NOT NULL,
  goal_run_id       TEXT NULL,
  raw_value         REAL NOT NULL,
  normalized_value  REAL NOT NULL,                     -- [0,1], direction-adjusted
  met_target        INTEGER NOT NULL,                  -- 0|1
  met_floor         INTEGER NOT NULL,                  -- 0|1
  evidence_ref      TEXT NOT NULL,                     -- URI into artifact store
  evidence_fresh    INTEGER NOT NULL,                  -- 0|1; 0 ⇒ result invalid
  computed_at       INTEGER NOT NULL
);

CREATE TABLE engine_counterexample (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT NOT NULL,
  iteration_found    INTEGER NOT NULL,
  iteration_resolved INTEGER NULL,                     -- NULL while open
  novelty_hash       TEXT NOT NULL,                    -- dedup key
  target_scope       TEXT NOT NULL,                    -- 'goal'|'global'
  target_ref         TEXT NOT NULL,                    -- goal_id or global risk id
  claim              TEXT NOT NULL,
  reproducer         TEXT NOT NULL,
  severity           TEXT NOT NULL,                    -- 'blocking'|'diagnostic'
  linked_metric_spec_id TEXT NULL                      -- if it spawned a challenge metric
);

CREATE TABLE engine_iteration (
  task_id               TEXT NOT NULL,
  iteration             INTEGER NOT NULL,
  aggregate_score       REAL NOT NULL,                 -- S_k
  per_goal_score_json   TEXT NOT NULL,
  global_score          REAL NOT NULL,
  delta_vs_prev         REAL NOT NULL,
  novelty_score         REAL NOT NULL,                 -- new counterexamples this iter
  blocking_unmet_count  INTEGER NOT NULL,
  open_counterexamples  INTEGER NOT NULL,
  regressed_blocking    INTEGER NOT NULL,              -- blocking metrics that fell this iter
  arbiter_verdict       TEXT NOT NULL,                 -- 'continue'|'accept'|'stalled'|'abort'
  PRIMARY KEY (task_id, iteration)
);
```

`engine_evaluation` keeps its row but its fields `signature`, `checks`, and the
strict/soft semantics are dropped. It becomes a thin wrapper:
`{ task_id, final_verdict, final_iteration, arbiter_reason }`.
`task.metadata.criteria_results` is regenerated from `engine_metric_result` on
demand as a read-only projection.

No replan-log table is needed. Goal-graph changes are visible through the
existing goal tables (new rows appear with later `time_created`). If
operators need a human-facing audit of mid-task goal edits, that goes into
the existing `decision_log` — not a new specialized table.

## Metric taxonomy

Architect picks from three gate classes; the class determines whether the
metric can veto `accept`.

| Gate class  | Can veto accept? | Counts in S_k? | Typical use |
|-------------|------------------|----------------|-------------|
| blocking    | yes (floor)      | yes            | correctness, contract, non-regression |
| diagnostic  | no               | yes (down-weighted) | judge scores, defect density, fidelity hints |
| efficiency  | no               | no (trend only) | rework efficiency, novelty exhaustion |

**Mandatory assignments** (enforced at registration time):

Per-goal **blocking**:
- `functional_correctness` (ratio)
- `scenario_coverage` (ratio)
- `contract_compliance` (ratio)
- `regression_count` (count, lower_better)

Per-goal **diagnostic**:
- `rubric_judge_score`
- `reproducibility`
- `defect_density`

Global **blocking**:
- `cross_goal_contract_consistency`
- `non_regression_surface` (count, lower_better; floor=0)
- `architecture_integrity`
- `user_intent_fidelity`

Global/task **efficiency** (never blocking):
- `rework_efficiency`
- `novelty_exhaustion`

### Constraint rules

- **`evidence_fresh=0` invalidates the result.** A metric whose evidence was
  cached from a prior iteration does not count toward target/floor; the
  Executor must re-run its evaluator. No partial-credit scheme.
- **Embedding-similarity metrics** (e.g. `semantic_fidelity`) are only
  allowed as `diagnostic` class and only as Prosecutor focus hints. They
  cannot be promoted to blocking regardless of weight.
- **Global blocking metrics have veto power.** A failing global floor rejects
  `accept` even if `S_k` is high. No weighted-sum circumvention.

## Convergence rules

```
S_k =  α · Σ_goal  w_i · normalized(goal_metric_i_k)
    +  β · Σ_global v_j · normalized(global_metric_j_k)
```

Only metrics with `evidence_fresh=1` contribute. `efficiency` class excluded.
Per-goal scores only count goals that are live at iteration k — goals
retired mid-task drop out (their history stays in `engine_metric_result`
but no longer contributes to S_k).

### Arbiter verdicts

```
accept   := all baseline blocking metrics met_floor=1 AND met_target=1
            AND open_counterexamples = 0
            AND no blocking regression in current iter

continue := blocking still unmet and the loop is still producing signal.
            The Orchestrator hands the full trajectory, open counterexamples,
            and Defender/Prosecutor rationale to the next iteration's
            driver. That driver judges what to do — patch code, add tests,
            re-invoke the Architect to reshape goals. The Arbiter does
            not encode that choice.

stalled  := last 3 iterations flat (|ΔS_k| < 0.015), novelty_score = 0,
            and blocking_unmet_count > 0. The assistant has the context
            but can't find new signal within the current task scope.
            Terminal but not a failure.

abort    := 2 consecutive iters with regressed_blocking > 0,
            OR iteration ≥ max_iterations (hard ceiling).
```

The direct encoding of "delivery反馈优先被吸收" is: **`continue` hands the
full trajectory to the next driver, and the driver has the Architect as an
available tool**. No verdict enum entry, no budget, no hardcoded switch —
the assistant sees the same signal the Arbiter sees and decides.

`stalled` is a legal terminal state, not an Arbiter failure. The
Orchestrator decides what to do next (escalate model, human review,
scope down). `abort` always rolls back to the iteration with highest S_k
that had fewest open counterexamples.

### Prosecutor budget

- Per iteration: **≤1** new challenge metric.
- Per task total: **≤3** challenge metrics.
- Challenge metrics are always `gate_class='diagnostic'` — they shape S_k and
  surface issues, they do not block acceptance. An issue severe enough to
  block is a counterexample, not a metric.
- Counterexamples have no numeric budget but the `novelty_hash` dedups; a
  Prosecutor that cannot raise a novel hash contributes 0 novelty_score that
  iter, which is what feeds the `stalled` condition.

### Model tier

- Defender: task default model.
- Prosecutor: **one tier higher** than Defender, but only at two moments:
  the final-verdict review and the pre-`stalled` double-check. Elsewhere
  same tier as Defender, to keep cost bounded.

## Tool surface (additions / deletions)

### Add
- `src/requirements/output-tools.ts`: `register_goal_metric_spec`,
  `register_global_metric_spec`, `register_challenge_seed`.
- `src/metrics/executor.ts`: pure Metric Executor (shell / judge / ast /
  query / aggregator dispatch).
- `src/delivery/prosecutor.ts`: Prosecutor agent; tools
  `query_metric_trajectory`, `query_diff`, `propose_challenge_metric`
  (diagnostic only, quota-enforced), `mark_counterexample`,
  `resolve_counterexample`.
- `src/metrics/arbiter.ts`: pure function
  `arbitrate(iteration_row[]) → verdict ∈ {continue, accept, stalled,
  abort}`. No LLM, no side effects beyond writing `engine_iteration`.
- The Defender gets access to a goal-editing path (adding a new goal with
  its per-goal baseline metrics, retiring an existing goal). Exact tool
  shape is decided in the Phase 5 cut-over along with the Defender rewrite
  — it doesn't need its own spec section.

### Delete (hard list — no dual path)
- `src/verification/signature.ts` (whole file) and every caller.
- `src/acceptance/types.ts::scorerMode` and its consumers.
- Strict/soft gate text in `src/delivery/tools.ts::query_criteria`
  (tool itself is replaced by `query_metric_trajectory`).
- `_delivery_rework_history` construction and prompt injection in
  `src/orchestrator/agent.ts`.
- `max_delivery_iterations` as a primary decision input (retained only as
  `max_iterations` hard ceiling fed into `abort`).
- `engine_evaluation.signature` column and every write site.
- `DeliveryAgent.submit_verdict` (verdict now comes from Arbiter, not LLM).
- `task.metadata.criteria_results` as a write target — regenerated from
  `engine_metric_result` on demand.

## Rollout order

DB reset policy (CLAUDE.md rule 14): no migration, full reset after schema
land.

1. **Schema + Arbiter (pure).** Four new tables, four-verdict Arbiter, unit
   tests on synthetic iteration rows. Reset DB.
2. **Architect metric registration.** `register_goal_metric_spec` +
   `register_global_metric_spec` + `register_challenge_seed`. Architect
   prompt updated to require full blocking coverage. Tests verify frozen-ruler
   constraint.
3. **Metric Executor.** Five evaluator kinds wired. Evidence freshness
   enforced. Cached reuse forbidden across iterations.
4. **Prosecutor.** Prosecutor tools wired with budget enforced at write
   layer; counterexample novelty hash verified. SQL trigger confirms
   challenges cannot touch global or existing rows.
5. **Orchestrator cut-over.** Arbiter becomes sole verdict source. Delete
   the hard list above in the same commit. The Defender loop reads full
   trajectory on `continue` and self-directs (patch code vs. add goal vs.
   invoke Architect). No `--legacy` path.

Every step ends with a run on a real task; no step may land while the prior
step still has a fallback branch.

## Open decisions (default answers below, override in PR)

- Prosecutor model tier: +1 only at final verdict and pre-`stalled` recheck.
- Challenge metric budget: **K=1/iter, ≤3/task**, diagnostic-only.
- Stop thresholds: **ε=0.015, N=3**.
- Global blocking veto: `non_regression_surface < 0` or
  `cross_goal_contract_consistency < floor` ⇒ hard reject accept, no
  weighted-sum override.

## Alternatives considered

- **Keep signature hash, add a score layer on top.** Rejected: dual signals
  race; the hash still forces early exits on metric-improving iterations.
- **Let Prosecutor rewrite baselines.** Rejected: breaks S_k comparability,
  invalidates `stalled`.
- **Promote embedding similarity to blocking.** Rejected: too easy to game
  via surface rewrites; kept as diagnostic + Prosecutor hint.
- **Single unified "score ≥ threshold ⇒ accept".** Rejected: lets global
  regressions be masked by per-goal gains. Blocking veto is the invariant.
