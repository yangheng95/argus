# Mission Planning Prompt Rearchitecture

Date: 2026-08-02
Status: Implemented
Owner: Codex

## Recall

### User request

- “我怀疑现在的mission的prompt瞎写，一点建设性的指导都没有，例如如何分片任务，如何分阶段使用不同专家团完成任务，需不需要即时生成新专家团，替我检查”
- After the evidence review: “写了，但全部是bullshit”
- Implementation direction: “叫几个独立agent分别重写，取其精华”

### Acceptance criteria

- Replace the current rule pile with one executable Mission planning method that works backward from final acceptance.
- Require a minimal stage graph with numbered final-acceptance coverage, one observable outcome, one exact Expert Squad owner, execution scope, owned resources, dependencies, inputs, outputs, observed acceptance evidence, and downstream consumers per stage.
- Keep one Squad-owned workflow inside one Task; create a new Mission Task only for a real ownership, dependency, execution-scope, or independent-acceptance boundary.
- Let Mission infer cross-Squad stages from the requested outcome. The operator does not have to pre-name the Squad chain.
- Derive the ready parallel frontier from accepted dependencies and non-overlapping ownership rather than from topic similarity.
- Distinguish a one-off Base or Advanced Task from a genuinely reusable missing capability before producing a new project Expert Squad.
- Preserve the existing fixed `promptProfile`, Mission state, canonical Artifact import, Task ownership, user-update, and failure-honesty contracts.
- State the exact epistemic boundary of `panel.expert_squad_catalog`: Mission may use visible selector and workflow summaries, but may not claim hidden Agent, tool, dependency, or mandatory-input facts.
- Remove touched negative prompt assertions and retain positive non-UI contract coverage.
- Correct the stale current-architecture claim that Mission owns an active profile or that Mission Tasks may inherit an omitted profile.
- Preserve all concurrent worktree changes and do not run User Interface automated tests.

### Hard constraints

- Do not introduce a Host classifier, route gate, workflow engine, state machine, compatibility path, fallback profile, hidden message, or second catalog.
- `prompt_profile.active` remains the Task-root Expert Squad identity; Mission itself has no active Expert Squad.
- Every Mission-created Task explicitly supplies one exact `promptProfile`, fixed for that Task lifetime.
- Cross-Task evidence moves only through exact `ArtifactReadLocator` entries supplied in `artifact_imports`.
- Mission does not duplicate a Task Orchestrator's internal Agent, workflow, Delivery Slice, implementation, or verification work.
- Automatic Expert Squad production remains a visible project-scoped Advanced Task followed by terminal and catalog identity reconciliation, and is available only when the catalog explicitly reports full scope.
- Do not modify, run, or create UI tests.
- Do not overwrite, stage, commit, or push unrelated concurrent changes.

### Sources read

- `AGENTS.md`
- `packages/opencorvus/src/prompt/core/mission-core.txt`
- `packages/opencorvus/src/prompt/fragments/task-request-scope.ts`
- `packages/opencorvus/src/agent/primary-assistant-registry.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/expert-squad/catalog.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- built-in Base, Advanced, and Research Studio manifests
- `specs/current/architecture/{01-agents,04-extensions,07-panel,14-agent-runtime-mode,99-principles}.md`
- Mission planning, cross-Squad orchestration, recommendation-catalog, and automatic Expert Squad production records from July 2026
- focused Mission prompt, Panel, resolver, and primary-assistant tests

### Whole-repository grep results

| Surface                | Current fact                                                                                                                                                                                                              | Disposition                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mission runtime prompt | `PrimaryAssistantRegistry` appends `mission-core.txt` and the shared Task request scope guidance to the real Mission identity.                                                                                            | Rewrite the runtime source; this is not dead documentation.                                                                                      |
| Mission Task identity  | Mission Panel schema requires both semantic `title` and explicit `promptProfile`; the route clears Mission `prompt_profile`.                                                                                              | Preserve and make the planning algorithm rely on explicit per-stage ownership.                                                                   |
| Cross-Squad wording    | Current prompt defaults to batching and allows cross-Squad stages primarily when an operator-invoked contract already names exact Squads.                                                                                 | Let Mission derive owner changes from final acceptance and catalog evidence.                                                                     |
| Recommendation catalog | Mission sees Squad identity, selector summary/guidance, and workflow ID/label/description/node count. It does not see Agent inventory, complete projection, workflow nodes, tools, dependencies, or mandatory inputs.     | Stop claiming unavailable facts. Select from positive visible evidence and let the Task Orchestrator resolve the full active package.            |
| Automatic production   | Current prompt creates a new Squad whenever no specialized Squad positively owns the phase.                                                                                                                               | Add a prior one-off-versus-reusable capability decision; unfamiliar subject matter alone uses Base or Advanced.                                  |
| Existing prompt tests  | Focused tests primarily assert that exact strings occur in `MISSION_CORE`; touched files include historical negative string assertions.                                                                                   | Replace touched assertions with positive contracts for the stage record, ready frontier, Squad matrix, and production decision.                  |
| Current architecture   | `04-extensions.md` says Mission stores an active profile and child Tasks may inherit it, while `07-panel.md`, route code, prompt, and Panel schema say Mission has no active profile and every Mission Task supplies one. | Correct `04-extensions.md` to the actual runtime contract.                                                                                       |
| Concurrent work        | Another active task is editing `mission-core.txt`, its prompt test, `01-agents.md`, and `04-extensions.md` to handle partial selected-Squad ownership.                                                                    | Preserve that semantic requirement inside the consolidated rewrite; do not overwrite its worktree state or commit until ownership is reconciled. |

### Independent Agent feedback

Three first-level read-only Agents were explicitly requested. Each was forbidden from editing, running UI tests, committing, pushing, or delegating further.

1. `mission_decomposition` supplied the acceptance-backward phase algorithm, stage-record shape, dependency and ready-frontier derivation, Artifact handoff protocol, and the correction that Mission may infer cross-Squad stages.
2. `mission_prompt_editor` supplied the concise decision-priority order, complete candidate system prompt, self-contained Task brief template, calibration examples, and a list of duplicated protocol detail to remove.
3. `mission_adversarial` supplied the Base / Advanced / Research Studio / domain-Squad decision matrix, package-spam failure analysis, one-off-versus-reusable production criteria, compact-catalog epistemic boundary, and six behavior-level acceptance scenarios.

All three independently agreed that the current prompt asks Mission to make complete workflow and capability judgments from facts the recommendation catalog does not expose.

## Design

### 1. One planning algorithm

Mission plans backward from the final acceptance claims:

1. Identify the observable result and durable evidence for each claim.
2. Identify the responsibility that can produce or independently verify it.
3. Identify predecessor Artifacts or decisions required by that responsibility.
4. Merge adjacent work when one Squad owns the complete outcome and acceptance.
5. Split only at a real owner, evidence dependency, execution scope, manageable-size, or independent-verdict boundary.
6. Derive the ready frontier from accepted predecessors and non-overlapping ownership.

Research, planning, implementation, and testing are not automatically four Mission stages. They remain one Task when one Squad's workflow owns the complete delivery.

### 2. One stage record in existing Mission state

Every planned stage is recorded in `frontier.md`:

```text
## Stage <key>: <semantic name>
Satisfies: <Done claim IDs>
Outcome: <observable result>
Owner: <exact promptProfile or unresolved>
Selection evidence: <visible catalog evidence>
Depends on: <stage keys or none>
Execution scope: <project, repository, directory, environment, or service boundary>
Owned surfaces/resources: <files, interfaces, data, environments, or none>
Required inputs: <semantic Artifact roles or none>
Deliverables: <terminal outputs>
Acceptance: <positive evidence>
Acceptance evidence: <pending or terminal result plus exact ArtifactReadLocator values>
Task: <task ID or not dispatched>
Next consumers: <stage keys or final acceptance>
Parallel rationale: <concrete independence reason or blocked dependency>
Squad decision: <existing | one-off base/advanced | produce new>
Open facts: <facts the Task may investigate>
```

This is a planning ledger in the existing Mission source, not a Host workflow or second state store.

### 3. Expert Squad decision order

For each stage:

1. Use an exact domain Squad when its visible positive selector/workflow summary owns the complete stage.
2. Use a returned research-delivery Squad for an independently accepted cited research or report outcome, not software-delivery-internal investigation.
3. Use a returned compact general-delivery Squad for ordinary repository delivery whose research, plan, implementation, and test fit one composite Task.
4. Use a returned full general-delivery Squad only when formal requirements/architecture, multiple evidence frontiers, interface-specific ownership, or an independent review contract is materially required beyond the compact chain.
5. Produce a new Squad only from `scope: "full"` for a stable, reusable missing domain method, responsibility split, evidence contract, or repeated workflow that no returned general-delivery Squad can responsibly own as a one-off Task.

Catalog, Registry, access, permission, credential, model, dependency, network, tool, input, or existing-package failures are blockers or repair work, not missing capabilities.

### 4. Catalog epistemic boundary

The recommendation response now adds one bounded `scope: "full" | "selected"` fact so Mission can tell whether a newly produced project package can become visible on reread. The rewritten prompt otherwise names exactly what the current result exposes and does not instruct Mission to judge hidden workflow nodes, projected tools, or mandatory inputs. A future compact stage-contract protocol may add normalized ownership, inputs, outputs, evidence capabilities, and acceptance ownership without exposing full package prompts or Settings payloads.

### 5. Prompt structure

Replace repeated warnings and scattered dispatch details with:

1. role and decision priorities;
2. hard ownership invariants;
3. Mission state and wake protocol;
4. first-wake intake;
5. acceptance-backward stage design;
6. Squad selection and production decision;
7. Task brief template;
8. dependency, parallelism, Artifact handoff, and reconciliation;
9. user communication and calibration examples.

Tool return-field documentation, complete tool inventories, and product-specific Multica exceptions remain owned by tool or launcher contracts rather than the generic Mission planning prompt.

## Implementation plan

1. Reconcile the current shared-worktree Mission edits and preserve their partial selected-Squad ownership requirement.
2. Replace `mission-core.txt` with the consolidated planning protocol.
3. Correct the stale Mission-profile semantics in current architecture.
4. Rewrite the focused positive prompt contracts around the new stage record, backward planning, parallel frontier, Squad choice, and reusable production criteria.
5. Run focused non-UI Mission, Panel, resolver, primary-assistant, typecheck, and documentation-health checks.
6. Perform a second source/diff review against all three independent proposals and the six adversarial scenarios.
7. Commit only task-owned hunks with the required `dsw-33987` prefix and push the current delivery branch to `legacy-remote` after the overlapping parallel task is settled.

## Second independent review

The decomposition and adversarial reviewers challenged the consolidated diff after implementation. Their blocking findings were incorporated:

- every wake now reloads `frontier.md` before reconciliation;
- numbered `Done` claims map to each stage through `Satisfies`;
- stage records persist execution scope, owned surfaces/resources, and exact observed acceptance evidence;
- compact and full general-delivery ownership no longer overlap on ordinary implementation/testing alone;
- selected catalog scope cannot authorize package production that the same Mission could never observe;
- terminal-but-unaccepted recovery creates a fresh lifecycle instead of pretending the completed Task remains active.

The authoring protocol's 3-9 Agent bound remains canonical across the Advanced Orchestrator and authoring Skill; the Mission prompt now explicitly forbids padding and requires every declared Agent to be genuinely distinct and necessary.

## Verification

- Focused Mission prompt, production, native Mission Skill, request-language, primary-assistant, Panel capability, and Panel runtime contracts: 60 passed, 0 failed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- Documentation health after explicit staging: 70 passed, 0 failed.
- `git diff --check`: passed.
- A broader legacy Mission wake-route suite was also inspected. Its positive wake cases currently stop before Mission dispatch because the test fixture references unavailable `opencorvus/gpt-5-nano`; this is not evidence for or against the rewritten planning behavior. No real provider-backed Mission model run is claimed by this record.

## Verification scenarios

1. A located ordinary bug becomes one Base Task, not four Mission stages.
2. A complex cross-module feature becomes one Advanced Task when its complete workflow owns acceptance.
3. An independently accepted research report precedes an implementation Task through exact Artifact imports.
4. A domain implementation precedes an independent audit Task; product repair returns to the product owner and is followed by a fresh audit.
5. One unfamiliar library task uses Base or Advanced without producing a package.
6. A stable repeated missing domain contract creates one Advanced production Task, reconciles exact ID/version/digest, and reuses one new Squad for later domain stages.
