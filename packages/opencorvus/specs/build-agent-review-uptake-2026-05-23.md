# Build Agent Integrity Review Uptake - 2026-05-23

Status: design draft. No runtime code is changed by this document.

CLAUDE.md rules that govern this change:

- rule 6.1: prompt-over-host for LLM routing/scoping (no host-side
  retry-until-fixed gate).
- rule 8: one source of truth for integrity findings reaching build.
- rule 11: reject designs that hide workflow decisions in code.
- rule 13: no state-machine flow control.
- rule 16: no compatibility patch / dual path.
- rule 17: delete dead intermediate summaries.
- rule 35: grep every call site before landing the plan.
- rule 36: every change carries a targeted test.

## Abbreviations

| Term            | Meaning                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BF              | Blocking finding emitted by integrity reviewers.                                                                                                                                                 |
| AF              | Advisory finding.                                                                                                                                                                                |
| DB              | OpenCorvus persistent SQLite store.                                                                                                                                                              |
| LLM             | Large Language Model.                                                                                                                                                                            |
| REQ             | Requirement row.                                                                                                                                                                                 |
| TRM             | Integrity `team_report_markdown` — full reviewer/consensus output.                                                                                                                               |
| `request`       | Argument string on the `build` tool.                                                                                                                                                             |
| `retryGuidance` | `BuildContext.retryGuidance` — renders as `## Retry Guidance From Orchestrator` in the build prompt.                                                                                             |
| `retryFeedback` | `BuildContext.retryFeedback` — renders as `## Prior Attempt Failed`; pulled from `decision_log phase="retry"` entries by `latestBuildReportForGoal` / `composeLatestAcceptanceFeedbackForBuild`. |

## User Concern

Task `tsk_e54c2d091001t145QP2P6xwoqi` (`demos/aichat`) ran 9 integrity rounds
over 2.6 hours. The same blocking finding — `getSettings()` does not validate
model/temperature/maxTokens — was reported in rounds 2 through 7 before the
round-8 build finally repaired it. The user asks: why did build dispatch
fail to absorb the persistent integrity review and converge?

## Hazard Audit Integration (2026-05-24)

Hazard audit rewrites in this spec:

- [`Composition helper`](#composition-helper): H-1 removes the local
  finding-id-repeat definition and requires the shared root-history helper
  defined by `orchestrator-stuck-integrity-loop-2026-05-23.md`.
- [`Why not just dump team_report_markdown verbatim?`](#why-not-just-dump-team_report_markdown-verbatim):
  H-3 removes artifact-id-only dereferencing and requires bounded complete
  blocking feedback in the build prompt or a build-readable runtime markdown
  file.
- [`Rule 6.1 Self-Check`](#rule-61-self-check): clarified that host work is
  fact assembly from shared root history, not a build-lane gate.
- [`Test Plan`](#test-plan): prompt-string-only assertions are supplemented by
  active-path stub-LLM coverage.

Plan updates appended in
[`Plan Updates From Hazard Audit (2026-05-24)`](#plan-updates-from-hazard-audit-2026-05-24):
H-2 spec snapshot lineage, hook-fix rule-35 discipline, shared prompt budget
and control-character rendering rules, and stub-LLM verification.

Cross-reference: this spec consumes the single root-history helper owned by
the orchestrator-stuck spec. It consumes attempt listing,
`SpecSnapshotLineage`, shared prompt cap, and shared sanitizer from the
replay-aware spec:
[`SpecSnapshotLineage API`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-specsnapshotlineage-api),
[`Shared Prompt Cap Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-cap-owner),
and
[`Shared Prompt Sanitizer Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-sanitizer-owner).
This spec must not declare local caps or sanitizer rules.

## Diagnosis

### Read-only DB evidence

Probed `C:\Users\hengu\.local\share\opencorvus\opencorvus.db` (bun:sqlite,
read-only). Findings:

| Surface                                         | Observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Source                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Integrity attempts                              | 8 rows, all `verdict=needs_correction`, `phase=post_build`. Sequence: R1=11 findings (5 reviewers), R2=9, R3=10, R4=3, R5=10 (4 reviewers), R6=11 (4 reviewers), R7=8 (5 reviewers), R8=7 (4 reviewers).                                                                                                                                                                                                                                                                                                                                                                                                   | `engine_artifact WHERE task_id=? AND kind='integrity_attempt' ORDER BY time_created`.                                             |
| Persistent blocker                              | "getSettings() does not validate model/temperature/maxTokens against allowed ranges" appears as BF in R2, R3, R4, R5 (as part of CONSENSUS-BF2/BF3), R6 (SV-1/SV-2/SV-3), R7 (BF-1-settings-validation). Confirmed fixed in R8 consensus summary.                                                                                                                                                                                                                                                                                                                                                          | Inspected each integrity_attempt payload's `findings[]` array.                                                                    |
| Reviewer consensus naming the persistence       | R7 summary (`art_e5543094c001bg7z5POlCX6rBo`): "All 5 independent reviewers unanimously converge on one blocking finding that has persisted across 6 consecutive integrity review rounds (rounds 2–7): getSettings() in src/services/storage.ts does not validate ...".                                                                                                                                                                                                                                                                                                                                    | `decision_log` phase=`review` row at 2026-05-23T14:35:17, key `review_needs_correction_ses_1aac7c132ffd...`.                      |
| Build sessions for this task                    | 14 build sessions parented to the orchestrator session `ses_1ab3d291effeqT8ofY3QCaiglW`. 5 are goal builds (one per goal, all pre-R1). 9 are TASK-LEVEL DIRECT builds (`goal_id` NULL, titles "Build: ## Integrity Correction Round N"). All "correction" builds happened AFTER R1.                                                                                                                                                                                                                                                                                                                        | `SELECT id, goal_id, title FROM session WHERE kind='build' AND parent_id='ses_1ab3d291effeqT8ofY3QCaiglW' ORDER BY time_created`. |
| Each build session has exactly one user message | Every build session in the task carries 1 user message — no in-session retry feedback prompts ever ran (no `existingSessionID` reuse on these builds).                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `SELECT COUNT(*) FROM message WHERE session_id=? AND json_extract(data,'$.role')='user'` per session.                             |
| Build tool calls in the orchestrator            | 17 `tool=build` parts in `prt`. Each correction round's `input.request` contains the orchestrator LLM's hand-written summary of the integrity findings it thinks matter. Examples: R5 build input contains only "BF-1: TypeScript TS2345" + "BF-2: Review the full integrity report for any second blocking finding" (literal text — orchestrator told the build agent to guess). R6 build input does name the persistent finding explicitly.                                                                                                                                                              | `SELECT data FROM part WHERE json_extract(data,'$.tool')='build' ORDER BY time_created`.                                          |
| Build prompt actually delivered                 | The user message of every task-level correction build is the `# Delegation` block from `buildUserPrompt` (build/agent.ts:2423) with `# Request` rendered via `renderUserRequestSection`. `renderUserRequestSection` truncates the request at 500 words: e.g. R8 prompt ends with `... (781 word(s) omitted from prompt injection)`. The integrity team_report_markdown is NEVER present anywhere in the build prompt — searched all 9 correction-build user messages for "CONSENSUS-", "team_report", reviewer ids, etc. — zero matches.                                                                   | Dumped each build session's user-message parts to text; pattern-searched.                                                         |
| decision_log carrying integrity into build      | `decision_log` rows for integrity verdicts use `phase="review"` (orchestrator/tools.ts:1782), value compressed to "verdict=… reviewers=… findings=… summary=… top: [first 5 findings]". `BuildContext.retryFeedback` is loaded from `decision_log phase="retry"` only (orchestrator/tools.ts:4950 `decisionLog.readByPhase("retry")`). The `phase="retry"` rows only contain build-attempt artifacts and `build_agent_contract_violation` events (engine/persist.ts:179 `ensureBuildRetryFeedbackForGoal`, orchestrator/tools.ts:5317). Integrity findings do not write into `phase="retry"` for any goal. | `SELECT phase, key, vlen FROM decision_log WHERE task_id=? AND phase IN ('retry','review','build') ORDER BY time_created`.        |

### What actually happens R5 → R6

1. R5 integrity (13:55Z) returns `team_report_markdown` (18.8 KB, 10 findings,
   3 of them blocking including the persistent `getSettings()` one). The
   orchestrator's `integrity` tool result (`renderIntegrityOutcome`,
   orchestrator/tools.ts:1545-1561) returns the FULL markdown to the
   orchestrator LLM in a `team_report_markdown` field.
2. Orchestrator LLM at 13:55:35Z calls `build({ directBuildIntent: "modify_files",
request: "## Integrity Correction Round 5: Fix TypeScript Build Error and
Remaining Issues\n### BF-1: ... TS2345 ...\n### BF-2: Review the full
integrity report for any second blocking finding\nBased on the pattern of
the review, the second finding might be about: - MessageList not filtering
..." })`. The persistent `getSettings()` blocker is **not** in the request.
3. Build dispatched. `buildUserPrompt` (build/agent.ts:2423) renders `# Delegation`
   - `# Request` (the orchestrator's request text, truncated to 500 words by
     `renderUserRequestSection`). There is no `retryFeedback` section (no
     decision_log `phase=retry` rows because integrity findings never write to
     that phase). There is no `retryGuidance` section either, because for
     task-level direct builds the orchestrator's `request` IS the target text
     (orchestrator/tools.ts:5004 `target = { kind: "request", text: requestText }`)
     — `retryGuidance` is only used on goal builds (orchestrator/tools.ts:4994).
4. Build agent reads the prompt, sees only "fix TS2345 + something about
   MessageList filtering", writes the fix it was told to write, merges back,
   reports passed.
5. R6 integrity runs against the new tree. The TS2345 is gone but
   `getSettings()` still has no validation, so R6 re-reports the same blocker.
   Reviewers count it as a "fresh" finding (the integrity-team-replay-aware
   spec is what addresses that side of the loop).

The same shape repeats for every round: R6's build did include the persistent
finding (orchestrator finally remembered); R7's build addressed two
different findings; etc. The convergence required 6 round-trips because each
round depended on whether the orchestrator LLM happened to copy the right
subset of the 18-27 KB review markdown into the `request` text.

### Why the persistent-blocker signal never reaches build

`team_report_markdown` is **not** plumbed into `BuildContext` at all. The
orchestrator's build tool execute path (orchestrator/tools.ts:4624 onwards):

- Goal builds (orchestrator/tools.ts:4877-4998) compose `BuildContext.retryFeedback`
  from `decision_log phase="retry"` and `BuildContext.acceptanceFeedback` from
  `composeLatestAcceptanceFeedbackForBuild`. Neither is populated by integrity.
- Task-level direct builds (orchestrator/tools.ts:5000-5021) compose
  `BuildContext.acceptanceFeedback` only. `retryGuidance` does not exist on this
  branch (`target.text = requestText` consumes the orchestrator's request
  verbatim).

So in both shapes, the only path for integrity findings to reach build is the
single `request` string the orchestrator LLM types. The host:

- Returns the full markdown to the orchestrator LLM (rule 6.1 host doesn't
  filter — good).
- Persists the full markdown in `engine_artifact.payload.team_report_markdown`
  (good for audit / cross-attempt reading).
- But does NOT include that markdown as a structured `BuildContext.integrityFeedback`
  section in the build prompt.

The orchestrator LLM is the bottleneck. With a 18-27 KB review markdown in
its turn context, it routinely (R1, R3, R5, R7 visibly) summarizes down to
"the 1-3 findings I picked" and pastes those into `request`. The build agent
sees only the picked subset and cannot independently re-derive what the
reviewers actually said. Persistent blockers persist precisely because the
orchestrator's summary loses information across rounds.

### Failure mode taxonomy

This is **not** a build-side absorption failure — the build agent never sees
the review text. It is an orchestrator → build forwarding gap:

| Hypothesis                                                       | Evidence                                                                                                                                                       | Verdict                                                                                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build agent ignores review section it can see                    | No section exists in any inspected build prompt.                                                                                                               | Refuted.                                                                                                                                                               |
| Build prompt is truncated and review tail is cut                 | `renderUserRequestSection` truncates `request` text. R5 prompt shows `... (228 word(s) omitted)`.                                                              | Real, but secondary — orchestrator's hand-typed summary fits, the full TRM was never on this side anyway.                                                              |
| `BuildContext` schema is missing the field                       | `BuildContext` (build/agent.ts:103-176) has `retryFeedback`, `retryGuidance`, `acceptanceFeedback`, no `integrityFeedback`.                                    | Confirmed.                                                                                                                                                             |
| Orchestrator LLM forgets / summarizes review                     | R5 `request` literally says "Review the full integrity report for any second blocking finding ... might be about ..." — the LLM told the build agent to guess. | Confirmed. Primary root cause.                                                                                                                                         |
| Build prompt doesn't tell build to treat persistence as must-fix | build-core.txt mentions "Integrity owns the final workflow gate inside its own review session" once; nothing about persistent rejection across rounds.         | Confirmed contributing factor: even if the markdown reached build, the build prompt has no language framing "this is the Nth review attempt, prior rounds rejected X". |

## Rule 35 Grep Inventory

Commands run before landing this plan:

```powershell
rg -n "BuildContext|retryFeedback|retryGuidance|acceptanceFeedback|integrityFeedback" packages\opencorvus\src
rg -n "team_report_markdown|integrity_attempt|listIntegrityAttemptArtifacts|findLatestIntegrityAttemptArtifact" packages\opencorvus\src packages\opencorvus\test
rg -n "rootHistory|root-history|persistent root|SpecSnapshotLineage" packages\opencorvus\src packages\opencorvus\test packages\opencorvus\specs
rg -n "renderIntegrityOutcome|composeLatestAcceptanceFeedbackForBuild|ensureBuildRetryFeedbackForGoal" packages\opencorvus\src
rg -n "buildUserPrompt|buildRetryFeedbackPrompt|renderUserRequestSection" packages\opencorvus\src
rg -n "decisionLog.append|phase=\"retry\"|phase=\"review\"" packages\opencorvus\src
```

### Active call sites that compose build input

| Location                                                                                                | Current behavior                                                                                                                                                                                                         | Required change                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/build/agent.ts:103` `BuildContext` interface                                   | Carries `requirements`, `frontendDesign`, `contractGraph`, `dependencies`, `retryGuidance`, `retryFeedback`, `acceptanceFeedback`, `fidelity`, `collaborationGoals`, `retryAttachments`. No integrity field.             | Add `integrityFeedback?: string` typed as pre-rendered markdown.                                                                                                                                                                                      |
| `packages/opencorvus/src/build/agent.ts:2206` `buildUserPrompt` (goal target)                           | Renders sections from context in order: requirements → contractGraph → collaborationGoals → dependencies → frontendDesign → designSpecs → fidelity → retryGuidance → retryFeedback → acceptanceFeedback → goal contract. | Add `integrityFeedback` rendering BEFORE `retryGuidance` so it ranks above the orchestrator's hand-typed request. Placement is deliberate: integrity is the workflow gate; its findings outrank the orchestrator's just-now turn.                     |
| `packages/opencorvus/src/build/agent.ts:2388` `buildUserPrompt` (request target)                        | Renders `retryGuidance` (skipped on this branch), `retryFeedback`, `acceptanceFeedback`, `frontendDesign`, `designSpecs`, then `# Delegation` + `# Request` excerpt.                                                     | Add `integrityFeedback` rendering BEFORE the existing `retryFeedback` block on this branch as well.                                                                                                                                                   |
| `packages/opencorvus/src/build/agent.ts:2440` `buildRetryFeedbackPrompt` (continue-session path)        | Used when `existingSessionID` is set; renders `## Current Orchestrator Feedback`, `## Prior Attempt Failure Facts`, `## Acceptance Rejection Feedback`.                                                                  | Add `## Persistent Integrity Findings` from `integrityFeedback`.                                                                                                                                                                                      |
| `packages/opencorvus/src/orchestrator/tools.ts:4904-4998` (goal build context composition)              | Builds `context.requirements`, `context.retryFeedback`, `context.acceptanceFeedback`, `context.retryGuidance`.                                                                                                           | Compose `context.integrityFeedback` from `listIntegrityAttemptArtifacts` plus the shared root-history helper. Pass spec snapshot lineage and render every latest blocking finding as bounded complete text or a build-readable runtime markdown path. |
| `packages/opencorvus/src/orchestrator/tools.ts:5000-5021` (task-level direct build context composition) | Builds `context.acceptanceFeedback` only.                                                                                                                                                                                | Compose `context.integrityFeedback` the same way. This branch is the one all 9 correction-round builds in the bug case go through.                                                                                                                    |
| `packages/opencorvus/src/integrity/replay-context.ts` (proposed in companion spec)                      | Builds replay context for integrity reviewers.                                                                                                                                                                           | This spec REUSES the same `listIntegrityAttemptArtifacts` + `IntegrityPriorAttemptSummary` shape. Single source — do not duplicate the attempt parser.                                                                                                |

### Same-name / sibling functions that must not silently diverge

| Location                                                                               | Current behavior                                                                                                | Required change                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/integrity/agent.ts` (legacy single-agent path)                | Not exported by `integrity/index.ts`.                                                                           | No change. Confirmed not on the live path during rule-35 grep.                                                                                                                                                                                                       |
| `packages/opencorvus/src/acceptance/tools.ts:144,156` (acceptance-triggered integrity) | Same `reviewIntegrity` entrypoint; persisted attempt rows are read by the same `listIntegrityAttemptArtifacts`. | No call-site change needed for acceptance — build context composition lives in orchestrator/tools.ts and runs irrespective of which actor invoked the prior integrity review.                                                                                        |
| `packages/opencorvus/src/build/types.ts` `BuildContractGraphContext`                   | Unrelated context type.                                                                                         | No change.                                                                                                                                                                                                                                                           |
| `packages/opencorvus/src/decision-log/index.ts` `readByPhase("retry")`                 | Used by `latestBuildReportForGoal` and the orchestrator `retryEntries` aggregator.                              | No change. Integrity does NOT write `phase="retry"`; rule 8 stays clean. We do not "smuggle" integrity into the retry channel because doing so collides with the goal-scoped semantics of retry feedback (goal_run terminal status, build_agent_contract_violation). |

### Existing decision_log phases (rule 8 audit)

Listed all `phase=` writers in source. Current phases written: `frontend_design`,
`build`, `review`, `retry`, `acceptance`, `verification`, `decision`,
`exploration`, etc. The integrity verdict already lands in `phase="review"`
(orchestrator/tools.ts:1782). This spec does NOT introduce a new phase or
duplicate the row — `integrityFeedback` reads `engine_artifact` integrity_attempt
rows directly via the shared `listIntegrityAttemptArtifacts` helper, and the
existing `phase="review"` decision_log row continues to serve its purpose
(visible in `read_context` as accumulated audit signal).

## Data Design

### `BuildContext.integrityFeedback`

Add a single optional string field to the interface. The field carries
pre-rendered markdown the orchestrator composed; the build agent renders it
verbatim.

```ts
// build/agent.ts BuildContext
/** Pre-rendered "Persistent Integrity Findings" section. Composed by the
 *  caller (orchestrator/acceptance) from engine_artifact integrity_attempt
 *  rows for this task's spec snapshot lineage and the shared root-history
 *  helper. Empty / undefined when no integrity attempt exists. Rule 8 single
 *  source: the orchestrator owns composition; the build agent reads it. */
integrityFeedback?: string
```

### Composition helper

<!-- removed: finding-id-repeat persistence detection; reason: H-1 requires the shared root-history helper defined by the orchestrator-stuck spec. -->
<!-- removed: active-spec-snapshot-only attempt scope; reason: H-2 requires same-task spec snapshot lineage so corrective snapshots inherit persistent history. -->

Add `composeIntegrityFeedbackForBuild(input)` to
`packages/opencorvus/src/integrity/build-feedback.ts`. It must import and
consume the root-history helper defined by
`orchestrator-stuck-integrity-loop-2026-05-23.md` rather than re-parsing
finding ids locally.

Recommended public shape:

```ts
import type { SharedPromptBudget, SpecSnapshotLineage } from "../integrity/replay-context"

export function composeIntegrityFeedbackForBuild(input: {
  taskID: string
  specSnapshotLineage: SpecSnapshotLineage
  promptBudget: SharedPromptBudget
  runtimeMarkdownDir?: string
}): { promptMarkdown: string; runtimeMarkdownPath?: string } | undefined
```

`SpecSnapshotLineage`, `SharedPromptBudget`, prompt sanitization, and root
identity are not owned by this spec:

- `SpecSnapshotLineage` comes from the replay-aware
  [`SpecSnapshotLineage API`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-specsnapshotlineage-api):
  the same-task active snapshot plus inherited snapshots that were produced
  by integrity correction or `modify_goal` / `architect` refinement. H-2
  requires this lineage so a corrective spec snapshot cannot launder away
  prior persistent blockers.
- `SharedPromptBudget` comes from the replay-aware
  [`Shared Prompt Cap Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-cap-owner).
  This spec must not define local numeric caps.
- Prompt sanitization comes from the replay-aware
  [`Shared Prompt Sanitizer Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-sanitizer-owner).
  This spec must not define local ANSI, bidi, control-character, or markdown
  heading rules.
- Persistent root identity comes only from the root-history helper. Build
  feedback may display finding ids as evidence, but ids are labels, not the
  identity key.

Output shape — markdown with stable section headings the build prompt can
render unchanged:

```markdown
## Persistent Integrity Findings (Treat Blocking Items As Must-Fix)

Integrity has reviewed this task 7 times for the current spec snapshot
lineage (active: spec*..., inherited: spec*...).
The latest verdict is `needs_correction` (R7 at 2026-05-23T14:35:17Z).
This task is not accepted by the workflow gate until every blocking
finding below is repaired and a post-build integrity pass verdict is
recorded.

### Persistent blocking roots (from shared root history)

- **storage-validation** (first seen R2, still reported in R7):
  reviewer ids: rev_storage_security, rev_settings_persistence.
  first seen attempt: R2.
  symptom variations:
  - R2 BF-1: getSettings() does not validate persisted settings.
  - R3 BF-SV1/BF-SV2/BF-SV3: settings validation split across model,
    temperature, and maxTokens.
  - R7 BF-1-settings-validation: same storage-load validation root remains.

### All blocking findings from the latest review

Every blocking finding from the latest non-pass attempt is rendered with
bounded complete text. No blocking finding may be omitted for prompt size.

- **BF-1-settings-validation** (root: storage-validation, R7):
  title: getSettings() does not validate model, temperature, or maxTokens
  against allowed ranges when loading from localStorage.
  evidence: src/services/storage.ts `getSettings()`.
  required repair: Add runtime validation in getSettings() to validate model
  against ALLOWED_MODELS, clamp temperature to [0,2], clamp maxTokens to
  [1,8192], and re-persist corrected values.
  reviewer ids: rev_storage_security, rev_settings_persistence.

### Advisory findings from the latest review

- AF-1: ...
- AF-2: ...

### Source and full-text access

Full audit metadata lives in engine_artifact `art_e5543094c001bg7z5POlCX6rBo`
(R7), but artifact ids are audit metadata only. If the bounded complete
blocking section would exceed the shared prompt budget, the composer writes
the full blocking-feedback markdown to a build-readable runtime path and
renders that path here:

- runtime markdown: `.opencorvus/runtime/integrity-feedback/tsk_.../R7.md`
```

Rules for composition:

- Root identity: call the shared root-history helper from the orchestrator
  spec. Do not implement a second id-repeat or local fingerprint rule.
- Snapshot lineage: pass the same-task spec snapshot lineage to root history.
  The active snapshot alone is insufficient after a corrective `modify_goal`
  or `architect` pass.
- Completeness: all blocking findings from the latest non-pass attempt must
  appear either in the prompt markdown or in a build-readable runtime markdown
  file. A prompt cap may shorten fields to bounded text, but it must not hide
  a blocking finding.
- Runtime materialization: when the complete blocking section does not fit the
  shared prompt budget, write a markdown file under the task runtime workspace
  and render the path. The build agent can read files; it cannot dereference
  `engine_artifact` ids or call orchestrator `read_context`.
- Failure behavior: if the composer cannot render all blocking findings and
  cannot materialize the runtime file, do not dispatch a build with partial
  blocking context. Surface a concrete orchestration error instead.
- Advisory findings are listed but explicitly labeled "advisory" so the
  build LLM can rank them lower than blockers (rule 6.1 — prompt teaches
  the priority; host does not filter).
- When no integrity attempt exists, return `undefined`. The build prompt
  section is dropped.
- Control characters, ANSI escapes, bidirectional controls, and markdown
  heading/control injection in user-provided quotes or reviewer text must be
  rendered through the replay-aware
  [`Shared Prompt Sanitizer Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-sanitizer-owner).
  Do not add a local sanitizer in this helper.

### Why not just dump `team_report_markdown` verbatim?

<!-- removed: artifact-id-only full-review fallback; reason: H-3 proves build agents cannot dereference engine_artifact ids directly. -->

Considered and rejected as the default prompt shape. The full markdown is
18-27 KB; pasting every word into every build prompt costs tokens, repeats
orchestrator-facing language ("choose modify_goal / build / architect /
fail_task") that is misleading inside the build session, and conflates
multiple review rounds.

The replacement rule is stricter than the old distilled-summary approach:
every latest blocking finding must be delivered as bounded complete text.
When prompt budget is tight, only the transport changes: the complete
blocking section is materialized as a runtime markdown file that the build
agent can read. Artifact ids may remain as audit breadcrumbs, never as the
only path to the feedback.

This also matches the principle the integrity-team-replay-aware spec applies
on the reviewer side: structured replay context outranks raw concatenation,
and prompt budget is managed by one shared cap policy rather than local
constants in each spec.

## Build Prompt Wording (build-core.txt)

Add a short section to `packages/opencorvus/src/prompt/core/build-core.txt`
before "## What you do", roughly:

```text
## Integrity-driven rework

The workflow gate is integrity. When the user prompt contains a
"## Persistent Integrity Findings" section, treat its blocking findings as
must-fix: each one has been reported by independent reviewers across one or
more rounds and is blocking workflow completion until repaired. Address every
blocking finding in your implementation OR fail through `report_build_result`
with a concrete blocker that explains why the repair cannot land in this
session. Advisory findings rank below the blockers — fix them only when they
do not pull scope away from the must-fix list.

Do not interpret a finding's age as evidence it was already fixed: persistence
across rounds means previous attempts changed something but the reviewers
still see the underlying defect. Read the named files, run the named
verification, and prove the new behavior in `tests[]`.
```

This is the rule-6.1 teaching: prompt language, no host gate. Pair with the
new prompt section produced by `composeIntegrityFeedbackForBuild` so the
build LLM has both the framing (must-fix language) and the content (which
findings to fix).

## Upstream Wiring

### `orchestrator/tools.ts` build tool — goal branch

After the existing `retryFeedback` / `acceptanceFeedback` composition (current
4945-4979), add:

```ts
const integrityFeedback = composeIntegrityFeedbackForBuild({
  taskID,
  specSnapshotLineage,
  promptBudget,
  runtimeMarkdownDir,
})
```

and include `integrityFeedback` in the constructed `context` (currently
4986-4998). `composeIntegrityFeedbackForBuild` returns `undefined` when no
integrity attempt exists yet; the prompt renderer drops the section in that
case.

### `orchestrator/tools.ts` build tool — task-level direct branch

Same call, same `context` inclusion. The 9 task-level correction builds in
the bug case go through this branch.

### `build/agent.ts` prompt renderer — both targets

Render a `## Persistent Integrity Findings` block (the helper-supplied
markdown is already pre-headed; the renderer just inserts the string and
a trailing blank line) before `retryGuidance` / `retryFeedback` /
`acceptanceFeedback`. Same call in `buildRetryFeedbackPrompt` for the
continue-session path.

### Delete dead intermediate aggregator (rule 17 check)

Audited and confirmed nothing currently parses `team_report_markdown` for
build consumption. No dead code to remove on this change. The decision_log
`phase="review"` row stays — it serves orchestrator-facing audit display
through `read_context` and is independent of build prompt composition
(rule 8 single source: orchestrator reads decision_log; the composer reads
artifact rows via the helper; build reads rendered prompt/runtime markdown).

## Rule 6.1 Self-Check

This design is prompt-over-host:

- No host-side "retry until fixed" gate.
- No host-side max-N / max-round gate (no counter, no threshold, no cap
  on how many times build may be dispatched against the same root —
  that is the LLM's call from the persistent-root facts).
- No host-side decision that a finding is repaired. Root-history assembly
  only groups durable evidence from artifact rows: reviewer ids, finding ids,
  file paths, first-seen attempt, symptom variations, and latest blocking
  text. Verdict on whether a code change actually addressed the finding is
  the LLM's call inside its build / integrity session.
- No keyword matching or auto-injection of remediation steps.
- No state machine ("round N triggers different behavior than round N-1").
- Host code only assembles durable facts from `engine_artifact`
  integrity_attempt rows through the shared root-history helper: root id,
  title, severity, repair text, reviewer ids, spec snapshot lineage, and
  runtime markdown path when needed.
- The build LLM decides which lever to pull from the per-finding evidence;
  the orchestrator LLM decides whether to dispatch build / architect /
  fail_task from the integrity tool result; the integrity reviewers decide
  whether the next-round verdict pass / needs_correction. Three LLM
  decision boundaries, none of them owned by host code.

The companion replay spec covers the reviewer's side of the loop. This spec
covers the build dispatch's side. They share `listIntegrityAttemptArtifacts`
from replay-aware and the root-history helper from orchestrator-stuck
(rule 8 single source) and together close the round-trip: reviewers see
history, build sees the same root history, neither side reconstructs it
through orchestrator LLM summarization.

## Plan Updates From Hazard Audit (2026-05-24)

- H-2 snapshot lineage: `composeIntegrityFeedbackForBuild` must accept the
  same-task spec snapshot lineage, not only the active `spec_snapshot_id`.
  A corrective snapshot created by integrity-driven `modify_goal` /
  `architect` inherits recent old-snapshot persistent history.
- H-11 hook-fix discipline: hook fixes, docs-check fixes, route-check fixes,
  generated-script/helper changes, and OpenAPI/SDK/doc cleanup are
  implementation changes. They require their own rule-35 grep inventory
  before landing, even when they are discovered while making this spec's
  patch.
- H-12/H-14 prompt budget and rendering: use the replay-aware
  [`Shared Prompt Cap Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-cap-owner)
  and
  [`Shared Prompt Sanitizer Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-sanitizer-owner)
  for long review text, user-request quotes, control characters, ANSI
  escapes, bidirectional controls, and markdown heading injection. This spec
  must not create a second cap or sanitizer.
- Test-realism patch: prompt-string tests are insufficient. Add an active
  build-agent stub-LLM test that captures the real rendered build prompt (or
  runtime markdown path) through the dispatch path and verifies every latest
  blocking finding is visible to the stub.

## Implementation Discipline

Every later implementation PR must include a rule-35 grep inventory for both
the intended feature files and any incidental support changes. In particular,
hook-fix / docs check / route check / script helper changes also count as
implementation changes and must grep their call sites, route definitions,
generated artifacts, and sibling helpers before commit. A hook-clean result
does not replace this inventory.

## Test Plan

### Unit tests for the composer

`packages/opencorvus/test/integrity/build-feedback.test.ts`:

- No prior integrity_attempt rows → helper returns `undefined`.
- Single attempt with 2 blocking + 3 advisory findings → markdown contains
  one `### All blocking findings from the latest review` section listing both, an
  `### Advisory findings from the latest review` section listing all
  three, no `### Persistent blocking roots` section, and audit metadata.
- Two attempts where the same root is renamed across finding ids → markdown
  lists the root-history helper's root under `### Persistent blocking roots`
  with first-seen attempt, symptom variations, and reviewer ids; the
  latest-only finding still lands under `### All blocking findings from the
latest review`.
- Multiple spec snapshots present → helper uses the supplied same-task spec
  snapshot lineage, not only the active snapshot. A corrective snapshot must
  inherit recent persistent history from its predecessor.
- Verdict=pass on the latest attempt → helper returns `undefined`
  (no "must-fix" framing when integrity already accepted).
- Helper output is bounded by the shared prompt budget. It never omits a
  latest blocking finding: if complete bounded blocking text does not fit in
  the prompt, the helper materializes a build-readable runtime markdown file
  and renders that path. Artifact id alone is not accepted.
- User/request/reviewer text containing ANSI escapes, bidirectional controls,
  control characters, or markdown headings is rendered through the shared
  sanitizer and cannot inject new prompt sections.

### Build-context wiring tests

`packages/opencorvus/test/orchestrator/tools.test.ts`:

- Add assertions to existing `build` tool tests that
  `composeIntegrityFeedbackForBuild` was called with `{ taskID }` and its
  return value flows into both:
  - goal build's `context.integrityFeedback`
  - task-level direct build's `context.integrityFeedback`.
- Add a test fixture where 2 prior integrity attempts exist, then invoke
  `build({ goalID, request: "fix typo" })` — assert the rendered build
  prompt contains `## Persistent Integrity Findings` BEFORE
  `## Retry Guidance From Orchestrator`.

### Build-prompt rendering tests

`packages/opencorvus/test/build/agent.test.ts` (or the existing build
prompt test file):

- `buildUserPrompt({ kind: "goal", ... }, { integrityFeedback: "..." })`
  → result contains the integrity section above the goal contract and
  above retryGuidance.
- `buildUserPrompt({ kind: "request", ... }, { integrityFeedback: "..." })`
  → result contains the integrity section above `# Delegation`.
- `buildRetryFeedbackPrompt(target, { integrityFeedback: "..." })` →
  result contains a `## Persistent Integrity Findings` section.
- `integrityFeedback: undefined` → the section is absent.

### Active-path stub-LLM regression

Add a fixture that seeds two prior integrity attempts with renamed persistent
root ids, then dispatches a task-level direct build through the orchestrator
test harness with a stub build LLM. The stub captures the exact prompt and
any runtime markdown path it is asked to read. Assert:

- all latest blocking findings are present in the prompt or runtime markdown,
  with title, evidence, required repair, and reviewer ids;
- the persistent root matches the root-history helper output, not local
  finding-id repetition;
- no instruction relies on an `engine_artifact` id as the only way for build
  to retrieve feedback.

### Targeted test commands

```powershell
bun test packages/opencorvus/test/integrity/build-feedback.test.ts packages/opencorvus/test/build/agent.test.ts
bun test packages/opencorvus/test/orchestrator/tools.test.ts
```

Do not run a broad `bun test` unless a later change expands blast radius.

## Regression Risks And Rollback

- Risk: prompt bloat. Mitigation: summarize repair
  text through the replay-aware shared prompt budget, and materialize complete
  blocking feedback to a build-readable runtime markdown file when needed.
  Rollback: revert composer to `undefined` and the section disappears.
- Risk: build LLM treats the new section as advisory and ignores it.
  Mitigation: paired build-core.txt wording explicitly labels blockers
  "must-fix" with `report_build_result(status="failed")` as the escape
  hatch when repair is infeasible. Rollback: tune wording; no host change.
- Risk: orchestrator LLM stops typing concrete request text because it
  assumes the host now forwards full review. Mitigation: existing build
  tool `request` description (orchestrator/tools.ts:4604) still describes
  it as the orchestrator's per-turn guidance; this spec ADDS a parallel
  channel, it does not replace `request`. Both reach the build LLM.
- Risk: helper accidentally renders findings from the wrong snapshot after
  `architect` rewrites the goal graph. Mitigation: require explicit
  same-task spec snapshot lineage and test lineage inheritance. Rollback:
  return to latest-attempt-only rendering until lineage is repaired, rather
  than silently using active-snapshot-only history.

## Implementation Checklist

1. [ ] Add `composeIntegrityFeedbackForBuild` to
       `packages/opencorvus/src/integrity/build-feedback.ts`, depending on the
       shared `listIntegrityAttemptArtifacts` from the replay spec and the
       root-history helper from the orchestrator-stuck spec.
2. [ ] Add `BuildContext.integrityFeedback` to
       `packages/opencorvus/src/build/agent.ts:BuildContext`.
3. [ ] Render `integrityFeedback` in
       `buildUserPrompt` (both `goal` and `request` branches) and
       `buildRetryFeedbackPrompt`, ahead of `retryGuidance` / `retryFeedback`.
4. [ ] Add the "Integrity-driven rework" section to
       `packages/opencorvus/src/prompt/core/build-core.txt`.
5. [ ] Wire the composer into goal-build and task-level-direct branches in
       `orchestrator/tools.ts` (the two `context = {...}` sites at 4986 and
       5012-5019), passing spec snapshot lineage and shared prompt budget.
6. [ ] Add runtime markdown materialization when complete blocking text does
       not fit the shared prompt budget.
7. [ ] Add the test files listed in "Test Plan", including the active-path
       stub-LLM regression.
8. [ ] Run targeted bun test commands; commit with a hook-clean pre-push.

## Plan Updates From Patched Review (2026-05-24)

- B-1: build feedback now links to replay-aware's shared prompt cap owner
  instead of relying on a dangling "shared cap" reference.
- B-2/N-2: `SpecSnapshotLineage` is explicitly imported from replay-aware's
  lineage API; build-uptake does not own or redefine snapshot ancestry.
- N-1: build feedback now links to replay-aware's shared sanitizer owner and
  keeps ANSI/bidi/control/markdown-heading rules out of this spec.
