# Mirror Prism Debug Recovery Integration

Date: 2026-07-23

Status: Implemented and verified

## Recall

### User requirement

Continue the repair after confirming that the Mission-level `mirror-prism-cluster` Skill does not mention or dispatch the `review-debug` expert squad.

### Acceptance criteria

- Keep the successful five-stage delivery chain unchanged: Mirror Watch → Mirror PRD → Mirror Design → Mirror Code → MirrorTest.
- Replace the stale MirrorTest-product-defect → Mirror Code recovery route with a fixed-profile Review & Debug Task followed by a fresh fixed-profile MirrorTest retest Task.
- Split non-visual and visual product-defect recovery into two exact SDK-validated collaboration contracts using `debug-repair` and `visual-debug-repair`; do not model an optional runtime node.
- Keep test-owned defects inside MirrorTest, invalid upstream artifacts with their exact producing squad, and ordinary pre-acceptance implementation convergence inside Mirror Code.
- Make Mission handoffs name the selected recovery contract, exact workflow, original failed MirrorTest Task, reproducible evidence, repaired bytes, fresh visual evidence when applicable, and retest scope.
- Keep every Task's `promptProfile` fixed for its lifetime. Do not select another squad inside an engine Task or restart a Goal for repair.
- Synchronize authoring package files, package version, generated payload, project installation, SDK tests, repository package tests, architecture text, and documentation indexes.

### Hard constraints

- `mirror-prism-cluster` remains the only user-invoked Mission launcher for this collaboration; no host router, state machine, hidden packet, fallback, keyword dispatch, or second workflow engine.
- `review-debug` owns product reproduction, root-cause proof, product-source repair, and repair verification. MirrorTest owns test artifacts, failure classification, retest, audit, and release judgment; it never debugs or edits product source.
- A graphical product defect must use `visual-debug-repair` and fresh rendered evidence. A non-visual defect must use `debug-repair`. The selected contract is exact after MirrorTest evidence classification.
- Virtual workflow nodes and declared collaboration stages remain mandatory and ordered. Conditional recovery paths are separate collaboration definitions rather than optional nodes.
- Preserve the unrelated user edit in `2026-07-22-mirror-prism-full-workflow-distillation.md` and do not restart the running OpenCorvus process.
- Commits use the `dsw-33987` prefix and push to the current delivery branch `legacy-remote/v0.0.16beta` through hooks. The repository release line advanced from `v0.0.15beta` to `v0.0.16beta` while this implementation was active; the committed plan remains an ancestor of the current single delivery line.

### Sources read

- `AGENTS.md`
- `expert-squads/mirror/mirror-prd/skills/mirror-prism-cluster/SKILL.md`
- `expert-squads/mirror/mirror-prd/skills/mirror-prism-cluster/references/{collaboration,goal-ownership,handoff-contract,recovery-delivery,stage-map}.*`
- `expert-squads/{builtin/review-debug,wujiang/opentest}/expert-squad.jsonc`
- `packages/sdk/js/src/expert-squad-authoring.ts`
- `packages/sdk/js/test/{mirror-prism-collaboration,review-debug-collaboration}.test.ts`
- `packages/opencorvus/test/expert-squad/mirror-squads-package.test.ts`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-22-review-debug-expert-squad.md`
- `specs/records/2026-07/2026-07-23-mirror-prd-initial-architect-dispatch-repair.md`

### Whole-repository search evidence

| Search                                                                                                            | Finding and disposition                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "mirror-prism-cluster\|review-debug\|debug-repair\|MirrorTest\|opentest" expert-squads packages specs`       | The cluster Skill and all four references name only the original five squads. They route accepted product defects back to Mirror Code even though Review & Debug is now the dedicated product-debug owner.                                                      |
| `rg -n "collaboration.json\|validateExpertSquadCollaboration\|mirror-prism-cluster" packages expert-squads specs` | The main collaboration JSON is parsed only by the two SDK collaboration suites and packaged as a Mirror PRD Skill reference. New recovery definitions belong beside it and must be validated through the same SDK function.                                     |
| `rg -n "2026.07.23.2" expert-squads/mirror/mirror-prd packages/opencorvus/test packages/sdk/js/test`              | Mirror PRD manifest and one package assertion are the complete current-version call sites. Advance both and regenerate the bundled payload.                                                                                                                     |
| MirrorTest workflow inspection                                                                                      | `mirror-prism-acceptance-stage` already includes intent, requirements, architecture, executable evidence, integrity review, and visual review, so both recovery contracts can return to the same exact retest workflow with different repaired-evidence inputs. |
| Review & Debug workflow inspection                                                                                | `debug-repair` and `visual-debug-repair` are all-Task binding workflows with exact product repair ownership and no manufactured Goals. They are the correct two recovery Task workflows.                                                                        |

### Independent agent feedback

No sub-agent was requested or used. The current collaboration mode prohibits inferred delegation; the primary agent will perform the second review.

## Causal chain

The visible omission is that the Mission launcher never names Review & Debug. The direct dispatch cause is stronger: `SKILL.md`, `collaboration.json`, `handoff-contract.md`, `recovery-delivery.md`, and `stage-map.md` form one self-consistent but stale five-squad contract, and tests assert that exact inventory. The later Review & Debug work added an isolated inline SDK example but did not replace the cluster's authoritative recovery route. Therefore Mission is instructed to create a Mirror Code repair Task even after MirrorTest produces reproducible product-defect evidence. This bypasses the new squad's root-cause workflow and leaves two conflicting collaboration sources.

## Design

The normal `collaboration.json` remains the mandatory five-stage delivery contract. Add two sibling static definitions:

1. `product-defect-recovery.json`: `review-debug/debug-repair` consumes reproducible product-defect evidence and produces repaired-product plus regression evidence; a dependent `opentest/mirror-prism-acceptance-stage` Task consumes those outputs and produces fresh acceptance evidence.
2. `visual-product-defect-recovery.json`: the same Task boundary using `review-debug/visual-debug-repair`, with fresh rendered repair evidence required before the MirrorTest retest.

MirrorTest evidence classification selects exactly one recovery definition. That is Mission's natural decision from visible evidence, not a host gate. Once selected, every stage and workflow node is mandatory. Mirror Code remains the owner of initial implementation and pre-acceptance convergence against accepted design; it is not the post-audit product debugger.

## Implementation plan

1. Add both recovery JSON definitions beside the main collaboration contract and load all three through `validateExpertSquadCollaboration()` in SDK tests.
2. Replace the inline Review & Debug → MirrorTest test definition with the package-owned recovery files so there is one collaboration source.
3. Update the Mission Skill and all supporting references to distinguish normal delivery, non-visual product recovery, visual product recovery, test-owned repair, upstream artifact repair, and tool/runtime failure.
4. Expand handoff identity and evidence contracts to admit `review-debug` only through the two exact recovery definitions.
5. Update Mirror PRD README, architecture guidance, package snapshot/file inventory assertions, package version, and generated payload.
6. Run SDK, Registry, Resolver, package/payload, documentation, typecheck, and full relevant expert-squad regressions; inspect the final diff for stale Mirror Code product-debug routing.
7. Update the installed `crypto3` Mirror PRD package through the atomic package manager without restarting the running process.
8. Perform primary-agent second review, record validation, commit, fetch/merge the latest remote if needed, and push through hooks.

## Non-goals

- Do not make Review & Debug a mandatory stage on successful deliveries.
- Do not let MirrorTest diagnose product root cause or modify product source.
- Do not move test-owned failures from MirrorTest to Review & Debug.
- Do not add a generic retry loop, optional workflow node, task-profile mutation, or automatic recovery state machine.

## Implementation record

- Preserved `collaboration.json` as the unchanged mandatory five-stage delivery chain.
- Added `product-defect-recovery.json` and `visual-product-defect-recovery.json` as separate exact Mission collaboration definitions. Both bind a fixed Review & Debug repair Task before a fresh fixed MirrorTest retest Task; the visual contract additionally requires fresh rendered repair evidence.
- Replaced the duplicated inline SDK recovery fixture with the package-owned definitions and validated all three collaboration files through `validateExpertSquadCollaboration()`.
- Updated the cluster Skill, handoff/ownership/stage/recovery references, package README, public SDK authoring guidance, portable authoring template, current architecture, package inventory tests, package version, and generated payload.
- Atomically replaced the `crypto3` project installation through `ExpertSquadPackageManager`; a fresh Registry load reports `mirror-prd@2026.07.23.3` and both recovery files in the mounted cluster snapshot.
- Preserved the unrelated working-tree edit in `2026-07-22-mirror-prism-full-workflow-distillation.md`. No OpenCorvus or overlay process was restarted or reloaded.

## Validation record

- Relevant expert-squad, resolver, package, payload, prompt, SDK, and collaboration suite: first run `493 pass, 1 skip, 1 fail`; the sole failure exposed an invalid test read from metadata-only `snapshot.files`. The assertion now reads file text from canonical `bundle.files`.
- Focused post-fix package and collaboration regression: `11 pass, 0 fail`.
- Documentation health suite: `87 pass, 0 fail`.
- `bun run typecheck`: `9 successful, 9 total`.
- `bun run docs:check`: `287 ops, 23 groups`.
- `bun run api:routes-check`: `6 rules`, `31 files`, clean.
- Final post-fix relevant expert-squad, resolver, package, payload, prompt, SDK, and collaboration suite: `494 pass, 1 skip, 0 fail` across 47 files with 6,486 assertions.
- Final Git diff and whitespace audit completed before commit; only the separately identified user-owned historical record remains outside this delivery.
