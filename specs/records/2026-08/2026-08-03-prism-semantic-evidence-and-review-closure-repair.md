# Prism Semantic Evidence And Review Closure Repair

Status: Proposed
Date: 2026-08-03
Owner: Codex

## Recall

### User request

The operator supplied Debug Info for Task
`tsk_fc5d63f37001NjovcJDQEZahFW`, asked which problems the Task exposed, then
requested a complete repair plan and independent Agent review:

> 这个任务暴露了把些问题？

> 攥写完整修复方案并让agent复审

The original Task requested one runnable, independently branded desktop
competitor to TradingView Spaces, with a discovery page, related detail and
creator routes, real interactions, browser inspection, and canonical delivery
evidence.

### Acceptance criteria

- A physical worker Turn ending normally is never called workflow or delivery
  success. Session termination, domain Artifact completeness, review verdict,
  and Task acceptance remain four different facts.
- A selected binding workflow advances only after the Orchestrator has read the
  exact predecessor evidence and judged its declared node contract satisfied.
  The Host does not calculate a business-ready frontier or add a verdict gate.
- A `partial` Frontend Research Artifact remains visible partial evidence. It
  cannot be narrated as accepted surface research or silently converted into
  an accepted empty asset ledger.
- A blocking `needs_correction` review is repaired inside the same Task by
  continuing the exact existing producer and reviewer dispatch occurrences.
  Reviewers remain read-only; no second workflow-node occurrence, retry
  counter, correction state, new Task, fallback, or compatibility path is
  introduced.
- The only design authority is the exact PRD revision causally named by one
  non-blocking Review Artifact through its typed source/evidence locator.
  Time order, labels, and inferred latest/current/history pointers never
  participate in selection. All other PRD and Review Artifacts remain equal
  append-only facts.
- `artifact_read delivery=materialized_file` is a first-class complete-read
  transport. A valid materialized read can be selected and published as exact
  provenance; truly contradictory read facts remain invalid.
- Model-visible Tool schemas, descriptions, and package prompts agree. The
  repair addresses proven repeated call-shape failures without weakening
  strict schemas, accepting aliases, or adding preflight routing.
- Debug output distinguishes physical completion, partial/missing domain
  evidence, review verdicts, and accepted Task completion without parsing
  package prose or introducing a second progress authority.
- Focused positive non-User-Interface (UI) contracts, typecheck, API and docs
  checks, fresh-Task runtime acceptance, manual desktop browser review, second
  independent review, commit, and `git-cc` push all succeed.

### Hard constraints

- Preserve the active fixed Expert Squad, immutable dispatch lineage, one
  Task-owned lifecycle, versioned Delivery Slices, and prompt-owned scheduling.
- Do not add a Host workflow engine, state machine, verdict/Artifact gate,
  automatic retry, fallback, alias, compatibility reader, keyword matcher, or
  hidden/synthetic message.
- Do not let Build substitute for a mandatory Research, PRD, Design, or Review
  occurrence. Repair continues the exact affected occurrence until its domain
  evidence is sufficient.
- Do not let a Reviewer edit the reviewed product or PRD.
- Do not add, modify, update, or run UI automation tests. UI verification uses
  a real desktop page, interaction, screenshots, and human visual inspection.
- Do not reset, restore, stash, create a worktree, rewrite history, broadly
  format, or stage unrelated work. The current worktree contains extensive
  unrelated modifications and untracked files; this plan owns only its new
  record and index entries.
- Current branch is `v0.0.29beta`; pre-plan `HEAD` is
  `4c952b030a`, already equal to `git-cc/v0.0.29beta`. Commit subjects use the
  `dsw-33987` prefix and pushes target `git-cc`.

### Sources read

- Root `AGENTS.md` supplied in the Task context.
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-08/2026-08-01-dispatch-occurrence-process-recovery-root-repair.md`
- `specs/records/2026-08/2026-08-02-same-task-repair-first-orchestration.md`
- `specs/records/2026-08/2026-08-02-phase-local-build-closure-orchestration.md`
- `specs/records/2026-08/2026-08-02-task-acceptance-compaction-and-large-artifact-repair.md`
- `specs/records/2026-07/2026-07-31-prism-requirement-topology-and-coordination-lifecycle-repair.md`
- Installed Prism package revision `2026.08.01.8`, especially
  `expert-squad.jsonc`, the scheduler Skill, PRD Author, PRD Reviewer, UI
  Researcher, and Asset Curator prompts and tools.
- `packages/opencorvus/src/agent/dispatch-outcome.ts`
- `packages/opencorvus/src/orchestrator/dispatch-agent-tool.ts`
- `packages/opencorvus/src/orchestrator/frontend-research-stage.ts`
- `packages/opencorvus/src/engine/describe.ts`
- `packages/opencorvus/src/agent/artifact-read-facts.ts`
- `packages/opencorvus/src/tool/artifact-catalog.ts`
- `packages/opencorvus/src/artifact-catalog/index.ts`
- `packages/plugin/src/artifact-catalog.ts`
- `packages/opencorvus/src/tool/skill.ts`
- `packages/opencorvus/src/architect/output-tools.ts`
- Focused Dispatch Outcome, workflow description, Orchestrator, Artifact
  provenance, Artifact publication, Skill, Architect, Integrity, and Prism
  package tests.
- Read-only SQLite evidence from
  `C:\Users\hengu\.local\share\opencorvus\opencorvus.db` for the exact Task,
  Sessions, Messages, Parts, protocol events, Goals, dispatch lineage, and
  Engine Artifacts. No running Task or database state was changed.

### Whole-repository grep

```text
rg -n "terminal_success|infrastructure_failure|frontend_research_adapter|status.:.partial|needs_correction" packages/opencorvus/src packages/opencorvus/test packages/plugin/src
rg -n "artifact_read|artifact_select|materialized_file|completeArtifactReadsBeforePublication" packages/opencorvus/src packages/opencorvus/test packages/plugin/src
rg -n "continuation_dispatch_id|continuationDispatchID|continuation dispatch" packages/opencorvus/src packages/opencorvus/test specs/current/architecture
rg -n "manage_goal|register_goal|modify_goal" packages/opencorvus/src/architect packages/opencorvus/test
rg -n "file is required when offset or limit is provided|skill.*limit" packages/opencorvus/src packages/opencorvus/test
```

### Independent Agent feedback

Three read-only Agents were explicitly dispatched in parallel and prohibited
from further delegation:

1. Scheduler/workflow review confirmed that adapters currently report physical
   Turn completion regardless of Integrity verdict and that
   `engine/describe.ts` converts it into false workflow success/readiness. It
   supported the four-fact split and rejected a Host verdict gate. It proposed
   a fixed Finalizer plus second Reviewer chain instead of continuation.
2. Artifact/tool-contract review proved the materialized transport/audit codec
   mismatch; classified only two of seven Artifact selection failures as that
   bug; found the Task Artifact snapshot worktree/root ownership inversion;
   identified Skill search/file pagination ambiguity and `manage_goal`'s
   provider-compatibility union pollution; and supplied positive non-UI test
   boundaries.
3. Skeptical architecture review confirmed the four-fact split, rejected a Host
   gate, and compared the PRD closure alternatives. It uniquely recommended
   exact Author/Reviewer occurrence continuation because current architecture
   already assigns review correction to `continuation_dispatch_id`, preserves
   one PRD writer, re-reviews the corrected exact bytes, and does not lengthen
   every successful Task.

In final review the scheduler reviewer withdrew its Finalizer proposal after
checking the current continuation implementation and architecture chapter 13.
It confirmed that continuation reuses the existing Session and logical
occurrence while adding a new immutable dispatch lineage and physical Turn.

The Finalizer proposal is not selected. A Finalizer alone leaves its corrected
bytes unreviewed; adding another Reviewer unconditionally extends both Prism
critical paths and duplicates the already-declared exact-continuation repair
protocol. The selected continuation path keeps Author as the only PRD writer
and Reviewer as the only review writer while giving corrected bytes a fresh
independent review in the same logical occurrences. The dissent is retained in
this record rather than erased.

The reviewers also established these implementation corrections:

- current tracked generic Prism has 16 nodes, 14 critical-path waves, and
  maximum parallel width 2; current AInvest has 18 nodes, 16 waves, and width
  2. The historical installed incident topology had 17/19 nodes before Stage
  Planner replaced its Requirements/Architect pair; latency work must not
  delete real evidence dependencies;
- tracked Prism source under `expert-squads/mirror/prism/**` is the only source
  to edit; the global installed package is updated explicitly through Manager
  and Registry/Resolver digest verification, never hand-edited;
- the historical Spaces Task is frozen to package revision `2026.08.01.8` and
  cannot validate a later package fix;
- current tracked Prism is already revision `2026.08.03.1`, uses
  `mirror-prd-stage-planner`, and is not the historical Requirements/Architect
  topology; implementation begins with an exact frozen-versus-tracked graph
  and prompt diff and must not restore the old incident topology;
- real contradictory Artifact read facts remain invalid. The repair makes the
  legitimate materialized receipt valid; it does not let a later read erase a
  contradiction.

## Proven evidence from the failing Task

### Timeline and current delivery state

| Time (UTC) | Evidence |
| --- | --- |
| 04:16:20 | Task created. |
| 04:17–04:36 | General Research, Requirements, and Architect Sessions completed. |
| 04:37–04:52 | First UI Research dispatch ended in a provider/API connection error. |
| 04:54–05:09 | Continuation UI Research Session ended normally, but persisted Artifact revision 13 is `label=partial`, `status=partial`. |
| 05:12–05:19 | Asset Curator published an `accepted` ledger with `asset_count=0` and explicitly recorded that no accepted observation packet existed. |
| 05:20–05:28 | PRD Author published `.mirror/prd/spaces-system.md`; the product repository still contained no application source. |
| 05:28–05:40 | PRD Reviewer found one blocking contract defect and one advisory schema ambiguity, then published `verdict=needs_correction`. |
| 05:40 | Parent `dispatch_agent` returned `kind=terminal_success`; Orchestrator narrated “设计阶段就绪” and dispatched Page Designer. |

At the operator's 05:30 snapshot all four Goals reported `workflow=6/17`, no
observed changed files, no contribution commits, and no build observations.
After approximately 84 minutes the only project change was the untracked PRD;
implementation had not begun.

### Semantic failures hidden behind physical completion

1. UI Research Artifact `art_fc607516f001RQV98K5mL1VgYY` contains:
   - `status: "partial"`;
   - eleven required collector updates in `missing`;
   - empty evidence, facts, needs, constraints, outline, tasks, and questions.
2. Asset Ledger
   `art_idempotent_11e5e132cf0387a5155eb4c35a20fde881cca933b30774c2997fccfb74b9ccff`
   contains:
   - `status: "accepted"`;
   - `asset_count: 0` and `materialized_bytes: 0`;
   - `accepted_observation_packet: not present`;
   - no screenshot or asset-candidate identity.
3. Integrity Review
   `art_fc6236f09001lz9PxX0UBs6atM` contains:
   - `verdict: "needs_correction"`;
   - blocking fixed reuse of source navigation copy in PRD P3.1;
   - advisory duplicate `ideas/minds/scripts` creator fields;
   - no implementation, runtime, or screenshot evidence.
4. Both the partial UI Research Turn and the rejected PRD Review Turn were
   surfaced to the scheduler as `kind: "terminal_success"` because the child
   Session ended with `reason=completed` and adapter persistence completed.

### Tool failure facts

The Task persisted 25 Tool errors through the completed PRD-review boundary.
Later Page Designer activity continued adding unrelated Tool failures, so this
table uses the fixed 05:40 UTC causal cutoff:

| Tool | Count | Evidence classification |
| --- | ---: | --- |
| `skill` | 6 | Calls supplied `limit` without `file`; current Tool description says `limit` requires `file`. Repeated across roles and therefore requires model-visible schema/prompt calibration, not schema relaxation. |
| `artifact_select` | 6 | The two Reviewer failures are the materialized transport defect. Four Requirements failures changed exact manifest/digest identity and must remain strict failures. |
| `manage_goal` | 11 | Architect repeatedly supplied cross-branch fields, nulls, misplaced `severity`, or incomplete objects. The checkout has a nominal discriminated union plus provider-compatibility field injection and neutral-value normalization; its exact model-visible descriptor must be positively exercised before changing the ABI. |
| `artifact_snapshot` | 1 | PRD Author created and reread the file in its revision worktree, but snapshot execution read from the primary project root. This is a proven execution-directory authority defect, not missing author work. |
| `memory` | 1 | The running runtime rejected `scope=all`; current checkout behavior must not be inferred backward. Compare the exact runtime package/schema before deciding ownership. |

The provider/API connection error was a real physical interruption and was
correctly continued through the same logical occurrence. It amplified latency
but did not cause the later semantic acceptance failures.

## Causal chain

### Observable behavior

The Task remained active with many terminal child Sessions, a growing Artifact
Catalog, and no implementation. Debug output emphasized completed Session
counts and one API error while hiding the already-persisted partial research
status and later blocking review verdict.

### Direct triggers

1. `DispatchOutcome.terminal(...)` emits `kind="terminal_success"` for a
   physical terminal Session after adapter-owned persistence succeeds.
2. `engine/describe.ts` independently derives workflow
   `terminal_success=true` solely from Session `terminal/completed`, builds a
   `terminalSuccessNodeIDs` set, and calculates `frontier_node_ids` from it.
3. The Orchestrator and Prism scheduler prose use “terminal success” for both
   physical execution and mandatory evidence satisfaction.
4. The Asset Curator and PRD Author were allowed to publish downstream outputs
   even though the expected complete UI surface evidence did not exist.
5. The PRD Review completed physically with `needs_correction`; the same
   ambiguous dispatch outcome let the scheduler advance directly to design.

### Deeper design cause

Four separate authorities were compressed into one word:

| Fact | Real owner |
| --- | --- |
| Physical Turn ended | Session status + final message + dispatch lineage |
| Domain output complete/partial | Typed domain Artifact produced by that Agent |
| Review pass/concerns/needs correction | Exact immutable Review Artifact |
| Task accepted/failed | Orchestrator's explicit Task completion decision |

The Host then projected the physical fact as a workflow-ready fact even though
current architecture explicitly says the Host does not compute a frontier and
the Orchestrator must judge durable evidence. Package prompts inherited the
same ambiguity, so valid partial and review facts existed but were not consumed
before the next dispatch.

### Why prior repairs did not close it

- Prior fact/Turn refactors correctly removed domain terminal-tool gates and
  made normal stream end a physical fact, but retained the name
  `terminal_success` in dispatch results and workflow description.
- Prior acceptance repair taught Orchestrators to distinguish advisory from
  blocking reviews after implementation, but the Prism pre-design review path
  did not continue the Author and Reviewer occurrences before Page Designer.
- Prior large-Artifact work introduced `delivery=materialized_file` and tested
  content-addressed materialization, but did not prove the same persisted read
  can pass complete-read provenance and `artifact_select`.
- Prism's fixed graph correctly preserves evidence order, but its scheduler
  Skill treated physical Session completion as sufficient predecessor evidence
  instead of reading the produced Artifact semantics.

## Target architecture

### 1. Physical Turn terminology only

Replace model-visible and describe-level `terminal_success` with an exact
physical term such as `turn_completed`. It means only:

- the exact child Session exists;
- it has a visible final assistant message;
- the physical Session ended normally;
- adapter-owned post-Turn persistence did not throw.

It never means a domain Artifact is complete, a review passed, a workflow node
is satisfied, or a Task is acceptable. `DispatchOutcome` continues to omit
domain Artifact locators; each consumer discovers semantic facts through the
Catalog.

Retire the current dispatch `partial` label if it continues to mean
post-Turn persistence failure rather than domain partial output. Represent a
post-Turn persistence failure through the existing typed infrastructure-failure
shape with the real Session and final-message IDs. Domain partiality remains
only in the domain Artifact.

### 2. Remove the Host-computed business frontier

`engine/describe.ts` must expose raw facts, not readiness:

- exact workflow binding and dependency declarations;
- each immutable dispatch occurrence;
- child Session status and physical completion;
- associated produced Artifact identities/status fields when they have a
  canonical typed projection;
- current Review Artifact verdicts as facts;
- no `terminalSuccessNodeIDs`, `frontier_node_ids`, or derived statement that a
  dependency is semantically satisfied.

The Orchestrator reads these facts plus exact Artifact bodies and makes the
visible scheduling decision. Debug and board projections may group facts for
display, but cannot become an acceptance or scheduling authority.

### 3. Exact-occurrence domain repair

Freeze the current tracked Prism node and dependency topology for this repair.
The selected and only closure is Author/Reviewer continuation:

1. UI Research Turn publishes a typed partial Artifact.
2. Orchestrator reads it, records the missing required evidence, and calls
   `dispatch_agent` with the prior `continuation_dispatch_id`, same UI
   Researcher, same work scope, same workflow occurrence, and same Slice
   subjects.
3. Only a complete current UI Research Artifact can support Asset Curator.
4. PRD Author publishes an immutable PRD revision.
5. PRD Reviewer publishes an immutable Review revision.
6. On blocking `needs_correction`, Orchestrator continues the exact prior PRD
   Author occurrence with the exact finding and required repair.
7. Author publishes immutable PRD Artifact B. Artifact A remains an equal
   append-only fact; neither has a generic current/history pointer.
8. Orchestrator continues the exact prior Reviewer occurrence against that
   exact new PRD revision.
9. Page Designer starts from one Review Artifact with `verdict=pass|concerns`,
   follows its single typed source/evidence locator to the exact reviewed PRD
   revision, and selects that same pair. Neither time order nor label lookup is
   authoritative. Advisory `concerns` remain visible residual evidence.

These are natural Orchestrator decisions over immutable evidence, not a Host
loop. Logical nodes remain once-per-Task; continuation reuses the immutable
logical workflow occurrence and existing worker Session while creating a new
immutable dispatch lineage and physical Turn through
`continuation_dispatch_id`. No second Author/Reviewer node, replacement
Session, Finalizer, correction Task, retry counter, or hidden workflow state
exists.

Implement and positively verify the required causal binding: each Review
Artifact has exactly one reviewed PRD in `source_artifact_locators`, and Page
Designer selects that exact Review/PRD pair. Generic `artifact_publish` creates
append-only Artifacts and provides no current revision pointer. Do not add
“latest by label” guessing or describe A as archived/history and B as current.

### 4. Downstream producer evidence discipline

- Asset Curator must not publish `status=accepted` while its declared complete
  surface-evidence input is absent. It emits a visible coordination/blocker
  message naming the missing exact contract and publishes no candidate ledger.
- PRD Author must select the complete UI Research Artifact and accepted Asset
  Ledger when those are declared workflow predecessors. A missing required
  predecessor cannot be replaced by general research prose.
- Every package publication payload contract validates its payload and exact
  selected sources; core IntegrityReview persistence owns exact Review source
  provenance. Generic `artifact_publish` is not described as a typed package
  publisher and cannot bypass an actual package ABI.
- Prism generic and AInvest workflows, scheduler Skill, role prompts, package
  README, typed publishers, and generated payload must describe the same
  contract.

### 5. Materialized Artifact transport

`ArtifactReadChunkSchema` already models `materialized_path`, but
`auditArtifactReadLocatorsFromFacts` currently recognizes only attachment or
inline text transport. Make the three transports explicit and mutually
exclusive:

| Transport | Required fact shape |
| --- | --- |
| Inline text | `text` present, `attachment=false`, no `materialized_path`, exact requested byte window. |
| Binary attachment | `attachment=true`, no `text` or `materialized_path`, one complete exact resource. |
| Materialized text file | `materialized_path` present, `attachment=false`, no `text`, `delivery=materialized_file`, offset zero, one complete exact decodable-text resource, matching media type, bytes, and digest already verified by the Host materializer. |

Align the producer with the existing Tool contract: `materialized_file` accepts
only a decodable text resource. Binary resources retain the one complete
attachment transport. Do not “recover” by ignoring an invalid earlier fact or
allowing a later read to overwrite it. A genuinely contradictory fact for the
same exact locator remains invalid. The repair makes the legitimate
materialized fact valid at its producer/auditor boundary; a formerly
misclassified valid materialized receipt is not itself a contradiction.

### 6. Worker source-directory authority

Task Artifact storage/runtime authority and worker source-file authority are
different values and must not be collapsed into one directory:

- the Task primary project root continues to own Task identity and immutable
  Task Artifact storage;
- the exact persisted worker `Session.directory`, validated against dispatch
  lineage/project/worktree ownership, is the only source directory from which
  that worker's `artifact_snapshot` reads produced files;
- package Task Artifact tools use the same execution scope instead of deriving
  a parallel project source root;
- no producer copies worktree files back to the primary root merely to make
  snapshot publication succeed.

Repair `task-tool-execution-scope.ts` and `task-artifact/store.ts` at that
boundary. Preserve exact typed `ENOENT` for a file genuinely absent from the
worker source directory; do not add an existence preflight gate.

### 7. Tool ABI and prompt calibration

Treat each repeated error according to exact evidence. Frozen incident calls
are investigation inputs, not authorization to redesign a current global Tool
application programming interface (API):

- `skill`: first render the current provider-shaped descriptor and positively
  reproduce all supported current operations. Only if the current owner still
  exposes the proven overloaded ambiguity may it be directly replaced, in one
  change, by a clean `action=search|load|read_file` discriminated union under
  the fixed projected Tool IDs and one implementation factory.
- `manage_goal`: first positively reproduce register/modify/remove through the
  current provider-shaped descriptor outside the frozen package. Only if the
  current owner still injects cross-branch compatibility fields may that
  injection and neutral-field normalizer be deleted and the visible operations
  replaced atomically by strict register/modify/remove contracts over the one
  collector. Current Prism no longer has the historical Architect occurrence,
  so the incident's eleven errors alone authorize no package or global ABI
  change.
- `artifact_snapshot`: fix the execution source-directory authority described
  above; do not solve it with producer copy instructions.
- `memory`: keep `all` for read-only search/list and require `global|session`
  for writes. Make that action-specific rule and positive write examples
  explicit; do not add `all` as a write alias.

Tool descriptions and positive tests are generated from, or assert against,
the executable schema owner. Do not add keyword-based prompt lint, permissive
null normalization, action guessing, or Host preflight routing.

### 8. Honest observability

The Task Debug Info and read-only board should show separate lines for:

- physical dispatches: streaming, terminal/completed, terminal/error;
- domain Artifacts: complete, partial, missing typed output;
- Review Artifacts: pass, concerns, needs correction;
- file/build observations;
- explicit Task completion decision.

`workflow 6/17` must be labeled physical Turn coverage if that is what it
counts. It must not imply six accepted nodes. Package-specific Artifact facts
come from the backend's canonical catalog projection; the UI does not parse
Prism payload prose, titles, labels, or keywords.

## Implementation workstreams

### Workstream A — fact vocabulary and describe projection

1. Replace `terminal_success` in `DispatchOutcome`, dispatch descriptions,
   domain adapter call sites, prompts, fixtures, and positive tests with the
   physical `turn_completed` term.
2. Fold post-Turn persistence failure into one typed failure contract and
   remove the old ambiguous dispatch `partial` branch if no independent
   semantics remain.
3. Remove `terminalSuccessNodeIDs` and Host-derived `frontier_node_ids` from
   `engine/describe.ts`; render raw dependency and dispatch facts.
4. Update current architecture chapters 01, 08, 09, 15, and 99 so terminology
   and ownership are consistent.

### Workstream B — Prism evidence and repair closure

1. Update Prism scheduler Skill to require exact Artifact reads after every
   predecessor Turn and before every dependent dispatch.
2. Route partial UI Research and blocking PRD review through exact
   `continuation_dispatch_id` of the affected logical occurrence.
3. Update UI Researcher, Asset Curator, PRD Author, PRD Reviewer, and Page
   Designer prompts, package publication payload contracts, and core Review
   provenance so each exact source contract is explicit and self-contained.
4. Make PRD Review cite the exact PRD revision; make Page Designer select that
   exact PRD/Review pair.
5. Before edits, diff frozen installed revision `2026.08.01.8` against current
   tracked revision `2026.08.03.1`; preserve the current Stage Planner graph
   and do not reintroduce historical Requirements/Architect occurrences.
6. Apply the same semantic repair to generic and AInvest Prism prompts and
   typed provenance without changing either node or dependency-edge set. Bump
   the package version and regenerate
   `packages/opencorvus/generated/expert-squad-payload.ts` through the canonical
   generator.
7. Update the installed global package only through Manager with
   `id="mirror/prism"`, `source="builtin"`, and
   `installationScope="global"`; positively verify Registry load and Resolver
   projection digests equal both tracked package and generated payload digests.
8. Use the Expert Squad software-development-kit topology report to assert the
   frozen current topology: generic 16 nodes, 14 critical-path waves, maximum
   width 2; AInvest 18 nodes, 16 waves, maximum width 2, plus each exact current
   edge set recorded before implementation. The historical 17/19 counts belong
   only to installed revision `2026.08.01.8`. Any topology optimization is a
   separate evidence-backed plan, not part of this repair.
9. Replace contradictory package wording with one exact rule everywhere: one
   initial logical occurrence and one existing worker Session, followed when
   evidence requires by a new dispatch lineage and physical Turn in that same
   Session and occurrence; never a replacement Session or second initial
   occurrence.

### Workstream C — Artifact materialization provenance

1. Restrict the producer to decodable text and extend the shared plugin
   Artifact read-fact audit for the explicit materialized-text transport.
2. Keep `artifact-read-facts.ts`, model ToolHost publication, and package
   ToolHost publication on that one shared audit.
3. Add positive contracts proving materialized read → select → publish source
   provenance for an exact text resource.
   A true contradictory fact is verified through the complete typed
   `invalidLocators` or typed error response, not through an assertion that an
   old path is absent or that a later action did not occur.
4. Inspect touched Artifact tests for negative assertions. Delete or rewrite
   every touched negative test as a positive current-contract test according
   to project rule 28.1.

### Workstream D — Tool-call calibration

1. Reconstruct the exact model-visible schemas from failed worker descriptors
   and persisted Tool inputs/errors.
2. Positively exercise current Skill and Goal descriptors. Change their ABI
   only when the current owner reproduces the proven ambiguity; otherwise
   record the failure as frozen-revision history and make no compatibility
   change. Clarify the current Memory write scope.
3. Repair worker source-directory ownership for `artifact_snapshot` and audit
   package Task Artifact tools for the same root inversion.
4. Add positive provider-shaped schema and streaming Tool-call contracts. Do
   not test that obsolete/invalid calls are rejected; test that each current
   operation maps to its explicit successful result.

### Workstream E — debug and manual UI acceptance

1. Extend the canonical backend Debug Info projection with separate physical,
   domain, review, and Task-decision facts.
2. Update the Overlay only if required to display those backend facts; do not
   create a second client-side classifier.
3. If Overlay files are touched, delete any touched existing UI automation
   tests and their test-only fixtures/configuration without running them.
4. Start the real application, open the exact Task Debug surface, inspect it
   manually, capture task-scoped screenshots, and correct visible hierarchy or
   ambiguity before acceptance.

## Positive verification plan

### Non-UI contracts

- Dispatch Outcome: the complete `turn_completed` result equals the physical
  Turn contract, while domain Artifact status is asserted through a separate
  canonical Catalog fact.
- Workflow description: the complete current projection equals the binding
  dependency declarations plus immutable dispatch, Session, Artifact, and
  Review facts consumed by the Orchestrator.
- Frontend Research: an incomplete Turn persists a typed partial Artifact;
  continuation of the exact dispatch occurrence can publish a complete current
  Artifact with the same logical workflow occurrence.
- Prism PRD closure: one Author occurrence publishes revision A, Reviewer
  occurrence publishes a blocking Review bound to A, Author continuation
  publishes revision B, Reviewer continuation publishes a non-blocking Review
  bound to B, and Page Designer consumes exactly B plus its Review. The full
  integration fact set positively equals one `session_id`, one
  `workflow_occurrence_id`, distinct initial/continuation dispatch IDs and
  Turns, Review B's sole PRD source locator equal to B, and Designer's selected
  pair equal to Review B plus B.
- Asset Curator: a complete selected surface-evidence packet produces an
  accepted ledger with traceable surface/asset decisions.
- Artifact provenance: one `materialized_file` read is a complete observed
  fact; the same locator is selected and appears in the publication's exact
  source set.
- Snapshot provenance: the primary root and validated worker revision worktree
  contain different bytes at the same relative path; the immutable snapshot's
  complete bytes and digest equal the worker worktree source exactly.
- Skill and Architect schemas: each supported operation is emitted through its
  provider-shaped schema and reaches its successful current result.
- Debug backend projection: one typed-data fixture exposes physical completion,
  partial domain evidence, review correction, causally accepted revision, and
  Task decision as separate positive facts. It asserts no rendered label,
  visible copy, Document Object Model (DOM), or other UI behavior.

No UI rendering, DOM, source-string, screenshot baseline, pixel, interaction,
or browser-fixture assertion is added or run.

### Commands

Focused commands must be finalized from the touched files, and include at
least:

```text
bun test packages/opencorvus/test/agent/dispatch-outcome.test.ts
bun test packages/opencorvus/test/agent/artifact-read-facts.test.ts
bun test packages/opencorvus/test/tool/artifact-publish.test.ts
bun test packages/opencorvus/test/orchestrator/dispatch-agent-tool.test.ts
bun test packages/opencorvus/test/engine/describe-workflow-execution.test.ts
bun test packages/opencorvus/test/engine/parallel-workflow-frontier.test.ts
bun test packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts
bun test packages/opencorvus/test/tool/skill.test.ts
bun test packages/opencorvus/test/orchestrator/streamed-agent-fact-flow.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun run typecheck
bun run api:routes-check
bun run docs:check
git diff --check
```

Any listed file that contains a touched negative or UI automation test must be
cleaned or replaced before execution under the repository rules.

### Fresh runtime acceptance

Use a fresh isolated database and fresh Task; do not mutate the historical
Task. The acceptance Task must exercise:

1. exact Prism workflow selection;
2. one intentionally incomplete first UI Research Turn followed by natural
   Orchestrator continuation of the same occurrence;
3. a complete surface evidence Artifact and non-empty, traceable asset
   decision ledger;
4. PRD revision A, blocking Review A, exact Author/Reviewer continuations,
   accepted PRD revision B, then design;
5. implementation, real start command, three desktop routes, meaningful
   interaction states, actual screenshots, manual visual correction, and
   independent MirrorTest evidence;
6. Debug Info that labels physical completion separately from Artifact and
   Review semantics;
7. explicit Task completion only after canonical evidence and Host-observed
   changed files/checks exist.

The incomplete Turn arises from a real, observable source/runtime condition;
it is not induced by changing a product prompt or by a saved fixture, script,
hidden steering message, or test hook. If that condition cannot be reproduced
honestly, its continuation semantics remain covered by the positive typed
protocol harness and the fresh end-to-end Task follows the natural complete
path; the runtime result must not be fabricated. The benchmark runs unattended
with a timer that wakes the operator Agent for bounded state inspection. It
must not hold an open log listener.

## Delivery and review sequence

1. Finish the three independent read-only reviews of this plan and revise it.
2. Commit and push this plan plus its required `specs/README.md` and
   `specs/records/2026-08/README.md` index entries while preserving unrelated
   worktree changes, after historical-links and document-health tests pass.
3. Implement Workstreams A–D with focused positive non-UI contracts.
4. Implement Workstream E only after the backend fact projection is final.
5. Run non-UI validation, then real-page manual UI acceptance if UI changed.
6. Ask independent Agents to review scheduler ownership, Artifact provenance,
   Prism single-source closure, test-rule compliance, and the final diff.
7. Resolve every confirmed blocking finding and rerun affected validation.
8. Commit only task-owned paths with `dsw-33987`, fetch and reconcile the
   current delivery branch without overwriting unrelated work, then push to
   `git-cc/v0.0.29beta` without bypassing hooks.

## Risks and non-solutions

- Renaming `terminal_success` without deleting Host frontier derivation does
  not fix the ownership bug.
- Adding `if verdict != pass then block` in Host code is a forbidden gate and
  still lacks natural repair ownership.
- Treating a later valid inline read as permission to ignore an earlier truly
  contradictory read is a fallback and corrupts provenance.
- Letting Asset Curator publish an accepted empty ledger keeps evidence
  laundering intact.
- Letting Page Designer “use best judgment” against a blocking PRD creates a
  second authority.
- Creating a new correction Task, new workflow-node occurrence, retry count,
  or hidden status engine violates same-Task fixed-workflow ownership.
- Adding a fixed Finalizer node without retiring Author's canonical-output
  claim creates two PRD sources and lengthens the critical path. A lone
  Finalizer also leaves its corrected bytes unreviewed; adding another Reviewer
  duplicates the existing continuation protocol and unconditionally lengthens
  both Prism workflows. It is rejected for this repair.
- Calling all 25 pre-design Tool errors one schema bug is unsupported. Each error keeps
  its exact persisted cause until a common owner is proven.
- Optimizing the current 16/18-node counts by deleting real evidence dependencies would
  trade latency for invalid delivery. Remove only accidental serialization
  proven by the package topology and Artifact contracts.

## Completion criteria

This repair is complete only when a fresh Prism Task demonstrates that partial
research and blocking review evidence are visibly repaired within their exact
logical occurrences before downstream dispatch, materialized evidence is
selectable, Debug Info is semantically honest, the final product is implemented
and manually visually reviewed, all focused positive non-UI contracts and
repository checks pass, independent review has no unresolved blocker, and the
task-owned commits are present on `git-cc/v0.0.29beta`.
