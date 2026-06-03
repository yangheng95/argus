# Agent Boundary Refactor Blueprint

Date: 2026-05-12
Status: Draft for implementation, revised after sub-agent review

2026-05-16 lifecycle update: `deliver` accepted is now the task completion
authority. `publish_delivery` is explicit post-delivery artifact export only,
and `prosecute` is post-delivery hardening evidence rather than a pre-publish
review window. See `specs/deliver-accepted-completes-task-2026-05-16.md`.

## 0. Problem Statement

Current agent architecture has responsibility drift, but the fix is not to
invent a new parallel set of agent concepts. The current code already contains
several real single-source candidates:

- `DeliveryEvidenceManifest` is the existing delivery evidence snapshot.
- The retired delivery verifier plus `arbitrateDeliveryVerdict` was the current
  delivery-stage finalization path.
- `requirements` already avoids goal generation.
- `architect` already owns goal graph and contracts.
- `integrity` already runs as an explicit orchestrator tool, not as a hidden
  delivery prerequisite.

The refactor must therefore converge existing runtime truth into sharper
contracts. It must not create a second evidence DTO, second verdict authority,
or second role definition table.

Observed problems:

1. Delivery-stage responsibility is split across manifest assembly, delivery
   tools, retired delivery agent/verifier, `arbiter`, and orchestrator
   `deliver` side effects.
2. `prosecutor` is positioned as an adversarial reviewer, but it does not yet
   consume the same delivery evidence manifest as delivery, and failures can be
   converted into zero-activity results.
3. `integrity` is sometimes described as plan-only, but current code also uses
   post-build requirement-status evidence to judge completion fidelity.
4. Public docs, live prompts, registry descriptions, and prompt catalog output
   have drifted. Some still describe deleted planner behavior or stale
   requirements responsibilities.

## 1. Non-Negotiable Decisions

### 1.1 Role truth lives in code

The canonical role contract must live in code, not in this spec. A spec table is
allowed as documentation, but it cannot be the source of truth.

Target owner:

- `packages/opencorvus/src/agent/role-contract.ts`

Consumers to validate against this contract:

- `Agent.Info.description`
- `/config/prompt` prompt catalog output
- public docs
- zh-CN docs
- live prompts such as `session/prompt/system.txt`
- architecture specs

### 1.2 `DeliveryEvidenceManifest` is the delivery evidence snapshot

Do not add a parallel `DeliveryEvidenceSnapshot`.

The implementation may add helper modules around the manifest, but the persisted
artifact and type family must converge on `DeliveryEvidenceManifest` unless the
manifest is atomically renamed and all old semantics are deleted in the same
change.

### 1.3 Final delivery authority is the delivery stage, not only the LLM agent

Current final persisted verdict is produced by:

1. `DeliveryAgent.verify` submitting a semantic verdict.
2. `arbitrateDeliveryVerdict` applying deterministic host gates.
3. The retired delivery verifier returning the final stage verdict.

This is acceptable only if treated as one delivery-stage finalization mechanism.
The arbiter is not a second agent and must not become a second subjective judge.
It is deterministic projection of already-produced evidence into the final
delivery-stage verdict.

### 1.4 `integrity` is not pure plan review

`integrity` owns requirement/goal integrity review. It may consume post-build
requirement-status evidence to judge real completion fidelity.

It must not:

- run delivery runtime verification
- publish delivery verdicts
- mutate goals directly
- masquerade as a hidden delivery prerequisite

It may:

- report issues
- propose corrections
- propose missing goals
- feed the orchestrator's next decision

### 1.5 Optional prosecutor is not soft-failure prosecutor

Orchestrator may choose not to call `prosecutor`.

Once called, prosecutor failure must be explicit. It cannot be converted into a
zero-counterexample result that is indistinguishable from a successful adversarial
review that found no issue.

## 2. Target Role Contract

This table documents the target, but the implementation source must be the code
role contract.

| Role                | Owns                                                                                    | Must not own                                                                    |
| ------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `orchestrator`      | task wake decisions, stage ordering, retry/fail/restart, task mutation tool use         | requirement extraction, goal graph authoring, subjective final delivery verdict |
| `requirements`      | requirement extraction and foundational technical decisions                             | goals, contracts, retry strategy                                                |
| `architect`         | goal graph, traceability, assembly ownership, cross-goal contracts                      | runtime evidence, delivery verdict                                              |
| `integrity`         | requirement/goal integrity review, including post-build requirement-status fidelity     | delivery runtime verification, delivery verdict, direct goal mutation           |
| `build`             | implementation in worktree                                                              | final acceptance                                                                |
| `delivery-manifest` | deterministic delivery evidence assembly and persisted evidence manifest                | subjective verdict authorship                                                   |
| `delivery-agent`    | semantic accept/reject judgment over delivery evidence and on-demand inspection results | manifest assembly, hidden integrity routing                                     |
| `delivery-arbiter`  | deterministic finalization of delivery-stage verdict from agent verdict plus host gates | subjective review, new evidence creation                                        |
| `prosecutor`        | counterexamples and diagnostic challenge metrics over delivery evidence                 | accept/reject verdict, delivery truth mutation                                  |

## 3. Current Reality Inventory

### 3.1 Preserve

- `deliver` no longer runs integrity internally before delivery verification.
- `requirements` does not produce goals.
- `architect` owns goal graph output.
- `DeliveryEvidenceManifest` already persists required checks, runtime
  readiness, coverage, runtime flows, specialist reviews, review evidence, and
  final gate.
- The retired delivery verifier centralized delivery verification and
  arbitration.
- Prosecutor challenge metrics are forced to `gate_class="diagnostic"` at the
  store layer.

### 3.2 Repair

- Public docs and live prompts still contain stale planner / requirements
  wording.
- Prompt catalog can expose empty default prompts for native editable agents
  such as `integrity` / `prosecutor`.
- Historical: `deliver` auto-publish could bypass the intended `deliver ->
prosecute -> publish_delivery` review window. Superseded on 2026-05-16:
  accepted `deliver` completes the task; `prosecute` is post-delivery evidence.
- `prosecutor.query_diff` is still a stub and its prompt still contains phase
  wording that describes incomplete wiring.
- `runProsecutor` catches broad errors and returns zero activity.
- `orchestrator/tools.ts` owns delivery-adjacent side effects that are not
  represented in the first blueprint: merged render, system artifacts, metrics,
  delivery commits, and LKG rollback.
- `requirement-status` has fallback behavior from missing
  `metadata.source_requirement_id` to internal row id, and tests currently lock
  that behavior.

## 4. Implementation Plan

### Phase A: Add code-owned role contract and repair role drift

Purpose: make role ownership queryable and testable from one code source.

Files to change:

- `packages/opencorvus/src/agent/role-contract.ts` (new)
- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/config/prompt-catalog.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/session/prompt/system.txt`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/web/src/content/docs/**`
- `docs/**`
- `specs/new-arch/01-agents.md`
- `specs/new-arch/13-agent-communication-matrix.md`

Work:

1. Add a role contract module with id, owner sentence, forbidden ownership, and
   default prompt source requirements.
2. Derive or validate `Agent.Info.description` from this contract.
3. Ensure `/config/prompt` never exposes editable native agents with empty
   default prompts unless the role contract marks them as uneditable.
4. Remove stale live references to planner as an active built-in agent.
5. Rewrite requirements docs and prompts to say it extracts requirements and
   foundational decisions, not goals.
6. Rewrite orchestrator commentary to describe workflow-tool orchestration, not
   the deleted plan/eval pipeline.

Tests:

- add role-contract tests covering registry, prompt catalog, public docs,
  zh-CN docs, and live prompts.
- assert `planner` is not documented as an active built-in agent.
- assert `requirements` is not described as goal decomposition.
- assert native editable prompt cards have non-empty default prompts.

Acceptance:

- role descriptions in code, prompt catalog, docs, and live prompts match the
  code-owned role contract.

### Phase B: Formalize integrity vs delivery/prosecutor boundaries early

Purpose: prevent later delivery manifest work from relying on conflicting
review semantics.

Files to change:

- `packages/opencorvus/src/integrity/agent.ts`
- `packages/opencorvus/src/integrity/requirement-status.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/engine/describe.ts` or equivalent prompt-source files

Work:

1. Define `integrity` as requirement/goal integrity review, not pure plan review.
2. Keep post-build requirement-status input, but document it as completion
   fidelity evidence, not delivery runtime verification.
3. Lock that integrity can propose corrections and missing goals but cannot
   mutate/reopen goals directly.
4. Remove contradictory prompt language where integrity is both task-end
   delivery-adjacent review and wave-level build feedback without clear scope.
5. Audit `requirement-status` fallback to internal row id:
   - either remove it and update tests,
   - or explicitly rename it as an allowed legacy compatibility violation to be
     deleted in a later tracked phase.

Tests:

- integrity can report/propose corrections without mutating goals.
- delivery rejection does not mutate integrity artifacts.
- `deliver` still does not call integrity internally.
- requirement-status behavior has an explicit non-fallback contract.

Acceptance:

- integrity's review surface is distinct from delivery runtime verification.
- no prompt or test implies integrity publishes delivery verdicts.

### Phase C: Promote `DeliveryEvidenceManifest` as the only delivery evidence source

Purpose: separate evidence production from semantic verdict without adding a
parallel DTO.

Files to change:

- `packages/opencorvus/src/delivery/manifest.ts`
- `packages/opencorvus/src/delivery/checks/project-gate.ts`
- `packages/opencorvus/src/delivery/service.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- retired delivery agent source

Optional helper files:

- `packages/opencorvus/src/delivery/manifest-context.ts`
- `packages/opencorvus/src/delivery/manifest-reader.ts`

These helpers must wrap `DeliveryEvidenceManifest`; they must not introduce a
second persisted snapshot type.

Work:

1. Treat `DeliveryEvidenceManifest` as the canonical evidence snapshot.
2. Move every delivery evidence input that delivery/prosecutor need into either:
   - the manifest,
   - an explicit pointer from the manifest,
   - or a separately named non-evidence prompt context.
3. Audit retired delivery verifier fields currently computed outside the
   manifest, especially runtime/visual gates passed into arbiter.
4. Audit `orchestrator/tools.ts` delivery side effects:
   - merged worktree render
   - `system_artifacts`
   - metrics and iteration snapshot
   - delivery round commit
   - LKG rollback
5. Classify each side effect as:
   - manifest evidence production
   - delivery-stage finalization
   - publish operation
   - unrelated orchestration side effect to move or document

Tests:

- exactly one manifest builder owns final gate assembly.
- delivery prompt assertions read manifest-derived fields.
- no second `DeliveryEvidenceSnapshot` or parallel persisted artifact family is
  introduced.
- delivery/prosecutor can read the same manifest id.

Acceptance:

- delivery evidence has one persisted source: `DeliveryEvidenceManifest`.
- evidence consumers do not reconstruct a second evidence world.

### Phase D: Clarify delivery-stage final verdict and arbiter authority

Purpose: remove the ambiguity between LLM semantic verdict and final persisted
delivery verdict.

Files to change:

- `packages/opencorvus/src/delivery/service.ts`
- `packages/opencorvus/src/delivery/arbiter.ts`
- `packages/opencorvus/src/delivery/output-tools.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/test/delivery/arbiter.test.ts`

Work:

1. Rename documentation/comments so `submit_verdict` is the semantic verdict
   from `delivery-agent`, not the final persisted delivery-stage verdict.
2. Define `arbitrateDeliveryVerdict` as deterministic finalization over:
   - semantic agent verdict
   - manifest final gate
   - runtime/visual evidence already present in or pointed to by the manifest
3. Preserve existing advisory semantics:
   - required check failures may be auxiliary depending on current policy
   - workspace export and specialist findings are not automatically hard gates
     unless the existing arbiter policy says they are
4. Unify `deliver` auto-publish and `publish_delivery` manifest gate semantics.
   There must be one rule for whether a delivery-stage accepted result may
   publish.

Tests:

- manifest gate failures override semantic accept only through deterministic
  arbiter policy.
- advisory check failures remain advisory where current tests require that.
- `deliver` and `publish_delivery` agree on manifest gate rules.
- final persisted verdict source is delivery-stage finalization, not direct LLM
  output.

Acceptance:

- there is one delivery-stage final verdict path.
- arbiter is deterministic policy, not a second subjective reviewer.

### Phase E: Classify delivery tools and evidence deepening

Purpose: make delivery-agent side effects explicit without pretending the agent
is a pure static reader.

Files to change:

- retired delivery tool source
- retired delivery agent source
- `packages/opencorvus/src/delivery/output-tools.ts`
- `packages/opencorvus/test/delivery/tools-readonly.test.ts`

Work:

1. Classify every delivery tool:
   - manifest inspection
   - evidence deepening
   - runtime inspection
   - verdict submission
   - illegal infrastructure mutation
2. Decide the fate of current side-effecting tools:
   - `run_command`
   - `start_frontend_preview`
   - `screenshot`
   - `memory_write`
3. If retained, define them as agent-requested evidence deepening with explicit
   artifact output, not hidden orchestration.
4. Ensure delivery cannot call host manifest assembly from inside its tool loop.

Tests:

- retained delivery tools are classified and covered.
- delivery cannot invoke manifest assembly as a tool.
- evidence-deepening outputs are visible artifacts or manifest-linked evidence.

Acceptance:

- delivery-agent can inspect and deepen evidence in visible ways.
- delivery-agent does not own host evidence assembly.

### Phase F: Upgrade prosecutor as a manifest-backed sibling reviewer

Purpose: make prosecutor a real adversary over the same delivery facts.

Files to change:

- `packages/opencorvus/src/prosecutor/agent.ts`
- `packages/opencorvus/src/prompt/core/prosecutor-core.txt`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/metrics/store.ts`
- `packages/opencorvus/src/metrics/score.ts`

Work:

1. Replace `query_diff` stub behavior with manifest-backed delivery context.
2. Pass delivery id / manifest id / final verdict context into `runProsecutor`.
3. Give prosecutor read access to:
   - `DeliveryEvidenceManifest`
   - final delivery-stage verdict
   - iteration history
   - current metric results
4. Remove broad catch-to-zero-activity behavior. Failure must return or persist
   explicit failure evidence.
5. Remove stale Phase 4/Phase 5 prompt language after wiring is real.
6. Define "diagnostic only" precisely:
   - challenge metrics may affect diagnostic aggregate scores if current metric
     design requires it
   - challenge metrics must not become final acceptance authority

Tests:

- prosecutor can read manifest-backed diff/evidence.
- prosecutor failure is not indistinguishable from no counterexamples.
- prosecutor cannot write final delivery verdict state.
- diagnostic challenge metrics cannot become acceptance authority.
- accepted delivery completion leaves prosecutor usable as post-delivery
  hardening evidence, without making publish the lifecycle gate.

Acceptance:

- prosecutor has enough evidence for meaningful counterexamples.
- prosecutor has no accept/reject power.
- prosecutor failures are visible.

### Phase G: Lock stage contracts with tests

Purpose: make the boundaries hard to regress.

Files to change:

- new tests under `packages/opencorvus/test/agent/`
- new tests under `packages/opencorvus/test/orchestrator/`
- new tests under `packages/opencorvus/test/prosecutor/`
- new docs/prompt consistency tests

Required assertions:

- requirements has no goal registration output surface.
- architect is the only goal graph producer.
- integrity proposes corrections but does not mutate/reopen goals directly.
- delivery does not call integrity internally.
- delivery-stage final verdict goes through service + deterministic arbiter.
- prosecutor reads the same manifest but cannot publish verdicts.
- public docs, zh-CN docs, prompt catalog, registry descriptions, and live
  prompts match role contract.

Acceptance:

- future role drift fails tests before it ships.

### Phase H: Optional runtime abstraction cleanup

Purpose: clean runtime naming only after responsibility ownership is stable.

Files to change:

- `specs/new-arch/14-agent-runtime-mode.md`
- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/agent/runner.ts`
- runtime policy/config files as needed

Work:

1. Adopt `AgentSpec + RuntimeMode + ContextStrategy + BudgetPolicy`
   terminology where it removes real confusion.
2. Keep business ownership unchanged during this phase.
3. Move runtime/policy concerns out of role descriptions only after role
   contract tests are passing.

Acceptance:

- runtime cleanup is a mechanical follow-up, not a semantic redesign.

## 5. Migration Order

Strict order:

1. Phase A
2. Phase B
3. Phase C
4. Phase D
5. Phase E
6. Phase F
7. Phase G
8. Phase H

Reason:

- Phase A stops role truth drift.
- Phase B resolves review-boundary conflicts before manifest work.
- Phase C converges evidence onto the existing manifest.
- Phase D defines final delivery-stage authority.
- Phase E makes delivery-agent tool side effects explicit.
- Phase F gives prosecutor real evidence and removes soft failure.
- Phase G locks the behavior.
- Phase H waits until semantic ownership is stable.

## 6. Test Matrix

Required targeted suites:

1. `packages/opencorvus/test/agent/*role*.test.ts`
2. `packages/opencorvus/test/delivery/agent.test.ts`
3. `packages/opencorvus/test/delivery/arbiter.test.ts`
4. `packages/opencorvus/test/delivery/project-gate.test.ts`
5. `packages/opencorvus/test/delivery/tools-readonly.test.ts`
6. `packages/opencorvus/test/integrity/requirement-status.test.ts`
7. `packages/opencorvus/test/orchestrator/tools.test.ts`
8. new `packages/opencorvus/test/prosecutor/*.test.ts`
9. docs / prompt catalog consistency tests

Required assertions:

- one role contract source in code
- one delivery evidence source: `DeliveryEvidenceManifest`
- one delivery-stage final verdict path: service + deterministic arbiter
- one goal decomposition authority: architect
- one lifecycle decision authority: orchestrator
- prosecutor has manifest access but no verdict power
- integrity and delivery do not both decide final delivery acceptance
- optional prosecutor cannot fail as zero-activity success

## 7. Risks

### Risk 1: creating a second evidence DTO

Mitigation:

- forbid parallel `DeliveryEvidenceSnapshot`.
- extend or atomically rename `DeliveryEvidenceManifest`.

### Risk 2: mislabeling arbiter as a second judge

Mitigation:

- define arbiter as deterministic delivery-stage finalization.
- keep subjective review in `DeliveryAgent.verify`.

### Risk 3: over-shrinking integrity

Mitigation:

- preserve requirement-status completion fidelity.
- forbid only delivery runtime verification and final verdict publication.

### Risk 4: prosecutor optionality becoming fallback

Mitigation:

- absence of prosecutor call is allowed.
- failed prosecutor call is explicit failure evidence.

### Risk 5: doc fixes missing live prompt surfaces

Mitigation:

- role-contract tests must scan public docs, zh-CN docs, live prompts, prompt
  catalog, registry descriptions, and core specs.

## 8. Acceptance Criteria

This refactor is complete only when all items below are true:

1. `requirements`, `architect`, `integrity`, `delivery-agent`,
   `delivery-arbiter`, and `prosecutor` each have one code-owned ownership
   sentence that docs and prompt catalog validate against.
2. `DeliveryEvidenceManifest` is the only persisted delivery evidence source.
3. Delivery-stage final verdict is produced by one path:
   `DeliveryAgent.verify` semantic verdict plus deterministic arbiter
   finalization in the retired delivery verifier.
4. `prosecutor` reads the same manifest-backed evidence as delivery and cannot
   write acceptance verdicts.
5. `integrity` may use requirement-status completion evidence but does not run
   delivery runtime verification or publish delivery verdicts.
6. `deliver` accepted owns task completion; `publish_delivery` is artifact export
   and must not write task lifecycle.
7. prosecutor failures are visible and cannot be collapsed into no-op success.
8. no user-facing or internal live docs describe planner as active.
9. targeted tests pass.

## 9. Non-Goals

- Do not create a second delivery evidence artifact family.
- Do not create a second subjective acceptance authority.
- Do not reintroduce planner as a compatibility shell.
- Do not delete advisory-vs-blocking delivery policy accidentally.
- Do not mix runtime abstraction cleanup into the first responsibility repair.
- Do not rely on prompt prose alone; every critical boundary must be enforced by
  tool surface and tests.
