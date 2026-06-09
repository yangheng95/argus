# Orchestrator stuck in integrity build-and-retry loop — 2026-05-23

Status: spec only. No runtime code is changed by this document.

This spec follows `CLAUDE.md` rules that matter for this change:

- **rule 6.1** (prompt-over-host-invariant): the bug is "orchestrator LLM
  picks the wrong lane (build) over the right lane (fail_task / propose_task
  / restart_from_stage)". The fix is prompt + read_context fact assembly,
  **not** a host-side `max_consecutive_integrity_attempts` truncator, a
  "force fail after N rounds" gate, or any state machine. Host changes are
  limited to **fact assembly** (shared root-history helper rendered in
  `read_context`). Lane choice stays prompt-driven (rule 6.1, rule 13).
- **rule 8** (no double source): the existing `integrity_attempt` artifact
  - `decision_log phase=review` rows already store the cross-round signal.
    Do not add a parallel "stuck loop counter" or "loop-detection" service.
    Diff the existing rows in `read_context` only.
- **rule 11** (reject anti-OOP designs from yourself): the seductive
  fix is "in code, if same blocking finding ID repeats N times, force
  fail". Reject — that is rule 13 state-machine territory.
- **rule 13** (no state machines): no `loop_state` enum, no host-side
  branching on consecutive roots. The helper may render consecutive-attempt
  counts as facts; it must not choose a lane.
- **rule 35** (full grep before landing): the file-level grep audit is in
  §6.
- **rule 36** (test all changes, not just fixes): every prompt/read_context
  change ships with the tests enumerated in §7.

## Abbreviations

| Term              | Meaning                                                      |
| ----------------- | ------------------------------------------------------------ |
| DB                | Database: SQLite persistent storage.                         |
| LLM               | Large Language Model.                                        |
| BF / AF           | Blocking Finding / Advisory Finding (integrity team report). |
| R1..R8            | Integrity review rounds 1..8 in the analysed task.           |
| read_context      | Orchestrator's read-only context refresh tool.               |
| integrity_attempt | `engine_artifact.kind='integrity_attempt'` row.              |

## TL;DR

Task `tsk_e54c2d091001t145QP2P6xwoqi` ran 8 post-build integrity rounds.
Rounds 2-7 (six consecutive rounds) flagged the same blocking finding
(`getSettings()` not validating model/temperature/maxTokens from
localStorage). After every non-pass verdict the orchestrator chose
`build({ request, directBuildIntent: "modify_files" })` again — never
`fail_task`, never `propose_task`, never `restart_from_stage("plan")`,
never `architect`, never `question`.

Three converging root causes:

1. **Fact starvation per round**: between R2 and R6 the orchestrator
   never called `read_context scope=all`. Every non-pass decision was
   made against the **single integrity tool return** of that round.
   That return truncates `team_report_markdown` at
   `SubAgentProtocol.SAFE_BODY_CAP ≈ 17.5k chars` with the marker
   `[+N chars truncated; full content at integrity session ses_…]`,
   so the orchestrator saw the "Executive Summary / Resolved blockers"
   header but the "Persistent blocking findings" body was cut off.
2. **`read_context scope=evaluations` returned empty** when the
   orchestrator did try to refresh at R6 — because integrity_attempt
   rows are surfaced under `scope=all` only (the `## Integrity (latest)`
   block at the bottom), not under `scope=evaluations`. The
   orchestrator interpreted "No context available yet." as "no extra
   signal" and dispatched build anyway.
3. **No cross-round comparison** is rendered anywhere. Even
   `scope=all` only renders the **latest** `integrity_attempt`
   payload. The decision_log `phase=review` rows that DO accumulate
   round-by-round are surfaced only when `scope=decisions|all` is
   asked, AND each row is a flat one-line `verdict=… findings=N |
top: [blocking] X` string — not a structured "finding ID X has
   appeared in rounds R2 R3 R4 R5 R6 R7" diff.

The prompt section "Integrity Correction" already mentions "after
repeated non-pass integrity reviews … route to owner … question only
when external … fail_task only when no responsible same-task repair
remains." That sentence existed during this run and did not fire.
Reason: the orchestrator could not **see** the repetition. It is
not insufficient prompt rules; it is insufficient evidence to
trigger those rules.

## Hazard Audit Integration (2026-05-24)

Hazard audit rewrites in this spec:

- [`3.1 Shared root-history helper in read_context (host fact assembly)`](#31-shared-root-history-helper-in-read_context-host-fact-assembly):
  H-1 replaces the local read_context-only fingerprint with a shared helper
  that build-uptake must also consume.
- [`3.3 Orchestrator prompt — Integrity Correction section`](#33-orchestrator-prompt--integrity-correction-section):
  H-7 clarifies that host-rendered `>= 3 consecutive` roots are facts only;
  lane choice remains LLM prompt work. The `modify_goal` lane is also
  narrowed per claude path B: it may clarify or narrow acceptance, not expand
  task scope.
- [`4. Rule 6.1 boundary — host vs prompt`](#4-rule-61-boundary--host-vs-prompt):
  rewritten to name the exact category-a host facts and the category-b lane
  decisions that remain forbidden in host code.

Plan updates appended in
[`Plan Updates From Hazard Audit (2026-05-24)`](#plan-updates-from-hazard-audit-2026-05-24):
H-2 spec snapshot lineage, H-8 cancel/event-ordering race, hook-fix rule-35
discipline, and active-path stub-LLM verification.

Cross-reference: this spec owns the single `root-history helper` schema and
API. Build-uptake consumes it and must not create a second persistent-root
definition. Replay-aware remains the attempt-listing, `SpecSnapshotLineage`,
shared prompt cap, and sanitizer source:
[`SpecSnapshotLineage API`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-specsnapshotlineage-api)
and
[`Shared Prompt Cap Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-cap-owner).

## 1. Diagnostic Timeline

Evidence: `engine_artifact.kind='integrity_attempt'`,
`decision_log phase=review`, orchestrator session
`ses_1ab3d291effeqT8ofY3QCaiglW` parts.

### 1.1 Per-round summary

| R   | Time (UTC) | Verdict          | Reqs | Findings | New blocking finding IDs                                                                            | Carried-forward (same root)                       |
| --- | ---------- | ---------------- | ---- | -------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| R1  | 12:44:15   | needs_correction | 4    | 11       | BF-1..BF-5 (stop-gen, conv-switch, regen, key-empty, key-validate)                                  | —                                                 |
| R2  | 13:03:45   | needs_correction | 2    | 9        | BF-1 (settings-validate), BF-2 (key-network)                                                        | (R1 BF-1 fixed)                                   |
| R3  | 13:15:53   | needs_correction | 4    | 10       | BF-SV1..SV4, BF-EH1, BF-TEST2 (renamed; **same settings-validate root**)                            | BF-1 from R2 ≡ BF-SV1 from R3                     |
| R4  | 13:26:25   | needs_correction | 3    | 3        | BF-1 (settings-validate again), BF-2 (system-prompt), BF-3                                          | BF-1 R2 ≡ BF-1 R4                                 |
| R5  | 13:55:00   | needs_correction | 2    | 10       | CONSENSUS-BF1..BF3 (renamed)                                                                        | BF-1 settings-validate continues                  |
| R6  | 14:21:01   | needs_correction | 2    | 11       | SV-1..SV-3 (renamed) + new build-broke                                                              | BF-1 settings-validate continues                  |
| R7  | 14:35:17   | needs_correction | 2    | 8        | **BF-1-settings-validation** (text now explicitly says "persisted across 6 consecutive rounds 2-7") | BF-1 settings-validate continues                  |
| R8  | 14:46:27   | needs_correction | 2    | 7        | BF-1 (quota), BF-2 (welcome-input) — R2-R7 finding finally fixed                                    | first round where the multi-round finding is gone |

R2-R7 = 6 consecutive rounds with identical root cause (under different
finding IDs because each review team renamed it). User cancelled at
14:51 (cancelled=true in task metadata).

### 1.2 Orchestrator tool-call timeline (full)

Pulled from `part` rows in `ses_1ab3d291effeqT8ofY3QCaiglW`.

| t (UTC)     | tool                                   | input head                                                                            | notes                                                                     |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 12:15:15    | explore                                | "What is the current project structure…"                                              | initial sweep                                                             |
| 12:15:38    | requirements                           | greenfield AI chat                                                                    |                                                                           |
| 12:16:32    | architect                              | 5 goals                                                                               |                                                                           |
| 12:18:38    | read_context                           | scope=goals                                                                           | pre-build only                                                            |
| 12:18-12:27 | build × 5                              | one per goal                                                                          | parallel-ish                                                              |
| 12:35:21    | **read_context scope=all**             |                                                                                       | last full refresh until 14:51                                             |
| 12:35:24    | integrity                              | first call → R1                                                                       |                                                                           |
| 12:44:16    | build (directBuildIntent=modify_files) | "5 Blocking Bug Fixes"                                                                | post-R1                                                                   |
| 12:51:24    | integrity → R2                         |                                                                                       |                                                                           |
| 13:03:46    | build (modify_files)                   | "2 Remaining Blocking Findings"                                                       | post-R2                                                                   |
| 13:07:30    | integrity → R3                         |                                                                                       |                                                                           |
| 13:15:54    | explore                                | "Read the current state of these files…"                                              | exploratory — not read_context                                            |
| 13:16:27    | build (modify_files)                   | "Round 3 Corrections"                                                                 | post-R3                                                                   |
| 13:18:51    | integrity → R4                         |                                                                                       |                                                                           |
| 13:26:38    | build (modify_files)                   | "Round 4: Fix All 3 Remaining…"                                                       | post-R4                                                                   |
| 13:38:54    | integrity → R5                         |                                                                                       |                                                                           |
| 13:55:11    | build (modify_files)                   | "Round 5: Fix TypeScript Build Error…"                                                | post-R5                                                                   |
| 14:02:00    | integrity → R6                         |                                                                                       |                                                                           |
| 14:21:03    | **read_context scope=evaluations**     | output: **"No context available yet."**                                               | first refresh attempt in 5 rounds; surfaced nothing                       |
| 14:21:11    | explore                                | "Check the current state of these specific areas…"                                    | falls back to file-read                                                   |
| 14:23:19    | integrity → R7                         |                                                                                       | (premature: explore did not change files)                                 |
| 14:35:18    | build (modify_files)                   | "Persistent blocking finding across 6+ integrity rounds: getSettings() in storage.ts" | finally addresses the right file, but in **build** lane, not fail/restart |
| 14:37:42    | integrity → R8                         |                                                                                       | R2-R7 finding fixed but new ones surface                                  |
| 14:46:29    | explore                                | "Read the full content of these files…"                                               |                                                                           |
| 14:47:36    | build (modify_files)                   | "Integrity round 8: 2 remaining blocking findings"                                    |                                                                           |
| 14:50:00    | integrity → R9 (errored)               | tool returned error                                                                   |                                                                           |
| 14:51:17    | user message (cancel)                  |                                                                                       | user gives up                                                             |
| 14:51:22    | read_context scope=all                 |                                                                                       |                                                                           |
| 14:51:30    | build (modify_files)                   | one more build                                                                        |                                                                           |
| 15:03-15:04 | explore + build                        |                                                                                       | task already cancelled                                                    |

Key observation: **between R2 (13:03) and R6 (14:21) the orchestrator
never refreshed task context.** Eight build/integrity tool calls in
this window, all decided from each round's per-round integrity tool
return.

### 1.3 What the orchestrator actually saw per round

R6 explicit refresh attempt — `read_context scope=evaluations`:

```
output: "No context available yet."
```

Found at part of `msg_e55360298001dcdtEUlMPbcfTh`, 14:21:03Z. The
orchestrator's `reasoning` chunk immediately afterwards explicitly
says it had to "infer from the truncated summary":

> The integrity review round 6 found 2 required repairs, but the
> summary says "one persists." Let me look at what the blocking
> findings are. The report is truncated but mentions that one blocking
> finding from prior rounds persists.

R7 reasoning chunk (`msg_e55430e3e0017nvynUIh5sSVt3`, post-R7):

> Now I can see the persistent issue clearly! It's in
> `src/services/storage.ts` … I've been adding validation in
> `deepseekApi.ts` (`validateSettings`) and in `SettingsPanel.tsx`
> (onBlur validation), but the reviewers want validation at the
> **storage loading point**.

The R7 reasoning ONLY surfaces "this is persistent" after the round-7
integrity output explicitly says "persisted across 6 consecutive
integrity review rounds (rounds 2-7)". The orchestrator finally
diagnoses the repetition — five rounds late — and still picks
`build` instead of escalating, because the prompt offers no decision
rule keyed off "I have now seen the same finding 6 times".

### 1.4 Tool-output truncation evidence

Integrity tool return is composed via `SubAgentProtocol.yieldResult`
in `packages/opencorvus/src/orchestrator/tools.ts:1545-1561`. Cap is
`SAFE_BODY_CAP = HARD_CHAR_CAP - POINTER_RESERVE ≈ 17.5k chars`.
Every R1-R8 tool output in the orchestrator session shows the
marker:

```
[+17913 chars truncated; full content at integrity session ses_…]
[+26458 chars truncated; full content at integrity session ses_…]
[+21441 chars truncated; full content at integrity session ses_…]
…
```

The body that was cut off includes (per R7 markdown verified in
`engine_artifact.payload.team_report_markdown`):

- Explicit cross-round table: "persisted across rounds 2, 3, 4, 5, 6, 7"
- Per-finding repair attempts each round and why they did not land
- Reviewer convergence statistics

None of that reached the orchestrator turn that had to choose the
next lane.

## 2. Root cause

The orchestrator prompt's "Integrity Correction" section already
contains the right rule:

> After repeated non-pass integrity reviews with the same root issue,
> first route the concrete blocker to the owner that can repair it
> inside this task. Call `question` only when the blocker is
> genuinely external to the repository or requires destructive/user
> approval; call `fail_task` only when no responsible same-task
> repair remains.

The rule did not fire because **the orchestrator could not detect
"same root issue across rounds"** from the inputs available at
decision time. Three concrete failure modes, in priority order:

| #   | Failure mode                                                                                                                                                                                                                                                     | Where                                                              | Fix lane                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| F1  | `read_context scope=all` is the only place integrity_attempt is surfaced, and it surfaces only the **latest** row (1 of N). No diff.                                                                                                                             | `orchestrator/tools.ts:3840-3884`                                  | **host fact assembly** (rule 6.1 host-side category a) |
| F2  | `scope=evaluations` does not include integrity_attempts (those are artifacts, not engine_evaluation rows). Returns empty when the orchestrator probes for "what is the verdict history".                                                                         | `orchestrator/tools.ts:3752-3788` (uses `findEvaluationsByTask`)   | host fact assembly                                     |
| F3  | Even if the orchestrator had the cross-round diff, the prompt does not give a concrete decision criterion: "same finding root across ≥ 3 consecutive non-pass rounds where each round's repair touched the right file" → escalate; not the count, the **shape**. | `prompt/core/orchestrator-core.txt` "Integrity Correction" section | **prompt** (rule 6.1 host-invariant — no max-N gate)   |
| F4  | `fail_task` and `propose_task` tool descriptions are one-liners. Orchestrator has no anchor for "when would I pick this" beyond the prompt's general guidance.                                                                                                   | `orchestrator/tools.ts:3938-3953` and 4466-4485                    | prompt + tool description                              |

F1 + F2 are pure fact-assembly: render the **set of finding root
labels per round** so the orchestrator can see "R2 R3 R4 R5 R6 R7
all show {settings-validate-storage}". This is rule 6.1 host-side
category (a) (data completeness — the diff is a deterministic
projection, no judgement). It is NOT a "force escalate after N"
gate.

F3 + F4 are pure prompt work (rule 6.1 — teach lane choice through
prompt).

## 3. Design

### 3.1 Shared root-history helper in read_context (host fact assembly)

<!-- removed: read_context-only fingerprint design; reason: H-1 requires one root-history helper shared with build-uptake. -->
<!-- removed: active-spec-snapshot-only history filter; reason: H-2 requires same-task spec snapshot lineage so corrective snapshots inherit persistent history. -->

Add one shared helper module:

`packages/opencorvus/src/integrity/root-history.ts`

This helper is the only implementation that groups integrity findings into
persistent roots. `read_context`, build-uptake feedback, and any future
debug rendering must consume it. They may choose different render shapes, but
they must not implement their own id-repeat or fingerprint logic.

Recommended public API:

```ts
import type { SpecSnapshotLineage } from "./replay-context"

export type IntegrityRootSymptomVariation = {
  attemptNumber: number
  artifactID: string
  findingID: string
  title: string
  description: string
  filePaths: string[]
  requirementIDs: string[]
  specIDs: string[]
}

export type IntegrityPersistentRoot = {
  rootID: string
  canonicalLabel: string
  reviewerIDs: string[]
  firstSeenAttempt: number
  latestSeenAttempt: number
  consecutiveAttempts: number[]
  symptomVariations: IntegrityRootSymptomVariation[]
  latestSeverity: "blocking" | "advisory"
}

export type IntegrityRootHistory = {
  taskID: string
  specSnapshotLineage: SpecSnapshotLineage
  totalAttempts: number
  attempts: IntegrityPriorAttemptSummary[]
  persistentBlockingRoots: IntegrityPersistentRoot[]
  latestBlockingFindings: IntegrityRootSymptomVariation[]
}

export function buildIntegrityRootHistory(input: {
  taskID: string
  specSnapshotLineage: SpecSnapshotLineage
  phase?: "pre_build" | "post_build"
}): IntegrityRootHistory
```

Required input / output surface:

- Input is `taskID` plus `specSnapshotLineage`. Active
  `spec_snapshot_id` alone is insufficient after a corrective `modify_goal`
  or `architect` snapshot, because H-2 shows that active-only filtering
  launders old persistent history.
- Output includes a persistent root list with `reviewerIDs`,
  `firstSeenAttempt`, `latestSeenAttempt`, `consecutiveAttempts`, and
  `symptomVariations`. Finding ids stay inside symptom variations; they are
  evidence labels, not identity.
- Persistence storage is not a new table. Source rows are existing
  `engine_artifact.kind='integrity_attempt'` rows fetched through
  replay-aware's `listIntegrityAttemptArtifacts`. If a cache is ever added,
  it is derived data and cannot become a second source of truth.
- Root grouping is deterministic fact assembly. A finding root may be grouped
  by file/symbol plus normalized title/description similarity, but the helper
  must be conservative: uncertain matches remain separate roots with their
  own symptom variations.

`read_context` renders this helper under `scope=all` and a new dedicated
`scope=integrity_history`, as part of `## Integrity (history)` BELOW the
existing `## Integrity (latest)` block:

```
## Integrity (history) — rendered attempts on this spec snapshot lineage

Round N (most recent first):

| R | Δt from prev | Verdict | Reviewers | Blocking root labels | New since prev round |
| - | ------------ | ------- | --------- | -------------------- | -------------------- |
| R8 | 11m | needs_correction | 4 | {storage-quota-silent, welcome-input-missing} | both new (R2-R7 root resolved) |
| R7 | 14m | needs_correction | 5 | {settings-validate-storage} | none (carry from R2-R6) |
| R6 | 26m | needs_correction | 4 | {settings-validate-storage, build-broken-ts2345} | build-broken new |
| R5 | 28m | needs_correction | 4 | {settings-validate-storage, build-broken-ts2345} | build-broken new |
| R4 | 10m | needs_correction | 5 | {settings-validate-storage, system-prompt-missing} | system-prompt new |
| R3 | 12m | needs_correction | 5 | {settings-validate-storage, …} | … |
| R2 | 19m | needs_correction | 5 | {settings-validate-storage, key-network-error} | settings-validate first appears |
| R1 | — | needs_correction | 5 | {stop-gen-stale-closure, conv-switch, regen, key-empty, key-validate} | first round |

Persistent blocking roots (>= 3 consecutive attempts; fact assembly only):
- {settings-validate-storage}: R2 R3 R4 R5 R6 R7.
  first seen: R2.
  latest seen: R7.
  reviewer ids: rev_storage_security, rev_settings_persistence.
  symptom variations: R2 BF-1; R3 BF-SV1/BF-SV2/BF-SV3; R7 BF-1-settings-validation.
- (none >= 3 in the latest 2 rounds)

Total post-build integrity rounds on this spec snapshot lineage: 8
Each round's full team_report_markdown is in engine_artifact (integrity_attempt rows; sessions listed above).
Rendering bounds are supplied only by the replay-aware shared prompt cap; this
orchestrator spec does not define an attempt-count limit.
```

Implementation outline (no code in this spec, only shape):

- Resolve `SpecSnapshotLineage` through the replay-aware API from the current
  task/spec metadata. When a new snapshot is created as an integrity
  correction, include the recent predecessor snapshot ids in
  `inheritedSpecSnapshotIDs`.
- Fetch attempts via replay-aware's `listIntegrityAttemptArtifacts`, filtered
  to the lineage and ordered by time. Do not apply a local attempt-count cap
  inside root-history; prompt rendering is bounded only by the replay-aware
  shared prompt cap.
- Extract blocking findings plus reviewer ids from each attempt payload.
- Group into roots conservatively and compute consecutive attempt numbers.
- Render facts only: root label, attempts, reviewer ids, first/latest seen,
  symptom variations. The history block does not name a tool and does not say
  "escalate now".

#### 3.1.1 Integrity artifact persistence failure protocol

If the integrity tool completes a reviewer/team session but the
`engine_artifact.kind='integrity_attempt'` artifact cannot be persisted, the
system must not silently continue from the previous artifact as if it were the
latest verdict. The session/child logs prove that a newer integrity attempt
exists; missing artifact persistence is therefore a data-integrity failure, not
an ordinary non-pass verdict.

Protocol:

1. The host immediately marks the integrity session status as
   `artifact_missing`. This host status is allowed by rule 6.1 category (a):
   it records data completeness for an already-finished tool session. It does
   not choose an orchestrator lane.
2. `read_context` and the next orchestrator decision point must surface the
   `artifact_missing` signal from the integrity session status. The single
   source is that session status; do not add a second recovery flag in
   decision_log or a parallel "latest verdict" table.
3. Until the missing artifact is recovered or the user explicitly confirms how
   to proceed with the missing result, the orchestrator must not dispatch a new
   build based on `R(N-1)` as the latest verdict. This is a data-completeness
   barrier: the LLM still decides the recovery lane from the surfaced facts,
   but the host must not act on stale integrity data as though it were current.
4. Recovery paths, in order of preference:
   - Retry the artifact persistence using the completed integrity result.
   - Rebuild the artifact from the integrity session log / child result log,
     preserving the original attempt timestamp and reviewer/team evidence.
   - If the artifact cannot be reconstructed, ask the user through the normal
     `question` lane whether to rerun integrity, continue from stale data, or
     stop the task.

Acceptance for this protocol explicitly forbids: after integrity_attempt
artifact missing, orchestrator continues dispatch as if R(N-1) was the latest
verdict.

Why root-history belongs in code, not prompt: integrity reviewers
demonstrably rename the same root across rounds (R2 BF-1 → R3 BF-SV1 →
R4 BF-1 → R5 CONSENSUS-BF1 → R6 SV-1 → R7
BF-1-settings-validation). Asking the LLM to re-derive root history from raw
markdown every turn is token-expensive and inconsistent. Per rule 6.1
host-side category (a), pure data-shape projection is host-side. **This is
the only category (a) work in this fix.** Everything that decides a lane
stays in the prompt.

Bound the section size through the replay-aware
[`Shared Prompt Cap Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-cap-owner).
The root-history helper builds facts over the lineage; only the shared prompt
cap decides how much text is rendered directly. Full audit lives in
`engine_artifact`.

### 3.2 Decoupling `scope=evaluations` from the empty path

The orchestrator at R6 asked `scope=evaluations`. Returning "No
context available yet." when integrity attempts exist is wrong: the
orchestrator's intent in that probe was "show me verdict history",
not strictly "show me engine_evaluation rows". Two options:

- Option A — render the integrity history section under
  `scope=evaluations` too. Single source of truth, no double path.
- Option B — return a pointer: "No engine_evaluation rows. Did you
  mean integrity history? Call scope=integrity_history or
  scope=all."

Option A wins (rule 8: do not maintain a parallel `evaluations`
section that needs separate keeping-in-sync with integrity_history).
Drop the empty fallback. When integrity_attempts exist for this
spec snapshot, scope=evaluations returns the integrity history
block plus, if any, the legacy engine_evaluation block.

### 3.3 Orchestrator prompt — Integrity Correction section

Edit `prompt/core/orchestrator-core.txt`, "Integrity Correction"
section (lines 358-394). Add two paragraphs.

Replace the existing "After repeated non-pass integrity reviews
with the same root issue, first route the concrete blocker to the
owner that can repair it inside this task. Call `question` only
when the blocker is genuinely external to the repository or
requires destructive/user approval; call `fail_task` only when no
responsible same-task repair remains."

With (additions in **bold** below — final text is plain prose, no
markdown bold in the actual prompt):

> **Repetition is a lane signal, not a count signal.** The
> `## Integrity (history)` block in `read_context` lists every
> integrity round on the current spec snapshot lineage (the
> supplied `SpecSnapshotLineage`, not active snapshot only) with
> normalised blocking root labels and a "Persistent blocking roots" list. A
> root label that appears in ≥ 3 consecutive rounds AND whose
> latest round's repair was a `build({ request,
directBuildIntent: "modify_files" })` targeting the right file
> — yet the next integrity round flagged the same root — is the
> shape that means the build lane has stopped converging on this
> root. Continuing to dispatch `build` against the same root is
> the loop CLAUDE.md rule 27 forbids ("禁止补丁式修复").
>
> When the history block shows that shape, the next dispatch must
> NOT be `build` against the same root. Reason from the persistent
> root's location:
>
> - If the root is **inside an owned goal contract** (the goal's
>   `acceptance_specs` or `owned_paths` defines the surface) but
>   the contract does not describe the validation the reviewer
>   keeps demanding, call `modify_goal` only to narrow or clarify
>   that existing acceptance contract, then dispatch `build({ goalID })`
>   with the corrected contract. `modify_goal` must not add a new
>   capability, new surface, or broader task scope; if the root needs
>   expanded scope, use `propose_task` or `question` instead. This is
>   the path that produces architecturally-traceable repair instead of
>   patch-on-patch.
> - If the root is **outside every goal contract** (no goal owns
>   the surface), call `architect` to add the missing
>   prerequisite goal, then build it normally.
> - If the root requires **external user approval** (credentials,
>   destructive ambiguity, install rights), call `question` with
>   the exact persistent finding evidence.
> - If the root is **fundamentally outside this task contract**
>   (the original user request never asked for the missing
>   capability, and the repository cannot infer it), call
>   `propose_task` so the user can authorise a follow-up task —
>   do NOT continue burning rounds on something out of scope.
> - If every responsible same-task lane has been tried in earlier
>   rounds and the integrity history shows each attempted lane
>   did not resolve the root, call `fail_task` with the integrity
>   history excerpt as evidence.
>
> **Negative example (the anti-pattern this rule blocks):** seeing
> "settings-validate-storage" persistent across R2 R3 R4 R5 R6 R7
> and dispatching a seventh `build({ request, directBuildIntent:
"modify_files" })` "this time aimed at the right file." The
> build lane has had six chances to converge on this root; the
> evidence proves the goal contract or the task contract is wrong,
> not the build dispatch.
>
> **Negative example (do not over-escalate either):** seeing
> "stop-generation-stale-closure" in R1 and immediately picking
> `fail_task`. One round is not a loop. The escalation rule needs
> ≥ 3 **consecutive** rounds with the **same root**.

This carries no numeric "max rounds" host gate. The prompt names
the pattern, the LLM picks the lane. Per rule 6.1, lane choice
stays in the prompt.

### 3.4 fail_task / propose_task / restart_from_stage descriptions

Keep `fail_task`'s schema as-is (single `error` string). Extend
its tool description:

Current (`orchestrator/tools.ts:3939`): `"Mark the task as failed. Use when the task cannot be completed."`

New: `"Terminal task lifecycle decision: mark the task as failed when no responsible same-task repair remains for evidence the orchestrator can see. Typical triggers: (a) integrity history shows ≥ 3 consecutive rounds with the same persistent blocking root AND modify_goal / architect / question have already been tried inside this task for the same root; (b) a hard external blocker the repository cannot supply (missing credentials the user already declined to provide, hardware unavailable). Not for: a single non-pass integrity round, a transient build error, or a guess that the task is hopeless without integrity evidence. Pair with concrete history excerpt in the error field, including the persistent-root label from read_context Integrity history."`

Current (`propose_task` description, ~`orchestrator/tools.ts:4467`):
already mentions "follow-up scope before another integrity review"
in spec. Extend with:

> Use `propose_task` when integrity history shows the persistent
> root is **outside** the current task contract — i.e. the
> reviewers keep demanding a capability the original user request
> never authorised the system to add, and adding it inside the
> current task would expand scope beyond what the user agreed to.
> Example: user asked for "a chat page", reviewers keep demanding
> a settings export/import feature for the third consecutive
> round; that is a separate task to propose, not a build round to
> burn.

`restart_from_stage` already has a stage-by-stage description; the
"Integrity Correction" prompt update covers when to use `plan`
vs `requirements` vs `executor`. No description change needed
beyond the prompt rule above.

Add the same `modify_goal` narrowing rule to the `modify_goal` tool
description: it may clarify or tighten acceptance for an existing goal, but
scope expansion must route through `propose_task` or `question`.

## 4. Rule 6.1 boundary — host vs prompt

<!-- removed: host-rendered "not converging" lane signal; reason: H-7 requires the history block to assemble facts only and leave lane choice to the LLM. -->

| Concern                                                                                                                     | Lane       | Why                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read integrity_attempt rows for this task's spec snapshot lineage                                                           | host       | data access                                                                                                                                                                                                                                         |
| Build conservative root-history groups from ids, titles, descriptions, file paths, symbols, reviewer ids, and attempt order | host       | category (a) — deterministic data projection; LLM should not re-fingerprint each turn (token waste, rule 6 minimal-engineering applies in reverse)                                                                                                  |
| Compute "appears in ≥ 3 consecutive rounds" as an output field                                                              | host       | category (a) — deterministic fact assembly, not route choice                                                                                                                                                                                        |
| Render the "Persistent blocking roots" list in read_context                                                                 | host       | category (a) — facts only: attempts, reviewer ids, first/latest seen, symptom variations                                                                                                                                                            |
| Mark a completed integrity session `artifact_missing` when its `integrity_attempt` artifact failed to persist               | host       | category (a) — data completeness for durable artifact storage; not a lane decision                                                                                                                                                                  |
| Block stale-verdict build dispatch while the latest integrity session is `artifact_missing`                                 | host       | category (a) — do not act on `R(N-1)` as current data when `R(N)` exists but its artifact is missing; recovery/user confirmation is required before dispatch                                                                                        |
| Decide that the right action is `fail_task` vs `propose_task` vs `modify_goal` vs `architect` vs `question`                 | **prompt** | category (b) judgement; rule 6.1 host-invariant — never a host route bypass / preflight max-N gate                                                                                                                                                  |
| Stop the orchestrator after N integrity rounds                                                                              | **NEVER**  | this would be the rule 6.1 anti-pattern: a host gate "teaching the LLM the path". The orchestrator MUST be allowed to call build a 7th time if the evidence honestly justifies it (e.g. R7 introduced a new root and R8 has only flagged it twice). |
| Auto-escalate to `fail_task` after the persistent-root pattern                                                              | **NEVER**  | same reason. Host renders the diff; LLM decides.                                                                                                                                                                                                    |

H-7 rule-13 challenge result: this design is compliant only because the host
assembles facts and does not branch on them. The history block must not render
"not converging", "escalate", "modify_goal", "fail_task", or any other lane
recommendation. It may render `consecutiveAttempts=[2,3,4,5,6,7]` because
that is an observation over stored artifacts. The prompt update in §3.3 is
the only place lane-choice guidance lives, and the LLM may still choose build
if it can justify that the latest evidence is a new root or a genuinely new
repair path.

## 5. Decision log: what the orchestrator should write per round

Already implemented via `decision_log` `phase=review` append in
`orchestrator/tools.ts:1772-1793`. Keep the existing append, but
when the new history block is rendered (§3.1), also include a
`persistent_roots` field next to `top: …`. Shape:

```
verdict=needs_correction | reviewers=4 | findings=11 | required_repairs=2 | unresolved=0 | persistent_roots=[settings-validate-storage(6)] | top: [blocking] getSettings()…
```

This makes the per-round one-line log self-contained for any other
consumer (integrity team prompt, debug tooling) that does not call
`read_context`.

## 6. Grep audit (rule 35)

Files that must be touched / verified untouched by the eventual
implementation:

| Path                                                                        | Action | Reason                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/integrity/root-history.ts`                         | add    | shared root-history helper consumed by `read_context` and build-uptake; no second persistent-root implementation                                                 |
| `packages/opencorvus/src/orchestrator/tools.ts` ~line 3700-3935             | edit   | `read_context` execute body — new history section under scope=all and scope=evaluations; ditch the empty-eval fallback                                           |
| `packages/opencorvus/src/orchestrator/tools.ts` ~line 3938-3953             | edit   | `fail_task` description extension                                                                                                                                |
| `packages/opencorvus/src/orchestrator/tools.ts` ~line 4466-4500             | edit   | `propose_task` description extension                                                                                                                             |
| `packages/opencorvus/src/orchestrator/tools.ts` `modify_goal` registration  | edit   | tool description must say `modify_goal` narrows/clarifies acceptance only; scope expansion routes through `propose_task` / `question`                            |
| `packages/opencorvus/src/orchestrator/tools.ts` ~line 1772-1793             | edit   | append `persistent_roots` to the per-round decision_log review row                                                                                               |
| `packages/opencorvus/src/orchestrator/tools.ts` ~line 1545-1561             | leave  | integrity tool return shape stays — full markdown still lives at `pointer`; the cross-round signal moves to read_context where it belongs                        |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` (lines 358-394) | edit   | Integrity Correction additions per §3.3                                                                                                                          |
| `packages/opencorvus/src/engine/persist.ts` (`recordIntegrityAttempt`)      | edit   | on artifact write failure, surface failure so the integrity session can be marked `artifact_missing`; do not report a usable latest verdict without the artifact |
| Integrity session persistence / session status writer                       | edit   | add the single `artifact_missing` data-integrity status consumed by `read_context` and orchestrator decision refresh                                             |
| `packages/opencorvus/src/decision-log/index.ts`                             | leave  | review-phase rendering already works; just feed it the new `persistent_roots` field via the existing key/value contract                                          |
| `packages/opencorvus/src/agent/sub-agent-protocol.ts`                       | leave  | trimText / yieldResult caps stay; the new history block is sized against the same caps                                                                           |
| `packages/opencorvus/src/engine/store.ts` (`findEvaluationsByTask`)         | leave  | function semantics unchanged; read_context branch above stops misusing it as the integrity history source                                                        |

Grep verification commands the implementer must run before commit:

```
rg -n "kind = 'integrity_attempt'|kind == \"integrity_attempt\"" packages/opencorvus/src
rg -n "rootHistory|root-history|persistent root|SpecSnapshotLineage|spec_snapshot" packages/opencorvus/src packages/opencorvus/test packages/opencorvus/specs
rg -n "scope === \"evaluations\"|scope==='evaluations'" packages/opencorvus/src
rg -n "fail_task" packages/opencorvus/src/prompt packages/opencorvus/src/orchestrator
rg -n "propose_task" packages/opencorvus/src/prompt packages/opencorvus/src/orchestrator
rg -n "modify_goal" packages/opencorvus/src/prompt packages/opencorvus/src/orchestrator
rg -n "recordIntegrityAttempt|integrity_attempt|artifact_missing|session status" packages/opencorvus/src packages/opencorvus/test packages/opencorvus/specs
rg -n "Integrity Correction" packages/opencorvus/src/prompt
```

Each hit gets a "keep / extend / replace" annotation in the eventual
PR description (rule 35).

## Plan Updates From Hazard Audit (2026-05-24)

- H-2 snapshot lineage: root history must be built over same-task spec
  snapshot lineage from replay-aware's
  [`SpecSnapshotLineage API`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-specsnapshotlineage-api).
  A snapshot generated by integrity correction inherits the recent
  predecessor attempts for persistent-root rendering; active-only filtering
  is forbidden for root history.
- H-8 cancel/event-ordering race: before dispatching a build after any child
  integrity/build result, the orchestrator must check whether the task was
  cancelled after the child started. A late child result may be recorded for
  audit, but it must not trigger another build dispatch without explicit user
  confirmation. This is a data-ordering barrier, not a lane-selection state
  machine.
- H-11 hook-fix discipline: hook fixes, docs-check fixes, route-check fixes,
  generated-script/helper changes, and OpenAPI/SDK/doc cleanup are
  implementation changes. They require their own rule-35 grep inventory
  before landing.
- H-12 prompt budget: root-history/read_context rendering must consume the
  replay-aware
  [`Shared Prompt Cap Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-cap-owner)
  and
  [`Shared Prompt Sanitizer Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-sanitizer-owner).
  Do not introduce a second cap or sanitizer for history rendering.
- Test-realism patch: prompt-string tests are insufficient. Add an active-path
  orchestrator stub-LLM test that receives a rendered root-history block and
  chooses a lane through normal tool calling, proving the host did not bypass
  the LLM and the prompt/context actually reaches the model boundary.

## Implementation Discipline

Every later implementation PR must include a rule-35 grep inventory for both
the intended feature files and any incidental support changes. In particular,
hook-fix / docs check / route check / script helper changes also count as
implementation changes and must grep their call sites, route definitions,
generated artifacts, and sibling helpers before commit. A hook-clean result
does not replace this inventory.

## Implementation Checklist

1. [ ] Add `packages/opencorvus/src/integrity/root-history.ts` as the only
       persistent-root grouping helper, importing `SpecSnapshotLineage` from the
       replay-aware API.
2. [ ] Wire `read_context scope=all`, `scope=evaluations`, and the new
       `scope=integrity_history` to render the §3.1 integrity history block from
       the shared helper.
3. [ ] Replace the empty `scope=evaluations` path with integrity history when
       integrity attempts exist, without changing `findEvaluationsByTask`
       semantics.
4. [ ] Extend the orchestrator Integrity Correction prompt section with the
       §3.3 lane-choice guidance; keep host output fact-only.
5. [ ] Extend `fail_task`, `propose_task`, and `modify_goal` descriptions per
       §3.4.
6. [ ] Append `persistent_roots=[...]` to review-phase decision log values
       using the shared root-history output.
7. [ ] Render history through the replay-aware shared prompt cap and sanitizer;
       do not add local attempt-count, label-count, ANSI, bidi, or heading rules.
8. [ ] Add the `artifact_missing` recovery protocol from §3.1.1: persist the
       session status on artifact write failure, render it through `read_context`,
       and prevent stale-verdict build dispatch until recovery or explicit user
       confirmation.
9. [ ] Add all §7 fact-assembly, decision-log, prompt wiring, tool
       description, no-host-gate, active-path, and cancel-ordering tests.
10. [ ] Verify §9 acceptance items 1-12, especially single root-history owner,
        fact-only rendering, cancel barrier, artifact-missing recovery, and no
        integrity max-N host counter.
11. [ ] Run the targeted orchestrator tests listed in §7.

## 7. Tests (rule 36)

All new tests live under
`packages/opencorvus/test/orchestrator/`. None already covers
"stuck integrity loop", per
`rg -n "stuck|persistent.*finding|integrity.*history" packages/opencorvus/test`.

### 7.1 Fact assembly (host)

`integrity-history-readcontext.test.ts`

- Seed an engine_task with 3 integrity_attempt artifacts, where finding ids
  and titles vary by round but reference the same file/symbol in the
  description. Assert the shared root-history helper outputs one persistent
  root with reviewer ids, `firstSeenAttempt`, and symptom variations; assert
  read_context (scope=all) renders that helper output.
- Same seed, only 2 rounds in a row → assert the section EXISTS
  but `Persistent blocking roots: (none ≥ 3 consecutive)`. Negative
  test guards over-fitting.
- 5 rounds, all DIFFERENT roots → assert `(none ≥ 3 consecutive)`.
- 4 rounds where root X appears in R1, R2, gap (R3 different), R4
  → assert NOT marked persistent (must be consecutive).
- Active snapshot plus predecessor snapshot in the same task lineage → assert
  root history includes both snapshots. Active-only filtering must fail this
  test.
- read_context scope=evaluations with 0 engine_evaluation rows
  but 3 integrity_attempt rows: assert output renders the
  integrity history section, NOT "No context available yet."
- Assert the rendered history block does not contain lane recommendation
  words such as `fail_task`, `modify_goal`, `propose_task`, `escalate`, or
  `not converging`.

### 7.2 Decision_log persistent_roots field

`decision-log-review-persistent-roots.test.ts`

- Drive `recordIntegrityAttempt + the append-review block` for 3
  consecutive rounds with the same root; assert the 3rd row's
  value field contains `persistent_roots=[<label>(3)]`.

### 7.3 Prompt rule wiring

`orchestrator-core-prompt.test.ts` (existing or new)

- Assert the rendered orchestrator prompt contains the literal
  phrase "Persistent blocking roots" — so if a future refactor
  drops the integrity-history rendering, the prompt rule's
  cross-reference does not silently dangle.

### 7.4 fail_task / propose_task description tests

`orchestrator-tool-descriptions.test.ts`

- Snapshot the rendered tool description for fail_task; assert
  it contains "integrity history" and "persistent blocking root".
- Same for propose_task: assert it contains "outside the current
  task contract".

### 7.5 Regression: do not introduce a host-side max-N gate

`no-host-side-integrity-loop-counter.test.ts`

- Grep guard test: `rg -n "consecutiveIntegrity|integrityAttemptCount|integrity.*max" src/orchestrator src/engine` must return 0 matches. Rule 6.1 / rule 13 guard against the obvious post-fix regression.

### 7.6 End-to-end orchestrator regression (recorded turn)

`orchestrator-stuck-loop-regression.test.ts`

- Replay (fixture-based, no live LLM) an orchestrator turn where
  read_context contains the persistent-root section for
  {settings-validate-storage}(6). Inject a stub LLM that asserts
  the prompt+history reach the model boundary, then returns a normal
  tool call. Assert the host executes the stub's chosen lane and does not
  override it through a max-N or persistent-root gate. This is an active-path
  prompt/context assembly test, not a live model quality test.

### 7.7 Cancel/event ordering regression

`orchestrator-cancel-late-child-result.test.ts`

- Start a child integrity/build result, mark the task cancelled with a later
  timestamp, then deliver the child result. Assert the result can be recorded
  for audit but no new build is dispatched after cancellation without an
  explicit user message.

### 7.8 Integrity artifact missing recovery regression

`orchestrator-integrity-artifact-missing-recovery.test.ts`

- Simulate an integrity tool run whose reviewer/team session completes and
  child logs exist, but `recordIntegrityAttempt` fails before writing the
  `engine_artifact.kind='integrity_attempt'` row.
- Assert the host marks the integrity session status as `artifact_missing`.
- Assert the next `read_context` / orchestrator decision refresh surfaces the
  `artifact_missing` signal instead of silently falling back to the previous
  integrity artifact.
- Assert no new build is dispatched while the latest integrity attempt is
  `artifact_missing`, unless the artifact is recovered or an explicit user
  confirmation says to continue from stale data.
- Exercise one recovery path: retry artifact persistence or rebuild the
  artifact from session log, then assert normal history rendering resumes from
  the recovered artifact.

## 8. Out of scope (explicitly NOT in this spec)

- Integrity reviewer prompt or replay-awareness (separate spec
  `integrity-team-replay-aware-2026-05-23.md` covers that
  surface).
- A `max_integrity_rounds` config knob.
- Auto-cancel-on-loop background job.
- LLM-driven cross-round summarisation (rule 6 — root-history fact assembly
  is deterministic and cheaper).
- Changing the integrity tool return shape (still single-round,
  full markdown via pointer).

## 9. Acceptance for this spec landing

A future PR is acceptable iff:

1. The shared root-history helper exists and is the only persistent-root
   grouping implementation; build-uptake consumes it rather than defining
   a second id-repeat or fingerprint path.
2. `read_context` renders the §3.1 history block for any task with
   ≥ 2 integrity_attempt rows on the supplied spec snapshot lineage.
3. `scope=evaluations` no longer returns "No context available yet."
   when integrity attempts exist.
4. orchestrator-core.txt contains the §3.3 paragraphs verbatim or
   semantically equivalent (covered by §7.3 prompt wiring test).
5. fail_task / propose_task / modify_goal descriptions match §3.4.
6. The history block renders facts only and contains no lane recommendation
   strings.
7. Late child results after task cancellation cannot dispatch another build
   without explicit user confirmation.
8. All §7 tests pass.
9. `rg` audit in §6 returns no host-side max-N integrity loop
   counter (rule 6.1 / 13 guard).
10. No changes to integrity tool return shape, persist.ts schema,
    decision_log row structure (only the value-string format
    extended).
11. Artifact persistence failure after a completed integrity session marks the
    session `artifact_missing` and is rendered to the next orchestrator
    decision point.
12. It is explicitly forbidden for the orchestrator to continue dispatching as
    if `R(N-1)` were the latest verdict after an `integrity_attempt` artifact
    is missing. Recovery or explicit user confirmation is required first.

## Plan Updates From Patched Review (2026-05-24)

- B-1: removed the former local numeric history-render cap and replaced it
  with a reference to replay-aware's shared prompt cap owner.
- B-2/N-2: `SpecSnapshotLineage` now comes from replay-aware's API; this spec
  consumes the type for root history instead of owning a duplicate lineage
  definition.
- A-2: added an Implementation Checklist mapping the §3 design, §7 tests, and
  §9 acceptance criteria into concrete implementation items.
- N-1: orchestrator history rendering now references replay-aware's shared
  sanitizer owner and must not define local ANSI/bidi/control/heading rules.

## Plan Updates From Patched Review Round 3 (2026-05-24)

- B-2: added §3.1.1 artifact-missing recovery. When an integrity session
  completes but its `integrity_attempt` artifact is not persisted, the host
  records the single `artifact_missing` session status, surfaces it at the
  next decision point, and prevents stale-verdict build dispatch until
  recovery or explicit user confirmation.
- B-2 rule 6.1 self-check: `artifact_missing` is a host-side data-integrity
  status under rule 6.1 category (a), because it records that the latest
  completed tool output is missing from durable artifacts. It does not select
  `build`, `question`, `fail_task`, or any other lane; lane choice remains the
  LLM's decision from surfaced facts.
- B-3: removed the former local numeric history-rendering phrase. Attempt
  rendering bounds are owned only by replay-aware's shared prompt cap; this
  orchestrator spec no longer defines an attempt quantity limit.
