# Integrity Severity Discipline — Prompt-Level Definition & Maturity Context

Date: 2026-05-23
Status: implemented history as of 2026-06-17. Current runtime sources are
`packages/opencorvus/src/prompt/core/integrity-team-core.txt`,
`packages/opencorvus/src/integrity/team-agent.ts`, and severity regression
tests under `packages/opencorvus/test/prompt/` and
`packages/opencorvus/test/integrity/`. This file is retained as historical
design evidence, not as a pending implementation checklist.
Scope: `packages/opencorvus/src/prompt/core/integrity-team-core.txt`,
`packages/opencorvus/src/integrity/team-agent.ts` prompt builders,
`packages/opencorvus/src/integrity/team-schema.ts` (schema doc only).

CLAUDE.md rules that govern this spec:

- rule 6.1 — severity drift is a prompt-teaching problem; do NOT add a host-side
  "advisory→blocking diff watcher" or a route gate; teach the LLM through prompt.
- rule 8 — single source. The severity definition lives in exactly one file
  (`integrity-team-core.txt`). No parallel definition in `team-schema.ts`
  comments or in role-prompt scaffolding.
- rule 11 — reject designs that smuggle workflow decisions back into code.
- rule 13 — no state machine. No host-coded "round N tightens, round N+1 loosens".
- rule 35 — grep inventory below.
- rule 36 — every code change has a targeted test plan; severity-definition
  prompt change has its own prompt-rendering + e2e regression tests.

## Abbreviations

| Term  | Meaning                                                                 |
| ----- | ----------------------------------------------------------------------- |
| ADV   | advisory finding (informational, non-blocking)                          |
| BF    | blocking finding                                                        |
| LLM   | Large Language Model — the model-backed reviewer agent                  |
| MVP   | Minimum Viable Product (smallest acceptance that satisfies the request) |
| brief | Source brief for implementation and acceptance                          |
| REQ   | Requirement row mined from the user request                             |
| SSE   | Server-Sent Events (chat streaming protocol)                            |
| UI    | User Interface surface                                                  |

## Hazard Audit Integration (2026-05-24)

Hazard audit rewrites in this spec:

- [`3.1 Severity Definition (added to integrity-team-core.txt)`](#31-severity-definition-added-to-integrity-team-coretxt):
  H-6 defines `new evidence` and explicitly excludes deeper prose over
  unchanged evidence.
- [`3.2 Scope-Bounded Maturity Evidence (added to evidence prompt)`](#32-scope-bounded-maturity-evidence-added-to-evidence-prompt):
  H-10 removes the independent acceptance-maturity-class interpretation.
  Maturity words are interpreted only through the bounded REQ path owned by
  `acceptance-spec-scope-discipline-2026-05-23.md`.
- [`3.3 Consensus Severity Reconciliation (added to consensus prompt)`](#33-consensus-severity-reconciliation-added-to-consensus-prompt):
  rewritten to use the H-6 `new evidence` definition when preventing
  advisory-to-blocking promotion.
- [`4. Test Plan (rule 36)`](#4-test-plan-rule-36): prompt-string-only
  assertions are supplemented by active-path stub-LLM coverage.

Plan updates appended in
[`Plan Updates From Hazard Audit (2026-05-24)`](#plan-updates-from-hazard-audit-2026-05-24):
hook-fix rule-35 discipline, shared prompt cap usage, and stub-LLM
verification.

Cross-reference: scope discipline is the only owner of maturity-word
interpretation. Replay-aware remains the owner of replay context,
`SpecSnapshotLineage`, shared prompt budget/capping, and shared sanitizer:
[`SpecSnapshotLineage API`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-specsnapshotlineage-api),
[`Shared Prompt Cap Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-cap-owner),
and
[`Shared Prompt Sanitizer Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-sanitizer-owner).
This spec owns severity language only. Its only `SpecSnapshotLineage` use point
is the prior-attempt replay context consumed by severity reviewers and the
consensus pass in §4.2 and §4.5: those prior findings must come from the
replay-aware lineage, not an active-spec-snapshot-only artifact query.

## 1. Diagnosis — Severity Drift Is Systemic

Task `tsk_e54c2d091001t145QP2P6xwoqi` ("写一个成熟的输入 deepseek key 即可聊天的
ai chat 页面，你自己写 template") ran 8 completed integrity rounds without converging.
The DB confirms a systemic pattern: **the same semantic problem is filed as
`advisory` in one round and `blocking` in a later round, with no intervening
build change to that surface.**

DB source (read-only):

```sql
SELECT id, emitted_at, payload
FROM protocol_event
WHERE task_id='tsk_e54c2d091001t145QP2P6xwoqi'
  AND type='integrity.review.completed'
ORDER BY emitted_at ASC;
```

### 1.1 Advisory → Blocking Upgrade Pairs (verified)

| Pair                                           | Earlier finding (severity=advisory)                                                                                                          | Later finding (severity=blocking)                                                                                                        | Semantic delta                                                                                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 — silent quota loss                         | R7 `ADV-3-silent-quota-error` "safeSetItem() silently swallows QuotaExceededError without user notification" (also R2 `AF-5`, R6 `F-INT-04`) | R8 `BF-1` "localStorage quota exceeded causes silent data loss with no user feedback"                                                    | identical surface (`safeSetItem` in `storage.ts`) — same description nucleus; severity flipped without code change between R7 and R8                                                                                                                          |
| P2 — NaN settings validation                   | R5 `CONSENSUS-AF3` "SettingsPanel persists invalid values before blur validation … `{...prev, ...partial}` has no validation"                | R8 `BF-2` "validateSettings() does not check for NaN … NaN values pass validation and reach the API"                                     | both target the validation gap in `validateSettings`/`updateSettings`; R5 filed it as advisory after BF-SV1/2/3 supposedly addressed range checks, R8 promoted the NaN special case to blocking                                                               |
| P3 — getConversations no structural validation | R5 `CONSENSUS-AF5` "getConversations() lacks structural validation of loaded data" (also R3 `BF-SV4` blocking, then back to R6/R8 advisory)  | R3 `BF-SV4` "getConversations() performs no structural validation — corrupted data crashes components" → R5/R6/R8 advisory               | reverse drift: same surface oscillates blocking → advisory → advisory; severity is not a property of the finding, it is a property of the reviewer                                                                                                            |
| P4 — fragile network-error detection           | R2 `BF-2` "Network offline/CORS error detection is fragile — can produce non-Chinese error messages on Safari"                               | R4 `BF-3` "Non-standard network errors bypass Chinese error messages" — both blocking, but R5/R6 drop it entirely from the consensus set | not advisory→blocking; this is the **invisibility drift** — a blocker rediscovered and silently dropped two rounds later without a verified repair                                                                                                            |
| P5 — large bundle / code-splitting             | R2 `AF-6` "Large JS bundle (1035KB) without code-splitting — slow initial load"                                                              | R6 `F-BT-3` advisory; R7 `ADV-5-bundle-size` advisory                                                                                    | severity stable (advisory across rounds), demonstrating the same bug class **can** be stable when reviewers tacitly agree it is non-blocking — but the prompt provides no language to make that agreement explicit, so other reviewers (P1/P2) flip it freely |

Pairs P1 and P2 prove the death-loop mechanism that drives this task past
8 rounds: the orchestrator fixed each blocker, the next round's fresh reviewer
promoted a previously advisory item to blocking, and the orchestrator was
forced to keep rebuilding.

### 1.2 Reviewer-Set Disagreement Within A Round (R5)

R5 is the round where the supervisor consensus tool was called — yet the
findings list contains `CONSENSUS-BF1..3` (blocking) **and**
`CONSENSUS-AF3` (advisory) targeting overlapping surfaces (settings/storage
validation). The consensus path does not require reviewers to converge on a
severity for overlapping evidence; advisory and blocking simply coexist. There
is no prompt instruction telling the supervisor to fold advisory items into a
blocking finding when they describe the same defect at finer granularity.

## 2. Root Cause — Severity Has No Prompt-Level Definition

### 2.1 Grep Inventory (rule 35)

Where the words `blocking` / `advisory` appear in the integrity prompt path:

| File                                                                                                                                                     | Line(s)          | What it says about severity                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/integrity/team-schema.ts`                                                                                                       | 31               | `severity: z.enum(["blocking", "advisory"])` — schema-only enum, no semantic                                                                                                                                                                                  |
| `packages/opencorvus/src/integrity/team-schema.ts`                                                                                                       | 109–129          | `superRefine`: requires `needs_correction` when any blocking exists; forbids blocking under `pass`. Coupling rules only — does NOT define what makes a finding blocking.                                                                                      |
| `packages/opencorvus/src/prompt/core/integrity-team-core.txt`                                                                                            | 34               | "If a potentially blocking disagreement remains unresolved, the final verdict cannot be pass." — uses the word but does not define it.                                                                                                                        |
| `packages/opencorvus/src/prompt/core/integrity-core.txt` (legacy)                                                                                        | 60, 78, 107, 145 | Mentions `advisory-only concerns can pass`, advisory findings have no executable repair, etc. Still does not say _what kind of problem is blocking vs advisory_. Also this is the LEGACY single-reviewer prompt — the active team prompt does not inherit it. |
| `packages/opencorvus/src/integrity/team-agent.ts` `buildSupervisorPlanPrompt` / `buildReviewerPrompt` / `buildSupervisorConsensusPrompt` (lines 411–449) | —                | No severity guidance. No maturity threshold. No user-request maturity context beyond the raw request text.                                                                                                                                                    |
| `packages/opencorvus/src/intent/request-prompt.ts` `renderUserRequestSection`                                                                            | 50–76            | Renders the raw user request excerpt and a pointer to the bundle file. No maturity / risk-tolerance signal extracted.                                                                                                                                         |
| `packages/opencorvus/src/integrity/team-agent.ts` `buildIntegrityEvidencePrompt` (451–535)                                                               | —                | Renders requirements, requirement status, acceptance, design specs, goal contracts, contract graph, decision log. No maturity-class, target-audience, or risk-acceptance signal.                                                                              |

There is **no prompt-level definition of `blocking` vs `advisory` anywhere in
the active team path**. The model is left to interpolate from training data,
which produces production-grade defaults — and so the model promotes any
production smell (silent quota errors, NaN propagation, plaintext API key)
to `blocking` regardless of the project's actual maturity tier.

### 2.2 Two Compounding Drivers

The severity drift has two interacting causes:

1. **Undefined severity semantics.** Every reviewer applies its own implicit
   bar. One reviewer treats "silent QuotaExceededError" as advisory because
   the in-memory state is still correct; another treats it as blocking because
   "mature app should notify the user". Both are defensible under the current
   prompt; neither is the project's actual policy.
2. **Missing scope-bounded maturity evidence.** The user said "成熟的 ai chat
   页面" ("mature chat page"), then immediately added "你自己写 template" (you write
   the template yourself). That phrasing must be resolved by the Requirements /
   scope pipeline into bounded REQs or one requirements-extraction concern.
   Severity must not independently translate "mature" into a acceptance class
   or a lower blocking threshold. Without bounded REQs, every reviewer defaults
   to its own highest-bar interpretation of "mature".

The replay-aware spec
(`packages/opencorvus/specs/integrity-team-replay-aware-2026-05-23.md`) fixes
the _memory_ dimension: fresh reviewers will see what prior reviewers said.
But replay alone does NOT prevent a re-review reviewer who now sees the prior
`advisory` from disagreeing and re-classifying it as blocking. The two fixes
are complementary; this spec covers the **definition** dimension.

## 3. Solution — Prompt-Over-Host Severity Discipline

Per rule 6.1: severity drift is the LLM choosing wrong because it was never
told what right looks like. Fix the prompt, not the host.

### 3.1 Severity Definition (added to `integrity-team-core.txt`)

Add one new section, immediately after the existing "Evidence requirements"
block. Single source — no parallel copy in role prompts or schema comments.

<!-- removed: vague "new evidence raising it to clause (a)-(e)" escape hatch; reason: H-6 requires a closed definition of new evidence. -->

```markdown
## Severity Discipline

There are exactly two severities. They are not a sliding scale; they encode
**whether the orchestrator must rebuild before acceptance**.

`blocking` — the deliverable cannot be accepted in its current state. The
finding satisfies at least one of:
(a) a user-visible flow fails or produces obviously wrong output for an
input shape the user is expected to encounter under normal use of the
stated request;
(b) the implementation contradicts an explicit user-request phrase or an
explicit REQ row;
(c) the build, install, type-check, or test suite is broken (cannot ship);
(d) data the user can produce in normal flow is silently destroyed,
corrupted, or made unrecoverable, with no in-app recovery path;
(e) a security or credential disclosure that exists in the actual data
flow on a path a benign user will hit, not a hypothetical attacker
pivot.

`advisory` — the deliverable can ship; the finding is improvement
information the orchestrator may queue but is NOT required to address in the
current task. This includes:

- hardening against inputs the user did not ask for (extra browser
  quirks, attack pivots, tab-collision races) when normal flow works;
- polish, performance, or bundle-size concerns within reasonable defaults;
- missing tests for behavior that is itself correct;
- dead code, unused parameters, redundant wrappers;
- "mature apps usually do X" suggestions without a concrete user-request
  phrase or REQ row demanding X.

Severity is decided **per finding against the bar above**, not by feel of
"how mature should this be". Two reviewers must reach the same severity for
the same underlying defect; if your finding overlaps another reviewer's,
fold them under the same severity in consensus. Disagreement is a
`disputed`/`unresolved` consensus marker, not a quietly different severity.

Anti-patterns (reject these in consensus):

- Promoting a prior `advisory` to `blocking` in a later round without new
  evidence. `new evidence` means at least one of:
  1. code lines on the same defect surface changed after the prior
     attempt;
  2. a new explicit REQ row was added after the prior attempt;
  3. a newly executed runtime observation, command output, screenshot,
     or trace was produced after the prior attempt.
     A deeper reading of the same unchanged code, artifact, request text, or
     prior runtime output is NOT new evidence. More precise prose over the
     same evidence is NOT new evidence. Persistence alone is NOT promotion.
- Filing the same defect at both severities through different reviewer
  ids inside one consensus.
- Quoting "the app should be mature" as the entire justification for
  `blocking`. Cite the bar clause (a)–(e) you are invoking.

If you are unsure whether a finding crosses the bar, file `advisory` and
state the conditions under which it would become `blocking`. Conservative
escalation is a regression machine.
```

### 3.2 Scope-Bounded Maturity Evidence (added to evidence prompt)

<!-- removed: independent Acceptance Maturity Class interpretation; reason: H-10 assigns all maturity-word interpretation to the scope spec's bounded REQ path. -->

Severity no longer renders or derives a `Acceptance Maturity Class`. The
severity prompt must not independently interpret "成熟", "mature",
"polished", "production-ready", or similar words. All maturity-word meaning
comes from `acceptance-spec-scope-discipline-2026-05-23.md`:

- If the Requirements / scope path decomposed a maturity word into bounded
  REQ rows with acceptance and non-goals, severity evaluates findings against
  those explicit REQs and the severity bar in §3.1.
- If the Requirements / scope path did not decompose the maturity word, the
  only valid integrity output based on that word is one
  requirements-extraction concern citing the literal quote. It is not a
  license to generate separate blockers for quota, races, bundle size, SSR,
  browser quirks, telemetry, or other maturity sub-aspects.
- A literal quote such as "成熟" can explain why a bounded REQ is missing; it
  cannot lower the blocking threshold or act as a production signal by
  itself.

Extend `buildIntegrityEvidencePrompt` to render a read-through section, not a
classifier:

```markdown
# Scope-Bounded Maturity Evidence

Maturity-related bounded REQs from requirements/scope:

- REQ-6: errors render in Chinese for 401 / 429 / network-off.
  acceptance: ...
  non_goals: ...

Maturity terms from original request not landed as bounded REQs:

- "成熟" -> no bounded REQ found. Valid integrity action: at most one
  requirements-extraction concern; do not derive severity thresholds from
  this word.
```

The host only renders existing REQ / decision / request-quote evidence. It
does not classify the project as demo, internal tool, or production, and it
does not maintain a maturity enum. That single-source ownership belongs to
scope discipline.

### 3.3 Consensus Severity Reconciliation (added to consensus prompt)

Extend `buildSupervisorConsensusPrompt` to include, before the current
reviewer reports section:

```markdown
# Severity Reconciliation Pass

Before emitting the team report:

1. Identify every group of reviewer findings that target the same defect
   surface (same file/function/symptom). Treat ids as labels, not as
   identity — use the description and evidence to detect overlap.

2. For each group, decide a single team severity using the bar in
   "Severity Discipline". Do NOT carry both severities forward. If
   reviewers disagree:
   - if the disagreement is real, fold into one finding with
     consensus="disputed" and pick the severity that the bar clauses
     (a)–(e) support; explain in the description.
   - if neither bar clause is met, the team severity is advisory.

3. If a finding repeats a defect that was advisory in any prior attempt's
   report (replay context), and there is no §3.1 new evidence raising it to
   a bar clause (a)–(e), keep it advisory. Persistence alone is not a
   promotion trigger. A deeper reading of unchanged code or unchanged prior
   runtime output is not new evidence.

4. If a finding repeats a defect that was blocking in a prior attempt and
   the build evidence since that attempt does NOT show a repair on that
   surface, keep it blocking and mark consensus="agreed" with a
   "persistent" note.
```

This is text guidance, not a host check. The LLM remains the decider; the
host only ensures the reconciliation is _prompted for_, not _enforced_.

### 3.4 What This Spec Explicitly Does NOT Add

- **No** host-side `severity diff watcher` that flags advisory→blocking
  upgrades. That would be rule 6.1 backwards (host teaching the LLM).
- **No** host-side reject of a consensus that promotes a prior advisory.
- **No** new severity tier (`info`, `critical`, etc.). Two-value enum stays.
- **No** schema change to `IntegrityFindingSchema`. The discipline is
  prompt-level; the existing `consensus: agreed|disputed|unresolved` field
  already carries reviewer disagreement.
- **No** maturity enum in the host. The old maturity-class read-through
  behavior has been removed; maturity evidence is read only as bounded REQs
  or a single requirements-extraction concern from the scope path.

## Plan Updates From Hazard Audit (2026-05-24)

- H-11 hook-fix discipline: hook fixes, docs-check fixes, route-check fixes,
  generated-script/helper changes, and OpenAPI/SDK/doc cleanup are
  implementation changes. They require their own rule-35 grep inventory
  before landing.
- H-10 maturity single source: this spec must not add a acceptance class,
  maturity enum, or local maturity phrase table. It reads only bounded REQs
  and request-quote evidence emitted by the scope discipline path.
- H-12 prompt budget: severity prompt additions must use the replay-aware
  [`Shared Prompt Cap Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-cap-owner)
  and
  [`Shared Prompt Sanitizer Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-sanitizer-owner).
  Do not introduce a local cap or sanitizer for replay context, maturity
  evidence, or reviewer text.
- Test-realism patch: prompt-string tests are insufficient. Add active-path
  stub-LLM coverage that captures the supervisor/reviewer/consensus prompts
  through `reviewIntegrity`, not only isolated builder strings.

## Implementation Discipline

Every later implementation PR must include a rule-35 grep inventory for both
the intended feature files and any incidental support changes. In particular,
hook-fix / docs check / route check / script helper changes also count as
implementation changes and must grep their call sites, route definitions,
generated artifacts, and sibling helpers before commit. A hook-clean result
does not replace this inventory.

## 4. Test Plan (rule 36)

### 4.1 Prompt Rendering Tests

`packages/opencorvus/test/prompt/integrity-severity-prompt.test.ts` (new):

- `buildSupervisorPlanPrompt` contains the full "Severity Discipline"
  section literally, with all five bar clauses (a)–(e).
- `buildReviewerPrompt` contains the same section (single source via
  `TEAM_CORE`).
- `buildSupervisorConsensusPrompt` contains the "Severity Reconciliation
  Pass" section.
- `buildIntegrityEvidencePrompt` contains a "Scope-Bounded Maturity Evidence"
  section. It renders maturity-related bounded REQs and the "missing bounded
  REQ" branch; it does not render `Acceptance Maturity Class`,
  `acceptance_class`, `demo`, or `production` classification text.

### 4.2 Severity Stability Regression Test

`packages/opencorvus/test/integrity/severity-stability.test.ts` (new):

Construct a fixture matching the R7→R8 promotion pair (silent quota
error). Mock `reviewIntegrity` to invoke a real prompt build pass against
the team-agent prompt builders, but stub the LLM call layer with two
recorded responses:

- response A: produces R7's `ADV-3-silent-quota-error` as advisory.
- response B: produces R8's `BF-1` (same surface) as blocking, in the
  next attempt, with no new evidence injected.

After applying the new prompt (with replay context built from replay-aware's
`SpecSnapshotLineage`), assert that the second-attempt prompt contains:

- the "Severity Discipline" bar clauses,
- the prior advisory finding in replay context,
- the explicit "Persistence alone is NOT promotion" sentence,
- the exact §3.1 new-evidence definition and the sentence excluding deeper
  prose over unchanged evidence.

This test is a prompt-content assertion only; it does NOT assert that the
LLM produces a specific severity (that is the LLM's call). It asserts that
the **prompt provides what the LLM needs** to make the same call twice.

### 4.3 Scope-Bounded Maturity Evidence Test

`packages/opencorvus/test/integrity/scope-bounded-maturity-prompt.test.ts`
(new):

- Fixture where scope produced a bounded REQ for "成熟" → prompt renders the
  REQ id, acceptance, non-goals, and exact quote.
- Fixture where scope did not produce a bounded REQ for "成熟" → prompt
  renders the single requirements-extraction-concern branch.
- Negative assertion: prompt does not render an independent maturity class,
  acceptance class, production/demo enum, or local phrase table.

### 4.4 Consensus Severity Fold Test

`packages/opencorvus/test/integrity/consensus-severity-fold.test.ts` (new):

Construct two reviewer reports whose findings overlap (same file, same
symptom) at different severities. Assert that the consensus prompt
includes the reconciliation language naming the overlap behavior. (Again
prompt-content only; LLM behavior is tested via the existing team-schema
`superRefine` and integration tests.)

### 4.5 Active-Path Stub-LLM Regression

`packages/opencorvus/test/integrity/severity-active-path.test.ts` (new):

- Invoke `reviewIntegrity` through the active team-agent path with a stub LLM
  that captures supervisor planning, reviewer, and consensus prompts.
- Assert the captured prompts contain the severity bar, new-evidence
  definition, lineage-based replay context, and scope-bounded maturity
  evidence.
- The stub may return a canned advisory-to-blocking promotion to exercise the
  submission path, but the test assertion is prompt/context acceptance, not live
  model quality.

### 4.6 Targeted Run

```powershell
bun test packages/opencorvus/test/prompt/integrity-severity-prompt.test.ts `
         packages/opencorvus/test/integrity/severity-stability.test.ts `
         packages/opencorvus/test/integrity/scope-bounded-maturity-prompt.test.ts `
         packages/opencorvus/test/integrity/consensus-severity-fold.test.ts `
         packages/opencorvus/test/integrity/severity-active-path.test.ts `
         packages/opencorvus/test/integrity/team-schema.test.ts
```

## 5. Relationship to the Replay-Aware Spec

`packages/opencorvus/specs/integrity-team-replay-aware-2026-05-23.md` and
this spec are **complementary, not overlapping**. They fix two distinct
dimensions of the same death-loop:

| Dimension                        | Replay-aware spec                                                                                                                    | Severity-discipline spec (this one)                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory                           | Adds replay context: each reviewer sees prior attempts, prior findings, changed files since last review.                             | (none)                                                                                                                                            |
| Definition                       | (none)                                                                                                                               | Adds prompt-level definition of `blocking` vs `advisory` and reads scope-bounded maturity REQs without interpreting maturity words independently. |
| Per-finding judgment             | Reviewer knows what was said before.                                                                                                 | Reviewer knows the bar to apply.                                                                                                                  |
| Consensus                        | Consensus knows what prior consensus said.                                                                                           | Consensus is told to fold overlapping severities and respect the "persistence ≠ promotion" rule.                                                  |
| Failure mode if applied alone    | Reviewer sees prior advisory, still re-classifies as blocking (the R7→R8 case here, even after replay).                              | First-round reviewers still drift between advisory and blocking on the same finding class within a single task.                                   |
| Failure mode if applied together | Reviewer sees prior advisory **and** knows persistence is not a promotion trigger and knows the bar — stable severity across rounds. | —                                                                                                                                                 |

The two specs touch the same prompt files (`integrity-team-core.txt`,
`team-agent.ts` builders) and the same replay / bounded-REQ evidence
pipelines. They will be implemented as two
separate commits in either order; merge order is not significant because
each adds an additive prompt section and a non-overlapping evidence
field. If implemented in opposite order, the second commit will simply
add the missing section to a prompt that already contains the other.

There is **no design conflict** between them. The replay-aware spec
explicitly leaves severity reasoning to the LLM; this spec gives the LLM
the discipline it needs to reason consistently.

## 6. Rule 6.1 Self-Check

This design is prompt-over-host:

- Severity definition lives in the prompt, not in a host validator.
- There is no maturity class in this spec. The host renders bounded REQs and
  request-quote evidence produced by the scope path; it does not classify the
  project or interpret maturity words.
- The consensus reconciliation pass is prompted, not enforced. The LLM
  remains the severity decider; the host only ensures the right context
  is on the prompt.
- No new `if reviewer raises severity without new evidence then reject`
  host gate. The bar clauses + replay context are how the LLM avoids that
  on its own.
- No host-side max-N integrity rounds counter.
- No host-side keyword matching on user request or REQ description.
- No host-side state machine selecting reviewer behavior across rounds.
- The `IntegrityFindingSchema` (data shape) and the `superRefine`
  coupling rules (data integrity: `pass` cannot carry `blocking`) remain
  as the only host-side enforcement, which is data-integrity, not
  route-teaching — that is the rule 6.1 carve-out.

## 7. Implementation Checklist

1. [ ] Edit `packages/opencorvus/src/prompt/core/integrity-team-core.txt`:
       add the "Severity Discipline" section verbatim from §3.1.
2. [ ] Edit `packages/opencorvus/src/integrity/team-agent.ts`
       `buildIntegrityEvidencePrompt`: render the "Scope-Bounded Maturity
       Evidence" section using bounded REQs and request-quote evidence already on
       `ReviewPromptInput`.
3. [ ] Edit `buildSupervisorConsensusPrompt`: prepend the "Severity
       Reconciliation Pass" section from §3.3 before the current reviewer
       reports section.
4. [ ] Verify reviewer and consensus prior-attempt context is consumed from
       replay-aware's `SpecSnapshotLineage` output, not active-spec-only artifact
       lookup, for the §4.2 severity-stability and §4.5 active-path tests.
5. [ ] Add the five test files in §4.1–§4.5 with the assertions described.
6. [ ] Run the targeted command in §4.6.
7. [ ] Verify on the same failing task replay (or a saved fixture from it)
       that the new prompt contents materialize, by capturing a single dry-run
       prompt build through the orchestrator test mocks.

No code outside `integrity-team-core.txt`, `team-agent.ts` prompt
builders, and the new test files is touched by this spec.

## Plan Updates From Patched Review (2026-05-24)

- B-1: severity prompt additions now link to replay-aware's shared prompt cap
  owner and do not imply a local replay/severity cap.
- A-1: §6 now explicitly forbids a host-side max-N integrity rounds counter,
  host-side keyword matching on user request / REQ description, and
  host-side state-machine selection of reviewer behavior across rounds.
- N-1: severity context now links to replay-aware's shared sanitizer owner
  for reviewer text, request quotes, and maturity evidence.

## Plan Updates From Patched Review Round 3 (2026-05-24)

- A-1: kept the replay-aware `SpecSnapshotLineage` reference and added its
  severity-specific use point. Severity reviewers and consensus need lineage
  only when reading prior attempts / prior findings for §4.2 severity-stability
  and §4.5 active-path replay context.
- A-1: severity still does not own lineage construction. Replay-aware remains
  the source owner; this spec consumes the lineage-built replay context and
  forbids active-spec-only prior-attempt reads for severity prompts.
