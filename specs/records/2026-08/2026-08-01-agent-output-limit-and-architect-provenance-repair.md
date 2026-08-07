# Agent Output-Limit And Architect Provenance Repair

Date: 2026-08-01
Status: Implemented
Owner: Codex

## Recall

### User request

The user supplied Task Debug Info for Task
`tsk_fb93ed2f0002HGiVq4XYymuvOV` (`Phase 01: Spaces 竞品产品系统交付`), asked which
failures were systemic versus incident-specific, and then instructed Codex to start the
repair.

Read-only reconstruction of the immutable runtime database proved this causal chain:

1. The first Architect Session `ses_046abe9c0ffehRthqq7Zepy2Z8` completely read the
   26,373-byte RequirementSet in two contiguous windows; its terminal window reported
   `complete=true`.
2. The same Turn never called `artifact_select` or `manage_goal` and ended with
   `finish=length` after 32,001 output/reasoning tokens.
3. The shared Runner published the Session as `terminal/completed` because it only turns a
   stamped `finalMessage.info.error` into an `AgentRunError`.
4. Architect Stage persisted an unprojectable Candidate but mislabeled the missing
   RequirementSet semantic selection as an incomplete read.
5. The Orchestrator trusted that false diagnosis and dispatched a structural re-entry that
   repeated reads instead of first correcting selection and typed Goal publication.

### Acceptance criteria

- A persisted assistant message with `finish=length` produces one visible typed Agent
  execution failure and a terminal error Session fact; it is never reported as ordinary
  `completed`.
- Normal `finish=stop` without a domain output tool remains a physically completed Turn.
  This repair must not recreate a required-terminal-tool gate or Host retry policy.
- Architect Candidate conflicts distinguish a completely unread RequirementSet from a
  completely read but unselected RequirementSet.
- Architect structural re-entry guidance tells the model to select the governing
  RequirementSet immediately after its complete read and to publish typed Goal facts before
  optional narrative elaboration.
- Existing consumer-owned Artifact provenance remains the single source:
  `observed_artifact_locators` are complete reads and `source_artifact_locators` are explicit
  semantic selections.
- Non-UI positive contract tests cover output-limit classification and both Architect
  RequirementSet provenance outcomes.
- No running OpenCorvus Task, Overlay, process, or database is restarted or mutated.
- Concurrent package-revision changes already present in the shared worktree remain intact.

### Hard constraints

- No Host preflight gate, automatic retry, fallback, compatibility alias, state machine, or
  required terminal-report protocol.
- Do not infer success or failure from Agent names or titles.
- Do not rewrite a completed physical Session because later Artifact persistence fails;
  classify `finish=length` before ordinary completion publication because it is the model
  Turn's own terminal fact.
- UI automated tests must not be added, modified, or run. The touched Task Debug formatter
  path exposed an existing frontend-copy automation test; delete that prohibited test without
  changing the formatter or product surface.
- Preserve every unrelated dirty path; do not stash, reset, restore, clean, or create a
  worktree.
- Commit subjects use the `dsw-33987` prefix and push to `legacy-remote/v0.0.27beta` without
  bypassing hooks.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-20-task-research-dispatch-observability-systemic-repair.md`
- `specs/records/2026-07/2026-07-25-task-cancel-durable-agent-status-settlement.md`
- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`
- `specs/records/2026-07/2026-07-28-goal-attempt-shutdown-retry-convergence.md`
- `specs/records/2026-07/2026-07-29-watch-artifact-and-terminal-protocol-convergence.md`
- Runtime Task, Session, Message, Part, Artifact, Decision Log, Goal, and Protocol Event rows
  from the immutable database snapshot.

### Whole-repository search evidence

- `rg -n "artifactProvenanceForAgentTurn|artifactProvenanceForSession|completeArtifactReadLocatorsForSession|sourceArtifactLocators" packages/opencorvus/src packages/plugin/src`
- `rg -n "finish: ['\"']length|finish.*length|MessageOutputLengthError|buildHardErrorFromFinalMessage" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "candidateConflicts|unprojectable_goal_contract|without fully reading|requirementSetArtifactLocator" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "publishSettledSessionTerminalStatus|session.status|terminal.*completed" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "Task Debug Info|agentInvocationDAG|abnormal terminal|terminal reasons|debug-info" packages/overlay/src packages/opencorvus/src packages/opencorvus/test packages/overlay/test`

### Independent agent feedback

A read-only Claude Code architecture challenge was invoked with only `Read`, `Grep`, and
`Glob`. The first invocation read the required plan and relevant output-limit/provenance
sources, but its streamed final result exceeded the local capture budget and was not usable
as a review verdict. A second concise invocation was rejected by the external account limit
with `You've hit your monthly spend limit`. No Claude conclusion is therefore claimed as
evidence. No delegated sub-agent is used; the current Agent retains implementation, review,
commit, and push ownership.

## Call-site disposition

| Contract / call site | Disposition |
| --- | --- |
| `agent/runner.ts::buildHardErrorFromFinalMessage` | Extend the existing single hard-error classifier to recognize the real assistant `finish=length` fact through the existing `Message.OutputLengthError`; preserve stamped provider errors and soft abort semantics. |
| `agent/runner.ts::completeProjectedWorkerTurn` | Keep the existing call before terminal publication. A classified output limit therefore follows the existing failure path and cannot be published as completed. |
| `orchestrator/agent.ts` | Keep its existing call to the same classifier so Orchestrator Turns receive identical output-limit semantics. |
| `agent/artifact-read-facts.ts` | Preserve unchanged as the single complete-read and semantic-selection provenance source. |
| Requirements, Architect, Build, Research, Frontend Design, Visual QA, Integrity, Fact Check, and Workload provenance consumers | Preserve the shared protocol. This incident does not justify adapter-specific provenance copies or a fallback source. |
| `architect/agent.ts` | Preserve derivation of the governing RequirementSet exclusively from selected sources; expose observed complete reads already present in `inputFacts`. |
| `orchestrator/architect-stage.ts` | Replace the false generic conflict with exact typed RequirementSet provenance classification derived from selected and observed facts. Preserve Candidate publication and natural Orchestrator judgment. |
| `engine/goal-graph-projection.ts` | Extend the strict conflict code enum with exact RequirementSet unread and unselected codes; do not retain the misleading code as a compatibility alias for this condition. |
| `prompt/core/architect-core.txt` | Strengthen execution ordering: complete read, immediate select, typed Goal/graph facts, then concise narrative. Do not force tool choice or add a Host completion contract. |
| `session/status-publication.ts`, `engine/task-agent-lifecycle.ts`, coordination settlement callers | Preserve current single terminal publication and cancellation settlement sources. The supplied snapshot does not prove a second lifecycle writer is required. |
| `orchestrator/task-event.ts`, `engine/model.ts`, `overlay/src/utils/debug-info.ts` | Preserve current DAG and Debug Info surfaces in this root repair. Once output limits publish terminal error, existing abnormal-terminal projection will expose them without UI-specific parsing or a second status source. |
| `overlay/test/task-debug-info.test.ts` | Delete the prohibited frontend-copy automation test discovered in the touched Task Debug path; do not replace it with another UI assertion. |

## Implementation plan

1. Add output-limit classification to the shared final-message error classifier and a
   positive Runner contract regression.
2. Add exact RequirementSet provenance conflict codes and a pure Architect classification
   helper backed by selected/observed facts.
3. Use the helper in Architect Stage Candidate persistence and strengthen Architect prompt
   ordering.
4. Add positive non-UI tests for unread and read-but-unselected RequirementSet outcomes and
   for a selected RequirementSet producing no provenance conflict.
5. Delete the discovered prohibited Task Debug UI automation test and stale negative Runner
   assertions; retain only current positive error/result contracts.
6. Run focused tests, package typecheck, document health, and an independent code review.
7. Re-query HEAD and staged paths, create an isolated current-HEAD index commit containing
   only task-owned paths if the shared index/worktree remains dirty, then push `legacy-remote`.

## Verification plan

- `bun test packages/opencorvus/test/agent/runner-hard-error-propagation.test.ts`
- Focused Architect provenance/Stage contract test selected after inspecting existing test
  ownership; no UI test may be run.
- `bun run typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Corresponding document-health and docs single-source tests required by the spec index
  update.

## Codex review feedback

The second review confirmed the root repair remains within the existing ownership model:

- `buildHardErrorFromFinalMessage` is the one shared pre-completion classifier used by both
  projected workers and the Orchestrator. Classifying the real `finish=length` there reaches
  the existing Agent failure and terminal-error publication path; no second lifecycle writer
  is needed.
- Ordinary `finish=stop`, soft abort, and part-level tool errors retain their existing
  semantics. No required terminal tool or automatic retry was introduced.
- `artifactProvenanceForAgentTurn` already supplies both observed and selected locators.
  Architect Stage now consumes those facts directly and does not rescan messages or create a
  provenance copy.
- The first draft correctly separated unread and unselected RequirementSets. Review tightened
  the Runner documentation, removed an absolute prompt claim about output exhaustion, deleted
  stale negative Runner assertions, and deleted the prohibited Task Debug frontend-copy
  automation test discovered in the touched path.
- No proven evidence justified a new orphan-Session recovery writer. Existing cancellation
  settlement remains the only post-settlement convergence path; output-limit Turns now publish
  terminal error through the normal worker failure path.

## Implementation

- Shared Runner converts a real assistant `finish=length` into the existing
  `MessageOutputLengthError` before ordinary Session completion publication.
- GoalGraph conflict schema now carries exact `requirement_set_not_read` and
  `requirement_set_not_selected` codes.
- Architect Stage derives the conflict from the same Turn's selected RequirementSet locator
  and observed complete RequirementSet count, while preserving the existing unprojectable
  Candidate contract.
- Architect Core now prioritizes complete read → immediate selection → typed Goal/graph facts
  before optional supporting resources and long narrative.
- Positive non-UI contract coverage proves output-limit classification and all three exact
  RequirementSet provenance results.
- The prohibited Overlay Task Debug formatter automation test and stale negative Runner
  assertions were removed without changing the product formatter.

## Verification results

- Focused output-limit and Architect provenance: 10 passed, 0 failed, 22 assertions.
- Artifact read facts, Runner terminal prompt ownership, Architect Agent/re-entry, and
  Architect Stage: 16 passed, 0 failed, 44 assertions.
- Historical links, document health, and product docs single source: 72 passed, 0 failed,
  1,281 assertions.
- Full repository `bun run typecheck`: 10 packages passed.
