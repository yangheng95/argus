# Integrity Team Replay-Aware Prompt Plan - 2026-05-23

Status: design draft for implementation. No runtime code is changed by this
document.

This spec follows `CLAUDE.md` rules that matter for this change:

- rule 6.1: when the failure is that the LLM chooses an inefficient review
  path, teach it through prompt context, not host-side gates.
- rule 11: reject designs that hide workflow decisions in code.
- rule 13: do not add state-machine review flow.
- rule 16: no compatibility patch or dual path.
- rule 35: list all grep-discovered call sites before landing a design.
- rule 36: every later code change needs targeted tests.

## Abbreviations

| Term | Meaning |
| ---- | ------- |
| DB | Database: OpenCorvus persistent SQLite storage. |
| LLM | Large Language Model: the model-backed agent runtime. |
| REQ | Requirement row: user-visible requirement identifier projected from requirement storage. |
| SSE | Server-Sent Events: streaming HTTP event format used by chat APIs. |
| UI | User Interface: overlay/runtime display surfaces. |

## User Requirement

Optimize the integrity team review prompt path so the first review chooses
reviewers from the real task surface, and re-review does not burn a full fresh
team rediscovering unchanged blocking findings. The supervisor and reviewers
must see prior integrity attempts and the build evidence produced after the
latest attempt.

Concrete failure observed on task `tsk_e54c2d091001t145QP2P6xwoqi`:

| Round | Artifact time (UTC) | Verdict | Findings | Reviewers | Phase |
| ----- | ------------------- | ------- | -------- | --------- | ----- |
| R1 | 2026-05-23T12:44:15.975Z | needs_correction | 11 | 5 | post_build |
| R2 | 2026-05-23T13:03:45.075Z | needs_correction | 9 | 5 | post_build |
| R3 | 2026-05-23T13:15:53.775Z | needs_correction | 10 | 5 | post_build |
| R4 | 2026-05-23T13:26:25.472Z | needs_correction | 3 | 5 | post_build |

Readonly DB check used:

```sql
SELECT id, time_created, json_extract(payload,'$.verdict') v,
  json_array_length(json_extract(payload,'$.findings')) findings,
  json_array_length(json_extract(payload,'$.reviewers')) reviewers,
  json_extract(payload,'$.phase') phase
FROM engine_artifact
WHERE task_id='tsk_e54c2d091001t145QP2P6xwoqi'
  AND kind='integrity_attempt'
ORDER BY time_created;
```

R3 reported `BF-SV1`, `BF-SV2`, and `BF-SV3` for settings validation. R4 then
reported the same unresolved surface as `BF-1` with five fresh reviewers
because the supervisor prompt had no replay memory and every stream said
`attempt=1`.

## Goals

- First review should select reviewers from the real surface: user request,
  REQ rows, goals, acceptance specs, contract graph, changed files, runtime
  evidence, and scale signals.
- Re-review should see prior verdicts, blocking findings, required repairs,
  prior reviewer focuses, and changed files/evidence since the latest review.
- Re-review should verify whether prior blockers were repaired, not rename an
  unchanged old blocker as a fresh discovery.
- Reviewer count should be prompted from scale and phase: broad first review
  can use more reviewers; narrow re-review can use fewer targeted reviewers.
- The UI and review stream should show the real integrity attempt number.

Non-goals:

- Do not add host-side `max N rounds`.
- Do not make host code decide whether a blocker is truly repaired.
- Do not skip reviewers through keyword matching or old-finding matching.
- Do not add state-machine branching for first review versus re-review.

## Current State

`packages/opencorvus/src/integrity/team-agent.ts` already implements the
adversarial team runtime, but the prompt context is single-turn:

- `buildSupervisorPlanPrompt` only says: choose 2-6 independent reviewers for
  the actual task risk surface.
- `buildReviewerPrompt` only includes assigned focus and the current evidence.
- `buildSupervisorConsensusPrompt` only compares current reviewer reports.
- `buildIntegrityEvidencePrompt` includes request, requirements, requirement
  status, delivery evidence, design specs, goals, contract graph, and decision
  log, but no prior integrity attempts.
- `attempt` is hard-coded to `1` in supervisor planning, supervisor consensus,
  reviewer streaming, soft no-goals event emission, and completed event
  emission.

`packages/opencorvus/src/prompt/core/integrity-team-core.txt` already forbids
fixed dimensions and says the supervisor must choose a dynamic team from the
actual task surface. This plan extends that principle; it does not reintroduce
fixed dimensions or a checklist.

Prompt file check performed:

```powershell
rg -n "Supervisor planning|Independent reviewer|Supervisor consensus|fixed review dimensions|Mutation boundary|final consensus" packages\opencorvus\src\prompt\core\integrity-team-core.txt
```

Important existing core-prompt constraints that this plan must preserve:

- Integrity does not edit files, mutate goals, write memory, or complete the
  task itself.
- The original user request is the audit source; generated rows and delivery
  evidence are evidence, not trusted truth.
- Every finding needs concrete evidence.
- Runtime behavior must be tested when material.
- The final consensus is the only integrity gate output.

## Rule 35 Grep Inventory

Commands run before writing this plan:

```powershell
rg -n "reviewIntegrity|runIntegrityReviewOnce|findLatestIntegrityAttemptArtifact|integrityAttemptVerdict|buildSupervisorPlanPrompt|buildSupervisorConsensusPrompt|buildReviewerPrompt|integrity-team-core" .
rg -n "attempt: \(\) => 1|emitIntegrityEvent\(|function buildSupervisorPlanPrompt|function buildReviewerPrompt|function buildSupervisorConsensusPrompt|function buildIntegrityEvidencePrompt|type ReviewPromptInput|export async function reviewIntegrity|createNoGoalsResult|emitSoftIntegrity" packages\opencorvus\src\integrity\team-agent.ts
rg -n "reviewIntegrity\(|runIntegrityReviewOnce|findLatestIntegrityAttemptArtifact\(|recordIntegrityAttempt\(|IntegrityReviewCompletedPayloadSchema|IntegrityReviewerPlanSchema|attempts" packages\opencorvus\src packages\opencorvus\test specs
```

### Active `reviewIntegrity` Source Call Sites

| Location | Current behavior | Required change |
| -------- | ---------------- | --------------- |
| `packages/opencorvus/src/integrity/team-agent.ts:121` | Active exported team review entrypoint. | Extend input with replay context and real attempt number for task-backed runs. |
| `packages/opencorvus/src/integrity/index.ts:2` | Re-exports `reviewIntegrity` from `team-agent`. | No semantic change; exported input type changes through the same single source. |
| `packages/opencorvus/src/orchestrator/tools.ts:1600` `runIntegrityReviewOnce` | Builds current evidence, then calls review. | Build replay context after `phase` is known and pass it to `reviewIntegrity`. |
| `packages/opencorvus/src/orchestrator/tools.ts:1682` / `1716` | Imports and calls `reviewIntegrity`. | Import helper or build it through integrity export; pass `replayContext`. |
| `packages/opencorvus/src/delivery/tools.ts:144` / `156` | Delivery-triggered integrity review calls the same entrypoint without delivery evidence context. | Build the same replay context and pass it to `reviewIntegrity`; use the same helper, not duplicated extraction. |

### Same-Name Legacy Definition And Tests

| Location | Current behavior | Required change |
| -------- | ---------------- | --------------- |
| `packages/opencorvus/src/integrity/agent.ts:373` | Legacy same-name function, not exported by `integrity/index.ts`. | Do not add replay compatibility to this old path. Before implementation, confirm no active source import remains; if only legacy tests use it, retire/delete in a separate cleanup rather than dual-wiring. |
| `packages/opencorvus/test/integrity/agent.test.ts:*` | Tests import `../../src/integrity/agent`, the legacy implementation. | Not a replay-aware team-agent test. Do not update these as if they covered the active path; either leave until legacy removal or delete with the legacy file in a separate change. |
| `packages/opencorvus/test/orchestrator/tools.test.ts:65,105,1543,...` | Mocks `@/integrity.reviewIntegrity`. | Add assertions that orchestrator passes `replayContext.attemptNumber`, prior findings, and changed files since last review. |
| `packages/opencorvus/test/integrity/team-schema.test.ts:34` | Uses `attempts: 1` payload fixture. | Add a payload fixture for `attempts: 2`; schema itself already permits positive integers. |
| `packages/opencorvus/test/server/task-conversation-routes.test.ts:78` | Event fixture has `attempts: 1`. | Keep if testing first attempt; add/adjust only if route behavior should display attempt #2. |

### Integrity Attempt Storage Call Sites

| Location | Current behavior | Required change |
| -------- | ---------------- | --------------- |
| `packages/opencorvus/src/engine/store.ts:697` `findLatestIntegrityAttemptArtifact` | Returns latest attempt for task/spec/phase. | Add `listIntegrityAttemptArtifacts(input)` as the single query source; make `findLatestIntegrityAttemptArtifact` delegate to the list helper. |
| `packages/opencorvus/src/engine/store.ts:724` `integrityAttemptVerdict` | Extracts verdict from one row. | Keep. Replay helper reads more payload fields but does not change verdict helper. |
| `packages/opencorvus/src/engine/workflow.ts:361` | Uses latest post-build attempt as workflow gate fact. | Keep latest-only gate behavior; do not replace it with replay list. |
| `packages/opencorvus/src/engine/persist.ts:2098` `recordIntegrityAttempt` | Persists append-only attempt payload. | No new field required for attempt count; the ordered artifact list is the source of attempt number. |
| `packages/opencorvus/src/orchestrator/tools.ts:1741` | Records attempt after review. | No persistence schema change; the next review will count this artifact. |
| `packages/opencorvus/src/delivery/tools.ts:174` | Records delivery-triggered attempt. | Same. |
| `packages/opencorvus/test/orchestrator/tools.test.ts:1646,2803,3788,3857,3946,4061,4386` | Reads latest attempt in tests. | Keep latest helper tests; add list helper tests. |
| `packages/opencorvus/test/engine/workflow-integrity-step.test.ts:155,221,289` | Records attempts for workflow step tests. | Keep; add coverage that list helper ordering does not break latest helper. |
| `packages/opencorvus/test/delivery/project-gate.test.ts:853` | Records attempts for delivery gate tests. | Keep; no replay prompt assertion unless delivery integrity caller test is added here. |

### Hard-Coded Attempt Lines In `team-agent.ts`

| Line | Current behavior | Required change |
| ---- | ---------------- | --------------- |
| `team-agent.ts:174` | Supervisor planning stream reports `attempt=1`. | Use `replayContext.attemptNumber`. |
| `team-agent.ts:243` | Supervisor consensus stream reports `attempt=1`. | Use `replayContext.attemptNumber`. |
| `team-agent.ts:403` | Reviewer stream reports `attempt=1`. | Use `replayContext.attemptNumber`. |
| `team-agent.ts:257` | Completed event emits `attempts=1`. | Emit real `replayContext.attemptNumber`. |
| `team-agent.ts:631` | No-goals soft event emits `attempts=1`. | Pass real attempt number into `emitSoftIntegrity`. |

## Data Design

Add a helper module:

`packages/opencorvus/src/integrity/replay-context.ts`

Recommended public shape:

```ts
export type IntegrityPriorAttemptSummary = {
  attemptNumber: number
  artifactID: string
  timeCreated: number
  phase?: "pre_build" | "post_build"
  verdict?: "pass" | "concerns" | "needs_correction"
  summary?: string
  reviewers: Array<{ reviewerID: string; scope: string; verdict?: string }>
  blockingFindings: Array<{
    id: string
    title: string
    description: string
    repair: string
    filePaths: string[]
    requirementIDs: string[]
    specIDs: string[]
  }>
  requiredRepairs: Array<{ id: string; description: string; filePaths: string[] }>
  unresolvedDisagreements: Array<{ id: string; description: string }>
}

export type IntegrityBuildEvidenceSinceLastReview = {
  sinceAttemptNumber?: number
  sinceTimeCreated?: number
  changedFiles: string[]
  diffs: Array<{ file: string; status?: string; additions?: number; deletions?: number }>
  deliverySummaries: string[]
  goalRuns: Array<{
    goalID: string
    goalRunID: string
    status: string
    timeCreated: number
    timeCompleted?: number | null
  }>
}

export type IntegrityReviewScaleSignals = {
  goals: number
  requirements: number
  acceptanceSpecs: number
  changedFilesTotal: number
  changedFilesSinceLastReview: number
  priorAttempts: number
  priorBlockingFindings: number
  phase?: "pre_build" | "post_build"
}

export type SpecSnapshotLineage = {
  taskID: string
  activeSpecSnapshotID: string
  inheritedSpecSnapshotIDs: string[]
  reason: "active_only" | "integrity_correction_lineage"
}

export type IntegrityReplayContext = {
  attemptNumber: number
  lineage: SpecSnapshotLineage
  priorAttempts: IntegrityPriorAttemptSummary[]
  buildEvidenceSinceLastReview: IntegrityBuildEvidenceSinceLastReview
  scaleSignals: IntegrityReviewScaleSignals
}
```

The helper should expose:

```ts
export function buildIntegrityReplayContext(input: {
  taskID: string
  lineage: SpecSnapshotLineage
  phase?: "pre_build" | "post_build"
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  deliveries: DeliveryRow[]
  goalRuns: GoalRunRow[]
}): IntegrityReplayContext

export function renderIntegrityReplayContextPrompt(context: IntegrityReplayContext): string

export type IntegrityAttemptArtifactRow = {
  artifactID: string
  taskID: string
  specSnapshotID: string
  timeCreated: number
  payload: unknown
}

export function listIntegrityAttemptArtifacts(input: {
  taskID: string
  lineage: SpecSnapshotLineage
  phase?: "pre_build" | "post_build"
}): IntegrityAttemptArtifactRow[]
```

Attempt numbering source:

- Add `listIntegrityAttemptArtifacts({ taskID, lineage })` in
  `engine/store.ts`, where `lineage` is the same-task
  `SpecSnapshotLineage` above.
- Count same-task attempts across the active snapshot plus inherited
  corrective snapshots from that list; current attempt is `priorAttempts.length
  + 1`.
- Do not use a separate counter table or host max-round setting.
- Do not rely on `payload.attempt_number`; artifact order is the source.

Phase handling:

- Replay memory should list prior attempts for the same task and supplied spec
  snapshot lineage, with each attempt's `phase` rendered.
- Workflow gates may still use `findLatestIntegrityAttemptArtifact({ phase:
  "post_build" })`. That is a different data-integrity question from prompt
  replay and should stay latest-only.

Build evidence since last review:

- If prior attempts exist, use the newest prior attempt's `time_created` as
  the lower bound.
- Include delivery rows and goal-run rows with evidence newer than that bound.
- Extract changed files from `delivery.result.changed_files`,
  `delivery.result.changedFiles`, and `delivery.result.diffs[].file`, matching
  the existing orchestrator extraction.
- Host code must not label a repair as successful or failed. It only renders
  what changed after the prior review.

No `team-schema.ts` output expansion is required. `IntegrityReviewerPlanSchema`
and `IntegrityTeamReportSchema` describe LLM submissions, not prompt input.
The existing completed payload already has `attempts: positive int`; only the
value changes from hard-coded `1` to the real attempt number.

## `team-agent.ts` Change List

Extend `ReviewPromptInput` with replay context:

```ts
type ReviewPromptInput = {
  ...
  replayContext: IntegrityReplayContext
}
```

Extend `reviewIntegrity` input:

```ts
export async function reviewIntegrity(input: {
  ...
  replayContext: IntegrityReplayContext
})
```

All active callers must pass `replayContext`. Task-backed callers build it from
DB artifacts. Direct unit tests construct an explicit first-attempt context in
their fixture. Do not hide a production fallback that silently recreates
`attempt=1`.

Update dynamic attempt use:

- Compute `const attemptNumber = input.replayContext.attemptNumber`.
- Use it in all `createReviewReasoningForwarder` callbacks.
- Use it in `emitReviewStreamProgress`.
- Pass it to `emitIntegrityEvent`.
- Pass it into `emitSoftIntegrity` for the no-goals path.

Prompt functions keep their names but render new sections through the extended
input:

- `buildSupervisorPlanPrompt(input: ReviewPromptInput)` renders
  `renderIntegrityReplayContextPrompt(input.replayContext)`, then adds scaling
  guidance before the full evidence dossier.
- `buildReviewerPrompt(input: ReviewPromptInput, scope)` renders
  `renderIntegrityReplayContextPrompt(input.replayContext)` plus
  reviewer-specific re-review instructions.
- `buildSupervisorConsensusPrompt(input, plan, reports)` renders
  `renderIntegrityReplayContextPrompt(input.replayContext)` before current
  reviewer reports so consensus can mark persistent blockers.
- `buildIntegrityEvidencePrompt(input)` stays the current evidence dossier
  (request, requirements, delivery evidence, goals, contract graph, decision
  log). Keeping replay rendering in the three role prompts avoids duplicated
  replay sections.

Tool description update:

```text
Submit a dynamic adversarial reviewer plan with 2-6 independent reviewers.
Use the task scale and replay context: broad first reviews may need more
reviewers, narrow re-reviews may need fewer targeted reviewers. Do not default
to five reviewers and do not use fixed dimensions.
```

## Upstream Wiring

### `orchestrator/tools.ts` `runIntegrityReviewOnce`

After `phase` is computed and before `reviewIntegrity` is called:

- Import `buildIntegrityReplayContext` and `listGoalRunsForTask` through the
  existing integrity/store boundaries.
- Reuse `deliveriesForAcceptance` already loaded by `findDeliveriesForTask`.
- Build `replayContext` with task id, active spec id, phase, goals,
  requirements, deliveries, and goal runs.
- Pass `replayContext` into `reviewIntegrity`.

This caller is the main task-backed path and should get the strongest test
coverage.

### `delivery/tools.ts` `runDeliveryIntegrityReview`

Use the same helper:

- Import or access `findDeliveriesForTask` and `listGoalRunsForTask`.
- Build `replayContext` for the active spec.
- Pass `replayContext` into `reviewIntegrity`.

Do not duplicate changed-file extraction in delivery. The helper is the single
source for replay context assembly.

### Tests And Mocks

`packages/opencorvus/test/orchestrator/tools.test.ts` mocks
`reviewIntegrity`. Update the mock expectations where integrity is invoked so
the tests fail if `replayContext` is omitted.

Add delivery-triggered coverage if no existing test exercises
`runDeliveryIntegrityReview` with the mocked `reviewIntegrity` input.

## Prompt Design

### Shared Rendered Section

Add one rendered section to every supervisor/reviewer prompt:

```markdown
# Integrity Replay Context

Current integrity attempt: #2.

Prior attempts for this task/spec:
- Attempt #1 at 2026-05-23T12:44:15.975Z, phase=post_build,
  verdict=needs_correction, reviewers=5.
  Reviewer focuses:
  - rev_streaming_api: DeepSeek SSE streaming implementation...
  - rev_error_resilience: Error handling & runtime resilience...
  Blocking findings:
  - BF-1: Stop-generation loses all partial AI response content.
    repair: Fix abort path and stale streaming text reference.

Build evidence after latest integrity attempt:
- Changed files: src/services/storage.ts, src/contexts/SettingsContext.tsx
- Delivery summaries: ...
- Goal runs after latest review: goal_settings completed at ...

Scale signals:
- goals=5
- requirements=9
- acceptance_specs=...
- changed_files_total=50
- changed_files_since_last_review=3
- prior_attempts=1
- prior_blocking_findings=2
```

If there are no prior attempts, render that fact explicitly:

```markdown
# Integrity Replay Context

Current integrity attempt: #1.
No prior integrity attempts exist for this task/spec snapshot. Treat this as a
first review and choose reviewers from the actual request, goals, requirements,
changed files, runtime evidence, and risk surface.
```

### Supervisor Planning Wording

First review wording:

```text
This is the first integrity review for the current task/spec snapshot. Build
the reviewer team from the task's actual risk surface. Use the scale signals:
larger goal/REQ/changed-file surfaces should push the plan toward more
reviewers; narrow surfaces can use fewer. Do not default to five reviewers.
Do not use fixed dimensions or a stock checklist.
```

Re-review wording:

```text
This is a re-review. Start from the prior blocking findings, required repairs,
and prior reviewer focuses. Your plan should verify whether prior blockers were
actually repaired using the build evidence since the latest review, then cover
new or changed risk surfaces. Do not spend a fresh full team rediscovering the
same unchanged blocker. If a prior blocker still appears unresolved, assign a
reviewer to verify it as persistent with evidence rather than renaming it as a
new finding.
```

Reviewer count scaling wording:

```text
Choose 2-6 reviewers. Use 2-3 when this is a narrow re-review with a small
changed-file set and a small number of prior blockers. Use 4-6 when this is a
first review, when the task spans many goals/requirements/acceptance specs, or
when changed files cross several runtime surfaces. Avoid substantial overlap
with prior reviewer focuses; as a prompt guideline, more than about one-third
overlap needs a rationale tied to persistent blockers or changed repair
evidence.
```

This is prompt guidance, not a host gate. The schema remains `min(2).max(6)`.

### Reviewer Wording

First review wording:

```text
No prior integrity attempt exists for this task/spec. Review your assigned
surface independently. Use evidence from files, diffs, commands, runtime
checks, requirements, goals, and the original request.
```

Re-review wording:

```text
You are reviewing attempt #N, not starting from zero. Prior findings and
required repairs are evidence. First check whether the prior blockers relevant
to your scope were repaired in the files/evidence changed since the latest
review. If the same blocker remains, report it as persistent and cite both the
prior finding id and current evidence. Then inspect new risk introduced by the
repair. Do not relabel an unchanged prior blocker as a brand-new discovery.
```

### Supervisor Consensus Wording

Add before current reviewer reports:

```text
Compare the current reviewer reports against prior attempts. A repeated
blocking finding should be represented as persistent or regressed when the
evidence supports that conclusion. Do not pass while a prior blocking repair
has no convincing current evidence. Do not suppress a prior blocker merely
because current reviewers used a different id.
```

Consensus still comes from the LLM and the submitted team report. Host code
does not match ids or keywords to force a verdict.

## Rule 6.1 Self-Check

This design is prompt-over-host:

- No host-side `max N rounds`.
- No host-side "old blocker fixed" or "old blocker not fixed" verdict.
- No keyword matching to skip reviewers.
- No coded rule that blocks a reviewer focus because it overlaps an old focus.
- No state machine for first review versus re-review.
- Host code only assembles durable facts: prior attempt rows, reviewer scopes,
  findings, required repairs, changed files, goal-run timestamps, and counts.
- The LLM decides reviewer plan, repair verification, persistence, and final
  consensus from those facts.

Data-integrity checks remain acceptable under rule 6.1: Zod schemas, required
task-backed replay context, and artifact query filters are data shape
constraints, not teaching the LLM which route to take.

## Test Plan

### Unit Tests For Replay Helper

Add `packages/opencorvus/test/integrity/replay-context.test.ts`:

- No prior attempts returns `attemptNumber=1`, empty `priorAttempts`, and scale
  counts from the supplied goals/requirements/deliveries.
- Two prior attempts return `attemptNumber=3` in chronological attempt order,
  with reviewer ids/scopes, blocking findings only, required repairs, and phase.
- Evidence since latest review includes only delivery/goal-run rows newer than
  the latest prior attempt.
- Changed files are extracted from `changed_files`, `changedFiles`, and
  `diffs[].file` with de-duplication.
- `listIntegrityAttemptArtifacts` ordering is newest-first and
  `findLatestIntegrityAttemptArtifact` delegates without changing workflow
  behavior.

### Prompt Rendering Tests

Add snapshot-style tests around `renderIntegrityReplayContextPrompt`:

- First review render contains `Current integrity attempt: #1` and the "No
  prior integrity attempts" sentence.
- Re-review render contains prior verdict, prior reviewer focus, prior blocking
  finding id/title, required repair, changed files since latest review, and
  scale signals.
- Renderer does not include separate dimension language or a fixed checklist.

### Integration Test

Add a team-agent prompt test by intercepting `runAgentSession` in the active
team-agent path:

- Construct attempt #2 input with one prior `integrity_attempt` artifact that
  contains a blocking settings validation finding.
- Add a later delivery row with `src/services/storage.ts` changed.
- Invoke `reviewIntegrity` through the orchestrator integrity path or a direct
  team-agent test fixture.
- Assert the captured supervisor planning prompt includes:
  - `Current integrity attempt: #2`
  - prior finding title or id
  - prior required repair text
  - previous reviewer id/focus
  - `src/services/storage.ts`
  - scale signals

### Caller Coverage

- `packages/opencorvus/test/orchestrator/tools.test.ts`: add/adjust a mock
  assertion that `reviewIntegrity` receives `replayContext` from
  `runIntegrityReviewOnce`.
- Delivery-triggered integrity review: add a test if no existing one captures
  its `reviewIntegrity` input.
- `packages/opencorvus/test/integrity/team-schema.test.ts`: add positive
  coverage for `attempts: 2`.
- Stream/event test: assert `integrity.review.completed.attempts` and
  `review.stream.progress.attempt` both use the same non-1 value.
- No-goals path test: task-backed no-goals soft event emits the real attempt
  number instead of `1`.

Targeted commands after implementation:

```powershell
bun test packages/opencorvus/test/integrity/replay-context.test.ts packages/opencorvus/test/integrity/team-schema.test.ts
bun test packages/opencorvus/test/orchestrator/tools.test.ts
```

If delivery-triggered coverage lands in a separate delivery test file, include
that file in the targeted run. Do not run broad `bun test` unless a later code
change expands the blast radius enough to justify it.

## Regression Risks And Rollback

First review path:

- Risk: new replay section adds noise even when there are no prior attempts.
- Mitigation: render a short first-review paragraph and scale signals only.
- Rollback: remove replay section rendering from first-attempt prompts; no DB
  migration involved.

Re-review path:

- Risk: helper scopes attempts too broadly and injects stale findings from a
  different task or unrelated spec snapshot.
- Mitigation: list attempts by same-task `SpecSnapshotLineage`; render phase
  and active/inherited snapshot ids explicitly.
- Rollback: revert helper wiring and prompt section in one commit; artifacts
  remain append-only and valid.

No-goals path:

- Risk: early return continues emitting `attempts=1` because it bypasses the
  supervisor sessions.
- Mitigation: compute/pass replay context before the no-goals return and pass
  attempt number into `emitSoftIntegrity`.
- Rollback: no schema rollback needed; event attempts remains a positive int.

UI attempt display:

- Risk: one stream path still uses hard-coded `1`, causing UI inconsistency.
- Mitigation: one test captures completed event plus supervisor/reviewer stream
  attempt values for attempt #2.
- Rollback: revert dynamic attempt wiring only if stream consumers break; the
  replay prompt helper can remain independently.

Reviewer count behavior:

- Risk: prompt guidance overcorrects and chooses too few reviewers for a broad
  re-review.
- Mitigation: scaling language says changed/new cross-surface risk should push
  toward 4-6 reviewers.
- Rollback: tune prompt text; no host logic changes required.

## Implementation Checklist

1. [ ] Add `listIntegrityAttemptArtifacts` and tests; make latest helper
   delegate to it.
2. [ ] Add `integrity/replay-context.ts` helper and unit tests.
3. [ ] Add prompt renderer snapshot tests for first review and re-review.
4. [ ] Extend `team-agent.ts` input types and replace all hard-coded attempt
   values.
5. [ ] Add replay sections to supervisor planning, reviewer, and consensus
   prompts.
6. [ ] Wire `runIntegrityReviewOnce` in `orchestrator/tools.ts`.
7. [ ] Wire `runDeliveryIntegrityReview` in `delivery/tools.ts`.
8. [ ] Update mocks/tests for all active `reviewIntegrity` callers.
9. [ ] Add integration test for attempt #2 prompt contents.
10. [ ] Run targeted integrity/orchestrator/delivery tests.

## Plan Updates From Patched Review (2026-05-24): Shared Prompt Cap Owner

This spec is the single owner of prompt-growth capping for integrity replay,
integrity-derived build feedback, orchestrator integrity history rendering,
and severity/maturity replay context. Consumer specs may pass their own
surface name and rendered facts, but they must not define numeric caps.

Shared cap constants:

```ts
export type SharedPromptBudget = {
  totalTokenCap: 12000
  totalCharCap: 48000
  maxRenderedPriorAttempts: 8
  latestAttemptFullTextCharCap: 16000
  persistentRootsCharCap: 12000
  changedEvidenceCharCap: 10000
  oldAttemptSummaryCharCap: 800
  findingDescriptionCharCap: 2400
  findingRepairCharCap: 1600
}
```

Rules:

- `totalTokenCap=12000` is the semantic budget for all replay-derived prompt
  additions on one prompt surface. `totalCharCap=48000` is the deterministic
  fallback when no tokenizer is available. The renderer must cap by whichever
  limit is reached first.
- Render at most `maxRenderedPriorAttempts=8` prior attempts with text.
  Attempts outside that window are represented only by artifact id, attempt
  number, verdict, timestamp, and an `omitted_due_to_shared_prompt_cap`
  summary of at most `oldAttemptSummaryCharCap=800` characters.
- The latest prior attempt gets first priority and must render every latest
  blocking finding with bounded complete text. A field may be clipped to the
  per-field caps above, but the finding itself cannot disappear. If all latest
  blocking findings cannot fit, the caller must materialize a runtime markdown
  file and render its path rather than silently omit findings.
- Persistent roots get second priority. Roots present in the latest attempt
  and roots with repeated lineage history render before older one-off roots.
- Changed files and build/delivery evidence since the latest attempt get
  third priority. File paths and current changed-file evidence render before
  old reviewer prose.
- Older attempts get only pointer + summary after the three priority classes
  above. Old full `team_report_markdown` text is never concatenated into the
  prompt after the cap is reached.
- This is a rendering cap only. It is not a host-side max-round counter and
  must not affect whether another integrity review, build, question, or
  failure lane is allowed.

Shared API surface for build/orchestrator/severity:

```ts
export type SharedPromptSurface =
  | "integrity_replay"
  | "build_integrity_feedback"
  | "orchestrator_integrity_history"
  | "severity_context"

export type SharedPromptCapInput = {
  surface: SharedPromptSurface
  lineage: SpecSnapshotLineage
  latestAttempt?: IntegrityPriorAttemptSummary
  persistentRoots?: Array<{
    rootID: string
    canonicalLabel: string
    firstSeenAttempt: number
    latestSeenAttempt: number
    consecutiveAttempts: number[]
    latestSeverity: "blocking" | "advisory"
    symptomSummaryMarkdown: string
  }>
  changedFiles: string[]
  changedEvidenceMarkdown?: string
  oldAttempts: IntegrityPriorAttemptSummary[]
  reviewerTextBlocks?: string[]
  userRequestQuotes?: string[]
  runtimeMarkdownDir?: string
}

export type SharedPromptCapOutput = {
  promptMarkdown: string
  capHit: boolean
  omittedAttempts: Array<{
    attemptNumber: number
    artifactID: string
    verdict?: string
    summary: string
  }>
  runtimeMarkdownPath?: string
  sanitizerReport: SanitizedPromptTextReport
}

export function getSharedIntegrityPromptBudget(): SharedPromptBudget

export function renderSharedIntegrityPromptContext(
  input: SharedPromptCapInput,
): SharedPromptCapOutput
```

`buildIntegrityReplayContext` still builds the raw replay facts. The shared
cap renderer is the only function that decides what subset is safe to place
directly in a prompt.

## Plan Updates From Patched Review (2026-05-24): SpecSnapshotLineage API

`SpecSnapshotLineage` is the single replay-aware type for same-task spec
snapshot ancestry. It is the active spec snapshot plus ordered predecessor
snapshots that were produced by integrity correction, `modify_goal`, or
architect refinement inside the same task. It never crosses `taskID`.

```ts
export type SpecSnapshotLineage = {
  taskID: string
  activeSpecSnapshotID: string
  inheritedSpecSnapshotIDs: string[]
  reason: "active_only" | "integrity_correction_lineage"
}

export type IntegrityAttemptArtifactRow = {
  artifactID: string
  taskID: string
  specSnapshotID: string
  timeCreated: number
  payload: unknown
}

export type BuildIntegrityReplayContextInput = {
  taskID: string
  lineage: SpecSnapshotLineage
  phase?: "pre_build" | "post_build"
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  deliveries: DeliveryRow[]
  goalRuns: GoalRunRow[]
}

export function buildIntegrityReplayContext(
  input: BuildIntegrityReplayContextInput,
): IntegrityReplayContext

export function listIntegrityAttemptArtifacts(input: {
  taskID: string
  lineage: SpecSnapshotLineage
  phase?: "pre_build" | "post_build"
}): IntegrityAttemptArtifactRow[]
```

Backwards impact: the already-implemented replay-aware code path that still
accepts `specSnapshotID: string` must be upgraded in a later implementation
PR. This spec patch does not require code changes, but future code must not
keep an adapter that silently falls back to active-snapshot-only history.
Build-uptake and orchestrator-stuck specs import `SpecSnapshotLineage` from
this replay-aware API instead of defining their own lineage type.

## Plan Updates From Patched Review (2026-05-24): Shared Prompt Sanitizer Owner

This spec is also the single owner of sanitization for untrusted text rendered
into integrity-related prompt sections. The sanitizer runs before the shared
prompt cap so removed or escaped characters cannot consume budget
unpredictably.

Accepted input:

- JavaScript string / UTF-8 text containing Unicode scalar values. Human
  language text, including Chinese and other non-ASCII scripts, is preserved.
- Newline, carriage return, and horizontal tab are accepted as layout
  characters. All other C0/C1 control characters are escaped or removed as
  below.

Rejected or escaped input:

- Null bytes become `[NUL REMOVED]`.
- ANSI escape sequences beginning with `ESC [` or `ESC ]` are removed and
  counted in `removedAnsiEscapes`.
- Bidirectional controls such as U+202A..U+202E and U+2066..U+2069 become
  visible markers like `[BIDI U+202E REMOVED]`.
- Other control characters in U+0000..U+001F and U+007F..U+009F, except
  newline/carriage-return/tab, become `[CTRL U+00XX REMOVED]`.
- Markdown control injection is neutralized for untrusted block text:
  leading ATX headings (`#`), fenced-code delimiters, HTML block starts,
  horizontal rules, and setext heading underlines are escaped or rendered
  inside a quoted block so they cannot create new prompt sections.

Length limits before the shared cap:

- one literal user-request quote: 2000 characters;
- one finding description: 2400 characters;
- one required-repair text: 1600 characters;
- one reviewer prose block: 3000 characters;
- any other raw untrusted text segment: 12000 characters.

Shared API:

```ts
export type SanitizedPromptTextReport = {
  text: string
  truncated: boolean
  originalChars: number
  renderedChars: number
  removedAnsiEscapes: number
  removedControls: number
  removedBidirectionalControls: number
  escapedMarkdownControls: number
}

export function sanitizeIntegrityPromptText(input: {
  text: string
  field:
    | "user_request_quote"
    | "finding_description"
    | "finding_repair"
    | "reviewer_text"
    | "changed_evidence"
    | "generic"
  maxChars?: number
  markdownContext: "inline" | "block"
}): SanitizedPromptTextReport
```

Build feedback, orchestrator history, severity context, and scope/user-request
quote rendering must call this sanitizer by reference. They must not define
local ANSI, bidi, control-character, or markdown-heading rules.

## Plan Updates From Patched Review (2026-05-24)

- B-1/N-1: added the shared prompt cap owner and shared sanitizer owner in
  this replay-aware spec; consumer specs must reference these sections rather
  than declare local caps or sanitizer rules.
- B-2/N-2: upgraded replay-aware helper APIs from `specSnapshotID` to
  `SpecSnapshotLineage` and documented the later implementation PR needed to
  sync already-landed code.
