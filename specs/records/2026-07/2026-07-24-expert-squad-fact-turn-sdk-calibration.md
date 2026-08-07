# Expert Squad Fact And Turn SDK Calibration

Date: 2026-07-24

Status: Calibration updated for the append-only fact architecture; final
repository validation is recorded below.

## Recall

| Item                     | Requirement or evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User requirement         | Check whether the core chain is complete. If it is complete, calibrate every Squad, the Software Development Kit (SDK), documentation, and descriptions to the repaired architecture.                                                                                                                                                                                                                                                                                                                                                                        |
| Core chain inspected     | Orchestrator dispatch, immutable dispatch lineage, immutable Goal attempt, real Session and SessionPrompt execution, RequirementSet/ContractGraph/domain fact persistence, Host observations, VisualReview/IntegrityReview evidence, append-only completion decisions, Task API, Board, and Orchestrator read models.                                                                                                                                                                                                                                        |
| Core validation baseline | The focused architecture suites prove Task Run/execution-liveness retirement, immutable Goal attempts, physical root-Session wake ordering, exact RequirementSet/ContractGraph bindings, natural visible messages, Host observations, and Orchestrator-owned completion without an acceptance aggregate.                                                                                                                                                                                                                                                     |
| Residual found           | Runtime execution is not blocked, but the English and Chinese SDK reference still advertises the deleted `client.run.*` namespace. The portable Expert Squad template also says `base_role` selects a finalizer template, and three core prompts still use retired packet/finalize wording. These are authoring and documentation defects that can teach new Squads the deleted model.                                                                                                                                                                       |
| Squad catalog            | Calibrate all eight repository-distributed packages: built-in `general`, `frontend-innovate`, `frontend-replica`, `research-studio`, `review-debug`, `mirror/prism`, `tanzeqi/mirror-watch`, and `wujiang/opentest`.                                                                                                                                                                                                                                                                                                                                         |
| Hard constraints         | Do not add a semantic Host gate, prompt keyword validator, workflow state, fallback, alias, live/current execution source, or second fact schema. Keep package overlays domain-specific; the platform core prompt remains the runtime protocol source. Do not restart OpenCorvus, Overlay, or any sidecar. Preserve concurrent user edits.                                                                                                                                                                                                                   |
| Sources read             | `specs/current/architecture/15-agent-facts-and-turns.md`, `01-agents.md`, `03-control.md`, `09-verification-evidence.md`, the Task Run retirement record, all eight manifests and READMEs, SDK authoring source/tests, portable template instructions, English/Chinese Agent and SDK docs, generated OpenAPI/SDK, and payload generator.                                                                                                                                                                                                                     |
| Whole-repository grep    | Searched production, public docs, SDK, all Squad packages, General, portable template, and generated payload for Task/Goal Run, active/live/current Run, execution lease, terminal/finalizer tools, structured output, Context/Evidence Packet, Agent/Build report, Host facts, Goal attempt, dispatch lineage, acceptance candidate, and SDK run namespaces.                                                                                                                                                                                                |
| Independent Agent        | A one-layer independent read-only reviewer audited the final architecture. It found no P0 and identified three P1 gaps: a replaceable Task completion slot, unchecked evidence-ref strings, and stale documentation-health callers. It also identified missing final-message proof and one unused latest-selector helper. This implementation replaces the slot with append-only facts, validates typed same-Task refs, updates document health, binds IntegrityReview to its final message, extends the real streamed E2E, and deletes the unused selector. |
| Concurrent worktree      | A separate edit stream changed metrics, Orchestrator, acceptance, Agent runner/tool, TracePanel, tests, and current architecture files while this calibration was running. This record does not overwrite, stage, or claim those files.                                                                                                                                                                                                                                                                                                                      |

## Architectural Judgment

The repaired core chain is complete enough to calibrate its consumers:

```text
visible dispatch_agent call
  -> immutable dispatch_lineage artifact
  -> immutable Goal attempt when Goal-scoped
  -> real child Session and physical Turn
  -> domain facts plus visible final assistant message
  -> Host-owned git/command/test observations
  -> VisualReview and IntegrityReview facts with exact producer messages
  -> typed same-Task evidence refs
  -> append-only task_completion_decision artifact
  -> exact artifact time == engine_task.time_completed projection
  -> Task API, Board, Progress, and Orchestrator exact-ID reads
```

No Task Run, active Run, execution lease, task-latest acceptance selector,
replaceable terminal-decision slot, or terminal-report gate is required
anywhere in that chain.

## Calibration Contract

All projected Squad agents inherit the platform Agent-fact and Turn contract:

1. Domain tools record or accumulate durable domain facts. They are not
   terminal submit/finalizer calls.
2. A normal stream end is only a physical Turn observation.
3. The visible final assistant message carries the narrative handoff,
   limitations, blockers, and stable references.
4. Git changes, command/test exits, process facts, and attachment consumption
   are Host observations and must not be self-reported as a competing source.
5. Goal attempt and dispatch lineage are immutable evidence identities, never
   liveness or scheduling locks.
6. The Orchestrator judges completeness from visible facts and calls the Task
   lifecycle tool. Each completion appends one typed decision artifact with
   exact tool/message identity and validated same-Task refs. Reopen preserves
   earlier decisions; no Task-current pointer or copied narrative is written.
7. `goal_concurrency` and virtual workflows are scheduler guidance/contracts,
   not Host admission or persisted execution state.

Package overlays may add domain rules but cannot redefine those seven platform
ownership boundaries.

## Complete Call-Point Disposition

| Surface                | Files or packages                                                                                            | Disposition                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core prompt vocabulary | `requirements-core.txt`, `goal-workload-analyst-core.txt`, `frontend-research-core.txt`                      | Replace “Finalize” and generic evidence-packet wording with visible handoff and exact durable fact/reference wording. Keep existing no-finalizer fact tools.                                                                                   |
| Built-in General       | `packages/opencorvus/src/expert-squad/builtin/general/{README.md,expert-squad.jsonc}`                        | Document inherited fact/Turn boundary and bump the strict dated package version.                                                                                                                                                               |
| External Squads        | All seven `expert-squads/**/{README.md,expert-squad.jsonc}` package roots                                    | Add the same ownership boundary in package terms, preserve domain-specific rules, and bump each strict dated version.                                                                                                                          |
| Agent overlays         | All package `agents/**/system.md`, selectors, and Skills                                                     | Whole-repository audit only. Change only proven stale protocol wording; do not duplicate the global core prompt into every role overlay.                                                                                                       |
| SDK authoring          | `packages/sdk/js/src/expert-squad-authoring.ts`                                                              | Clarify in public type documentation that package prompts extend rather than replace the platform fact/Turn protocol. Add no semantic keyword gate or duplicate schema.                                                                        |
| SDK regression         | New SDK test over General and all seven external package roots                                               | Parse every real manifest, validate every complete package through the SDK package validator, assert current versions and package fact/Turn documentation, and reject the retired finalizer-template wording in the portable authoring source. |
| SDK reference          | English and Chinese `reference/sdk.mdx`                                                                      | Remove deleted `client.run.*`; publish `client.goal.*` and `client.goalAttempt.*` exact routes plus the fact/Turn authoring boundary.                                                                                                          |
| Agent docs             | English and Chinese `agents.mdx`                                                                             | Document domain facts, visible final messages, Host observations, immutable Goal attempts/dispatch lineage, and append-only exact completion decisions.                                                                                        |
| Platform concepts      | English and Chinese `concepts/architecture.mdx`, portable template docs                                      | Delete `/run` from route examples and replace finalizer/evidence-packet authoring claims with the current fact/Turn model.                                                                                                                     |
| Generated artifacts    | `packages/opencorvus/generated/expert-squad-payload.ts`, generated OpenAPI/SDK when generation reports drift | Regenerate from authoritative sources. Never hand-edit generated payload or generated client files.                                                                                                                                            |
| Spec indexes           | `specs/README.md`, `specs/records/2026-07/README.md`                                                         | Index this record and keep the facts/Turn architecture chapter as the current source.                                                                                                                                                          |

## Verification Plan

- Re-run the 137-test core architecture suite.
- SDK all-Squad package validation and existing SDK authoring suites.
- Expert Squad Registry, payload-generation, package-isolation, virtual
  workflow, and real package round-trip tests.
- Negative scans for retired Run/finalizer/packet authoring claims.
- Expert Squad payload generation and clean generated-diff inspection.
- `bun run typecheck`.
- `bun run api:routes-check`.
- `bun run docs:check`.
- Historical documentation and document-health tests.
- `bun run --cwd packages/overlay check:i18n`.
- `git diff --check`.

No running application or sidecar process is part of this verification.

## Implementation Result

- Added the seven-point Fact and Turn contract to General and all seven
  repository-distributed external Squad READMEs.
- Bumped all eight strict calendar versions and calibrated their catalog
  descriptions to durable facts and visible Turn handoffs.
- Updated the portable authoring generator, regenerated its complete artifact
  root, and removed the claim that `base_role` selects a finalizer template.
- Updated the SDK authoring type documentation and added a repository-level SDK
  regression that validates all eight real packages plus the generated portable
  sample through `validateExpertSquadPackageDefinition`.
- Calibrated remaining repository test callers to the immutable
  dispatch-lineage constructor, Turn-resolved Skill surface, current General
  projected identities, visible Mirror Watch handoff, and canonical reserved-ID
  error. No production compatibility path was added.
- Replaced stale packet/finalize wording in the exact affected core/package
  prompts without adding a Host validator or second protocol.
- Regenerated `packages/opencorvus/generated/expert-squad-payload.ts` from the
  authoritative package sources.
- Updated English and Chinese SDK, Agent, architecture, and Agent-loop
  documentation. The public SDK reference now publishes
  `client.goalAttempt.*`, not the deleted `client.run.*`.

## Validation Result

Calibration-owned checks:

- Full JavaScript SDK suite: 51 passed, 0 failed.
- Full Expert Squad suite: 445 passed, 1 skipped, 0 failed, 7,055 assertions.
- New all-Squad SDK calibration: 9 passed, 0 failed, 86 assertions.
- Focused package/payload/calibration rerun: 23 passed, 0 failed,
  245 assertions.
- SDK build from generated OpenAPI: passed.
- API route inventory: passed, 6 rules across 31 files.
- Generated API documentation check: passed, 282 operations across 23 groups.
- Historical documentation links: 21 passed.
- Generated payload equality, portable-template generation, package validation,
  and real package round trips passed.
- `git diff --check`: passed.
- Retired `client.run.*`, `/run`, finalizer-template, and evidence-packet
  authoring scans are clean on the calibrated production/package/public-doc
  surfaces; remaining hits are negative assertions or explicit retirement
  explanations.

Repository-wide closure:

- Current focused execution/evidence/acceptance suite: 125 passed, 0 failed,
  915 assertions.
- Metrics store/executor: 26 passed after migrating every fixture to
  `observation_class`, `unmet_target_count`, and `regressed_target_count`.
- Acceptance evidence: 27 passed after deleting the arbiter, removing
  manifest-level verdicts, and proving coverage/readiness observations do not
  skip independently runnable checks.
- Compaction/message evidence: 112 passed after deleting the retired active
  Build-contract aggregate from maintenance and test inputs.
- Full typecheck: all 9 package tasks passed.
- Historical links and document health: 82 passed, 0 failed,
  1,381 assertions.
- API route inventory and generated API documentation checks passed.
- Overlay panel internationalization check passed.
- Node-launched Playwright visible-final-message card test: 1 passed, 0
  failed. The inspected screenshot at
  `packages/overlay/.scratch/visible-agent-message-card/visible-final-message-with-tool-details.png`
  shows one visible narrative handoff, exact agent identity, and tool activity
  confined to the expanded work-details surface.
- Production/package/public-document scans contain no retired packet, report,
  finalizer, Build-contract, metric-gate, or acceptance-arbiter protocol.

OpenCorvus and every sidecar remained untouched.

## Independent Final Review Correction

The independent final reviewer rejected the first closure because producer and
evidence integrity was enforced by normal callers rather than by the unique
append writers. That finding was correct. The final implementation therefore
moved the invariant to the persistence boundary:

- `recordTaskCompletionDecision` now resolves and validates every typed
  same-Task evidence ref itself. It also proves that the referenced
  Orchestrator assistant message and exact tool part exist and match the stored
  Session, call identifier, and visible tool name.
- `recordIntegrityReview` now proves that the producer is a completed assistant
  message in an Integrity Session owned by the same Task. It validates every
  Goal, RequirementSet, ContractGraph, and evidence artifact reference against
  the same Task, including the required artifact kind where applicable.
- The Integrity prompt now calls its input the selected persisted requirement
  facts; it no longer implies a Task-active RequirementSet.
- Negative tests prove that append writers reject foreign Task producers,
  incomplete assistant messages, missing evidence, missing Goals, and wrong or
  foreign artifact references. Test fixtures now create real persisted producer
  Sessions/messages rather than string-shaped references.
- The second streamed end-to-end review exposed an unrelated SQL projection
  defect in the concurrently added agent-message reference read model:
  `message` stores completion time inside `data.time.completed`, but the query
  selected a nonexistent physical `m.time_completed` column. The query now
  reads the canonical JSON field. Its focused regression passes, and the real
  streamed Requirements → Architect → Build → Integrity → completion chain
  reaches terminal completion again.
- Two stale comments that still named a projected-agent “execution lease” were
  removed. There is no corresponding Task/Goal lease implementation or
  persisted live/current Run aggregate.

This is a pure data-integrity constraint at the fact writer. It does not select
a workflow, block dispatch, infer current work, or decide completion.

Post-correction focused verification:

- full affected Orchestrator tool suite: 100 passed, 0 failed, 919 assertions;
- append-only completion writer: 2 passed, 0 failed, 22 assertions;
- Integrity writer/history/visibility: 6 passed, 0 failed, 41 assertions;
- agent-message reference SQL projection: 1 passed, 0 failed, 15 assertions;
- streamed Requirements → Architect → Build → Integrity → completion chain:
  1 passed, 0 failed, 56 assertions;
- full typecheck: all 9 package tasks passed;
- API route inventory: 6 rules across 31 files;
- generated API documentation check: 282 operations across 23 groups;
- historical links and document health: 82 passed, 0 failed,
  1,381 assertions;
- `git diff --check`: passed.

The same independent reviewer re-ran the corrected implementation and returned
final **ACCEPT**, with no P0, P1, or P2 finding in the fact/Turn,
append-only-completion, or writer-boundary scope. Its independent rerun covered
the writers, Integrity, restart-safe message-reference projection, the real
streamed chain, all Squad/portable/SDK/document-health surfaces, root typecheck,
API routes, generated documentation, and diff health. It confirmed that the
remaining process-level tool/Session execution identity checks are not
Task/Goal admission, acceptance, completion, or persisted live-state locks.
