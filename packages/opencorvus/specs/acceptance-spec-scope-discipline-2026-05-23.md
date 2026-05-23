# Acceptance Spec Scope Discipline - 2026-05-23

Status: design draft. No runtime code is changed by this document.

CLAUDE.md rules relevant to this change: rule 2 (no surface-level diagnosis),
rule 4 (treat as systemic, not single agent), rule 6.1 (prompt-over-host for
LLM routing/scoping), rule 8 (no dual-source for "acceptance scope"),
rule 11 (reject designs that hide workflow decisions in code), rule 13 (no
state-machine), rule 35 (grep all call sites), rule 36 (tests on every change).

## Abbreviations

| Term | Meaning |
| ---- | ------- |
| REQ | Requirement row (engine_requirement) — user-visible capability extracted by the Requirements agent. |
| AS | AcceptanceSpec (`packages/opencorvus/src/acceptance/types.ts`) — typed, scorer-bearing acceptance criterion attached to a goal. |
| BF | Blocking finding emitted by integrity reviewers. |
| AF | Advisory finding emitted by integrity reviewers. |
| DB | OpenCorvus persistent SQLite store (`engine_task`, `engine_requirement`, `engine_goal`, `engine_artifact`). |
| LLM | Large Language Model. |
| PRD | Product Requirements Document. |

## User Concern

Task `tsk_e54c2d091001t145QP2P6xwoqi` ("写一个成熟的输入 deepseek key 即可聊天
的 ai chat 页面，你自己写 PRD") ran 8 integrity rounds in a row, each
`needs_correction`, each surfacing fresh advisories promoted to blocking
findings (concurrent-send race, QuotaExceededError, NaN validation, bundle
size, dead code, unused param ...). The user asks whether the acceptance
contract for this task was set wide enough that integrity will always find a
new "maturity gap".

## Diagnosis

### Numbers (read-only DB on 2026-05-23T23:00 local)

| Surface | Count | Source |
| ------- | ----- | ------ |
| REQ rows | 18 | `engine_requirement WHERE task_id=...` — **9 unique user-visible REQs duplicated x2** (spec_snapshot rewrite re-inserted them; identical title + identical description). |
| Goals | 5 | `engine_goal WHERE task_id=...` |
| AcceptanceSpecs total | 25 | sum of `acceptance_specs` JSON across the 5 goals |
| AcceptanceSpecs that are LLM judges | 1 | `acc-int-6` — `llm_judge` "End-to-end chat flow completeness" |
| AcceptanceSpecs that are shell greps | 21 | majority — `grep -r 'ChatPanel' src/components --include='*.tsx' -l` style |
| AcceptanceSpecs that are real shell builds/tests | 3 | `npm run build` x2, `npx vitest run` x1 |
| Contract graph contracts | 8 | `art_e54c5ed1e001OBiafG0kHFldFj` — Conversation/Message/Settings types, 3 hooks, ThemeContext, ErrorBoundary |
| `engine_requirement.acceptance` column | **all empty strings** | "acceptance: []" on every row — Requirements agent emits no per-REQ acceptance text |
| `engine_requirement.non_goals` | **all empty strings** | Requirements emits no non-goal boundary |
| Integrity attempts | 8 | all `needs_correction`, `post_build` |

### REQ samples (verbatim, both columns)

| REQ | title (= description) | acceptance | non_goals |
| --- | --------------------- | ---------- | --------- |
| REQ-1 | "用户可以输入 DeepSeek API Key，Key 存储在浏览器 localStorage 中..." | `[]` | "" |
| REQ-6 | "错误处理与容错：API Key 无效/过期、请求频率超限、网络断开等异常均有清晰的中文提示..." | `[]` | "" |
| REQ-9 | "支持选择 DeepSeek 模型（至少 deepseek-chat 和 deepseek-reasoner），可调节温度等生成参数..." | `[]` | "" |

The phrase "成熟的" (mature / production-ready) from the original user request
**does not appear in any REQ, goal, or AS**. It was dropped silently at the
Requirements stage.

### Findings drift across rounds (selected)

| Round | New blocker introduced | In any AS? | Traced to REQ? |
| ----- | ---------------------- | ---------- | -------------- |
| R1 BF-1 | stop-generation loses partial content | partially (acc-chat-3 "stop/regenerate exist") | `ref=[]` |
| R1 BF-2 | cross-conversation race on switch | no | `ref=[]` |
| R2 BF-1 | Settings runtime validation on load from localStorage | no AS asks for runtime validation | tagged `REQ-9` post-hoc |
| R2 AF-5 | localStorage QuotaExceededError silently swallowed | no | tagged `REQ-6` post-hoc |
| R2 AF-6 | bundle 1035KB no code-splitting | no | `ref=[]` |
| R6 F-BT-3 | bundle > 500 kB | no | `ref=[]` |
| R7 ADV-6 | dead code (`getConversationById` exported but unused) | no | `ref=[]` |
| R7 ADV-7 | unused `_body` parameter | no | `ref=[]` |
| R8 BF-1 | quota exceeded silent data loss | no | tagged `REQ-6, REQ-3` post-hoc |
| R8 BF-2 | NaN passes `validateSettings` | no | tagged `REQ-6, REQ-9` post-hoc |

The pattern: by round 2 the team has exhausted the original AS surface; from
round 3 onward each round invents a *new* maturity dimension (validation
shape, network resilience, bundle hygiene, dead code, parameter hygiene,
double-send race, NaN, ...) and labels it `BF` because nothing in the prompt
chain says the finding must trace back to a committed REQ or AS.

### Verdict on the spec-width question

**Yes, the acceptance contract is open-ended in a way that lets integrity drift
upward without bound — but the root cause is not "too many specs". It is
that maturity is never named at all.**

Three reinforcing failures:

1. **Requirements stage drops the word "成熟"** — `requirements-core.txt`
   has no rule that maturity / production-readiness / "polished" words must
   either become an explicit bounded REQ ("E.g.: errors render in Chinese for
   401 / 429 / network-off; no white screen on uncaught exception") OR be
   surfaced as a clarification before `submit_requirements`. The agent just
   transliterates the bullet list into 9 REQs with empty `acceptance` and
   empty `non_goals`.
2. **Architect's AS are existence greps, not behavior contracts** — 21 of 25
   AS are `grep -r 'Foo' src/ -l`. They pass the moment a file containing
   the keyword exists. They cannot fail on quota handling, NaN, race
   conditions, or bundle size. So "AS green" carries zero signal about
   maturity, and integrity has to step in to actually audit behavior — with
   no upper bound, because the contract never named one.
3. **Integrity reviewer prompt has no traceability obligation** — see
   `team-schema.ts:37-38`: `requirementIDs` and `specIDs` default to `[]`.
   `integrity-team-core.txt` line 28-31 says "cite concrete evidence ...
   user request phrases, REQ ids, goal ids, spec ids, file paths, command
   output, runtime screenshots, or delivery context" — the citation list is
   an **OR**, so a finding citing only a file path is valid. Combined with
   "do not use fixed review dimensions" (line 19) and "the original user
   request is the audit source" (line 22-23, where "request" includes the
   undefined word "成熟"), the reviewer is licensed to invent any new
   maturity dimension and call it blocking.

Round 1 emitted 11 findings with `ref=[]` for every single one. That is
the structural signal: the team is not even pretending to anchor findings
to the contract.

### Which stage is the proximate fault?

Requirements is the **first** failure (vague word never landed). Architect is
the **second** (AS are existence stubs, not behavior contracts). Integrity is
the **amplifier** (no traceability, no scope cap, infinite re-review surface).

The user's question "is the spec too wide" inverts cause and effect: the spec
is too **thin**, not too wide. A thin spec under an unbounded reviewer is
indistinguishable from a wide spec, because the reviewer fills the vacuum.

## Plan (Prompt-Over-Host, rule 6.1)

This is a prompt-discipline fix, not a host-side cap. Three coordinated edits.

### 1. Requirements: maturity words must land or be clarified

Edit `packages/opencorvus/src/prompt/core/requirements-core.txt`.

Add to **Phase 1: PARSE USER INPUT** a new bullet "Vague maturity words must
become bounded REQ-N or be surfaced as a clarification":

```text
- **Vague maturity / quality words** ("成熟", "polished",
  "production-ready", "robust", "mature", "完善", "稳定", "professional",
  "high-quality") are NOT requirements on their own. For every such word in
  the user request:
  1. Decompose it into one or more bounded, verifiable REQ-N items
     ("errors render in Chinese for 401 / 429 / network-off; no white screen
     on uncaught exception" — not "production-grade error handling"); OR
   2. If the bounded version is non-obvious, register a clarification via
      `register_decision({ key: "maturity_scope_pending", ... })` describing
      exactly what the agent assumed the word means. That decision MUST be
      durable before the requirements run returns: either
      `register_decision` immediately sinks it to `engine_decision_log`
      independent of a finalized requirements result, or the RequirementsAgent
      returns `maturity_scope_pending` as the finalized requirements result
      instead of throwing. Only then stop short of `submit_requirements`.
   Never leave a maturity word implicit. An implicit maturity word becomes a
   free-form license for integrity to invent new blockers across every later
   round.
```

Persistence contract for the clarification path:

- `maturity_scope_pending` cannot live only in an in-memory requirements
  collector that is flushed after `submit_requirements` succeeds. The
  clarification must survive an unfinalized requirements run.
- If the implementation chooses immediate persistence, the
  `register_decision` tool path writes the decision to `engine_decision_log`
  at call time. This is data durability, not a lane-selection host gate.
- If the implementation chooses finalized-result semantics, the
  RequirementsAgent must not throw for this path. It returns a
  `maturity_scope_pending` result that the orchestrator can read as a normal
  requirements outcome.
- The orchestrator must treat durable `maturity_scope_pending` as a
  `question` lane signal asking the user to clarify the maturity boundary. It
  must not mark the requirements run as a failure and retry requirements in a
  loop.

Also require every REQ-N to populate `acceptance` and `non_goals` with at
least one sentence:

```text
- Every `register_requirement` call MUST populate `acceptance` (one sentence
  describing the observable success condition) and `non_goals` (one sentence
  naming what this REQ does NOT cover, even if related). Empty strings on
  both fields are a hard failure — they delete the boundary the Architect
  needs to draw acceptance_specs and the Integrity team needs to refuse
  out-of-scope findings.
```

### 2. Integrity team: every finding must trace to REQ / AS / explicit user phrase

Edit `packages/opencorvus/src/prompt/core/integrity-team-core.txt`.

Replace the current "Evidence requirements" block with traceability-first
text:

```text
Evidence requirements:

- Every finding MUST carry at least one of:
  - `requirementIDs`: REQ-N this finding violates (cite REQ-N, not REQ
    title) — the finding's claim must already be inside that REQ's
    `description` / `acceptance` / `non_goals` text. Do not retrofit a
    REQ-N tag onto a concern the REQ did not name.
  - `specIDs`: AcceptanceSpec ids this finding violates — the spec's
    `title` / `scorers` must already name the audited behavior.
  - `userRequestQuotes`: literal substring(s) of the original user
    request the finding violates. Paraphrase is not allowed.
  A finding with empty `requirementIDs`, empty `specIDs`, AND no
  `userRequestQuotes` is out of scope and MUST be dropped, regardless of
  how interesting the underlying defect is.
- "Maturity", "polished", "production-ready" and similar adjectives in the
  user request are NOT a license to invent new dimensions. If the
  Requirements stage did not land a bounded REQ for that adjective, report
  the missing REQ as a single requirements-extraction concern with
  `userRequestQuotes` citing the adjective — do not generate a parade of
  blockers for each maturity sub-aspect.
- Within scope, still cite concrete evidence (file paths, command output,
  runtime screenshots, delivery context).
- Do not pass on intent summaries alone.
- Do not accept grep/listing-only proof when runtime behavior is material.
- If a potentially blocking disagreement remains unresolved, the final
  verdict cannot be pass.
```

This is prompt-level scope teaching, not host enforcement: the LLM still
decides whether a quote / REQ / spec actually covers the concern. The host
does **not** verify the `userRequestQuotes` substring is present — that
would be a route-bypass invariant of the kind rule 6.1 forbids.

Literal user-request quotes, maturity-word excerpts, reviewer text, and
requirements-extraction concern text rendered by this flow must use the
replay-aware
[`Shared Prompt Sanitizer Owner`](integrity-team-replay-aware-2026-05-23.md#plan-updates-from-patched-review-2026-05-24-shared-prompt-sanitizer-owner).
Scope discipline does not own ANSI escape, bidirectional control,
control-character, markdown heading injection, or quote-length rules; it
only decides what scoped evidence should be rendered.

Also tighten the supervisor consensus wording in `team-agent.ts`
`buildSupervisorConsensusPrompt`:

```text
A finding that does not cite a REQ-N, AS id, or literal user-request
substring is out of scope and must be removed from the final report. If
multiple reviewers all reported the same untraced concern, that is signal
that the requirements/architect stage missed a REQ — emit one
requirements-extraction concern, not a blocker for each sub-aspect.
```

### 3. Architect: AS may not be pure existence greps when the REQ is about behavior

Edit `packages/opencorvus/src/prompt/core/architect-core.txt`.

Append after the existing `acceptance_specs` rules:

```text
- An AcceptanceSpec whose only scorer is a file-existence grep (e.g.
  `grep -r 'Foo' src/ -l`) is acceptable only for REQs that name a *file
  / module* outcome. For REQs that name *behavior* (streaming, error
  rendering, persistence, input validation, race-free interaction), the
  AS must include at least one runtime-bearing scorer: a real build/test
  shell scorer, an `llm_judge` runtime scorer, or a `contract_audit`
  scorer that pins typed contract fields. Existence greps under
  behavior REQs are a hard decomposition defect — they deliver a
  false-green to integrity and force integrity to invent the missing
  audit unbounded.
- Every REQ-N whose `acceptance` text exists must have at least one AS
  whose `scorers[*].name` or `title` references that acceptance phrase.
  If you cannot anchor the AS to the REQ's `acceptance` text, the
  Requirements stage is under-specified and you must surface that as a
  decomposition concern rather than fill the gap with a grep.
```

### What this plan does NOT do (host-side gates we refuse to add — rule 6.1, rule 11)

- No host-side "max N rounds" gate.
- No host-side count cap on findings per round.
- No host-side `userRequestQuotes` substring verification.
- No host-side reject of findings with empty `requirementIDs` (the schema
  default stays `[]` for shape, the *prompt* forbids it semantically).
- No "spec count" upper bound. The fix is qualitative (every spec must bind
  to a behavior the REQ already named), not quantitative.
- No state-machine switching between "first review wider" / "later review
  narrower". The replay-aware plan already addresses replay scope through
  prompt context.

## Relationship to the Other Two Specs

| Spec | Problem it solves | Distinct? |
| ---- | ----------------- | --------- |
| `integrity-team-replay-aware-2026-05-23.md` | Round N rediscovers round N-1's blockers because reviewers see no prior verdicts. | **Yes — replay memory is orthogonal.** Even a perfectly traceable finding set drifts upward without replay memory. |
| `acceptance-spec-scope-discipline-2026-05-23.md` (this) | The contract is silent about what "mature" means, so every round invents a new maturity dimension. | This is about **scope width**, not memory. |
| (assumed) `severity-discipline-*` (codex) | Reviewers misclassify advisories as blockers, so even bounded scope still fails. | Adjacent but distinct — severity is the *priority* axis; scope is the *which-concerns-count* axis. |

Recommendation: **keep three separate specs, do not merge.** They attack
three orthogonal failure modes:

1. memory drift (replay)
2. scope drift (this spec)
3. severity drift (codex)

Merging risks making the spec text too long for any one prompt edit to land
cleanly, and risks tangling the test plans (each spec wants different
fixtures). They should land as three sequential prompt edits, each with its
own targeted test, in the order: scope discipline → severity discipline →
replay awareness. Scope first because without it the other two
optimize a still-unbounded review surface.

## Rule 35 Grep Inventory

Files that touch this surface and must be considered in the patch:

| Path | Role | Required change |
| ---- | ---- | --------------- |
| `packages/opencorvus/src/prompt/core/requirements-core.txt` | Requirements agent prompt | Add maturity-word landing rule + mandatory `acceptance` / `non_goals`. |
| `packages/opencorvus/src/prompt/core/architect-core.txt` | Architect prompt | Forbid existence-grep AS under behavior REQs; require AS anchored to REQ.acceptance text. |
| `packages/opencorvus/src/prompt/core/integrity-team-core.txt` | Integrity team core | Require traceability via REQ / AS / literal user quote; drop unanchored findings. |
| `packages/opencorvus/src/integrity/team-agent.ts` `buildSupervisorPlanPrompt` / `buildSupervisorConsensusPrompt` / `buildReviewerPrompt` | Live prompt renderers | Render the traceability obligation into the three role prompts so the core text is reinforced at the role level. |
| `packages/opencorvus/src/integrity/team-schema.ts` | Reviewer report schema | Keep `requirementIDs` / `specIDs` arrays. Do NOT add host validation. Prompt-level constraint only. |
| `packages/opencorvus/src/requirements/agent.ts` (or wherever the requirements tool collector lives) | Requirements collector | Verify the existing `register_requirement` zod schema accepts `acceptance` and `non_goals`. If not, extend the schema to require them as non-empty strings (this is *data shape* — rule 6.1 allows it because empty strings are a data-integrity failure, not a routing decision). Grep before patching. |
| `packages/opencorvus/src/acceptance/types.ts` | AS schema | No change. Existence-grep ban is a prompt rule; the AS schema itself stays expressive. |

## Test Plan

1. **Requirements-agent unit test** (new):
   `packages/opencorvus/test/requirements/maturity-word-discipline.test.ts`
   - Fixture: user request "写一个成熟的输入 deepseek key 即可聊天的 ai chat 页面".
   - Assert: the requirements agent either decomposes "成熟" into one or
     more bounded REQs (test inspects collector output for at least one
     REQ whose `description` names a concrete error / persistence /
     streaming / validation behavior), OR registers a
     `maturity_scope_pending` decision.
   - Anti-regression: assert NO REQ has empty `acceptance` AND empty
     `non_goals`.

2. **Architect prompt-level test** (new):
   `packages/opencorvus/test/architect/grep-only-as-rejection.test.ts`
   - Fixture: REQ with `acceptance` text "流式输出实时逐 token 渲染".
   - Drive the architect agent with a stub LLM that emits an AS whose
     only scorer is `grep -r 'stream' src/ -l`.
   - Assert: architect rejects the AS as a decomposition defect (either
     surfaces a concern or refuses `submit_architect`), OR the prompt
     forces a richer scorer.

3. **Integrity reviewer scope test** (new):
   `packages/opencorvus/test/integrity/finding-traceability.test.ts`
   - Fixture: reviewer prompt with one REQ (REQ-6 "errors render in
     Chinese for 401/429/network-off") and no AS for bundle size.
   - Drive a stub reviewer LLM that submits one finding "bundle > 500
     kB" with `requirementIDs=[]`, `specIDs=[]`, and no
     `userRequestQuotes`.
   - Assert: supervisor consensus drops the finding from the final
     report (the dropped reason should be reachable in the team report
     markdown so the operator can see why).
   - Positive case: same fixture with a finding "401 returns English
     raw error text" + `requirementIDs=["REQ-6"]` + literal Chinese
     quote — assert it is retained.

4. **End-to-end replay-of-the-real-task test** (snapshot, lightweight):
   - Load the 8 integrity attempts from the DB fixture for
     `tsk_e54c2d091001t145QP2P6xwoqi`.
   - Run them through the new consensus prompt with the traceability
     rule (LLM call mocked with a deterministic stub that respects the
     prompt rules: drop ref=[]+no-quote findings; flag the maturity
     gap as one requirements-extraction concern).
   - Assert: count of blocking findings across rounds collapses to ≤2,
     and the residual finding is "Requirements stage did not land 成熟
     into bounded REQs".

Targeted command after implementation:

```powershell
bun test packages/opencorvus/test/requirements/maturity-word-discipline.test.ts packages/opencorvus/test/architect/grep-only-as-rejection.test.ts packages/opencorvus/test/integrity/finding-traceability.test.ts
```

## Rule 6.1 Self-Check

- Prompt-level traceability obligation: yes.
- Host-level substring / id-existence verification: **no** (would be the
  exact "teach the LLM which route to take via host invariant" anti-pattern
  rule 6.1 forbids).
- Schema-level non-empty constraint on `acceptance` / `non_goals`: yes, but
  scoped to *data shape only* (an empty string is shape-invalid, not
  a routing decision). This is the rule 6.1 carve-out for Zod / DB
  constraint.
- State machine switching reviewer behavior across rounds: no — replay
  awareness handles that, this spec is round-invariant.

## Implementation Checklist

1. [ ] Patch `requirements-core.txt`: add maturity-word landing rule +
   mandatory `acceptance` / `non_goals`.
2. [ ] Patch the requirements collector zod schema to require non-empty
   `acceptance` and `non_goals` (grep all call sites first; rule 35).
3. [ ] Make `maturity_scope_pending` durable either by immediate
   `engine_decision_log` persistence in `register_decision` or by returning it
   as a finalized RequirementsAgent outcome instead of throwing.
4. [ ] Patch orchestrator handling so durable `maturity_scope_pending` routes
   to the normal `question` lane prompt path, not to requirements failure
   retry.
5. [ ] Patch `architect-core.txt`: ban existence-grep AS under behavior
   REQs; require AS anchored to REQ.acceptance text.
6. [ ] Patch `integrity-team-core.txt`: traceability-or-drop rule.
7. [ ] Patch `team-agent.ts` `buildReviewerPrompt` /
   `buildSupervisorConsensusPrompt` to echo the traceability rule at role
   level.
8. [ ] Add the three unit tests above + one replay snapshot test, including a
   requirements clarification-path regression that asserts the decision is
   durable without `submit_requirements`.
9. [ ] Run targeted tests; no broad `bun test`.
10. [ ] Commit + push (rule 33).

## Plan Updates From Patched Review (2026-05-24)

- N-1: user-request quote and maturity-word rendering now references the
  replay-aware shared sanitizer owner. Scope remains the maturity/scope owner
  but does not define sanitizer rules.
- B-1/B-2/N-2: no local prompt cap or snapshot-lineage API is introduced in
  this scope spec; those remain replay-aware-owned surfaces for consumers
  that render replay/history text.

## Plan Updates From Patched Review Round 3 (2026-05-24)

- B-1: `maturity_scope_pending` is now specified as a durable clarification
  outcome. A later scope-worktree PR must either persist the
  `register_decision` call directly to `engine_decision_log`, or change
  RequirementsAgent to return `maturity_scope_pending` as the finalized
  requirements outcome instead of throwing.
- B-1: orchestrator handling must read the durable clarification as a
  `question` lane signal for the user to bound maturity words. It must not
  classify the unfinalized requirements run as a failure and retry
  requirements.
- Implementation impact for the later PR: `requirements-core.txt`,
  requirements collector / `register_decision` plumbing,
  `packages/opencorvus/src/requirements/agent.ts`, and the orchestrator
  requirements-result handler need the matching code and tests in the scope
  worktree commit.
