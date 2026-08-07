# Review and Debug Expert Squad

Date: 2026-07-22
Status: Corrected and verified after Phase 08 runtime failure
Owner: Codex

## Recall

### User Requirement

Use the existing Expert Squad Software Development Kit (SDK) to design a review and debug expert squad. WuJiang/MirrorTest remains a post-delivery audit-report producer: it may own test artifacts, execution evidence, defect classification, and release judgment, but it does not investigate product root cause or repair the System Under Test (SUT).

On 2026-07-23 the user supplied Task `tsk_f8a970abb001eDUEwNJjE7TgVK` and required the remaining forced-Goal configuration defect to be repaired systemically rather than worked around.

### Acceptance Criteria

- Add one external, SDK-authored `review-debug` expert-squad package with a strict manifest v1 identity and explicit package projection.
- Select it for code review, reproducible product-defect investigation, root-cause analysis, product-source repair, and repair verification; do not select it for feature delivery or test-only audit work.
- Separate read-only evidence/review/root-cause ownership from product-source repair ownership.
- Provide distinct binding workflows for review-only, non-visual debug/repair, and graphical debug/repair requests so conditional work is not hidden inside one graph.
- Keep Review & Debug's binding workflow order without manufacturing Goals. Its review and repair graphs are Task-scoped because the package does not project canonical requirements and architect adapters.
- Reject any future manifest workflow that declares Goal-scoped delivery without a real Task-scoped requirements → architect planning lineage consumed by every Goal-scoped node.
- Define a static SDK collaboration contract in tests showing `review-debug` product repair evidence feeding a later MirrorTest acceptance/audit stage.
- Keep MirrorTest unchanged as the owner of test-owned artifacts and audit output; the new squad must not absorb MirrorTest release judgment.
- Validate the package through the real Registry, Manager payload release, PromptProfileResolver, SDK collaboration validator, and generated payload.
- Add regression coverage for selection boundaries, role prompts, exact workflow dependencies, reviewer single concurrency, package projection, payload parity, and the MirrorTest handoff boundary.

### Hard Constraints

- `prompt_profile.active` remains the only active expert-squad selection source.
- `capability_projection.agents.<agentID>` is the only dynamic runtime identity; `base_role` only selects a runtime template.
- No fallback, aliases, inferred routing, keyword gate, hidden message, state machine, active/default workflow field, or package-owned dispatcher.
- The repair implementer may edit product source only after reproducible evidence and a causal explanation exist. Reviewers and investigators remain read-only.
- A visual repair is incomplete without a task-scoped real preview, screenshots bound to the affected region/state, interaction evidence, and personal visual inspection.
- MirrorTest may consume repaired-product and regression evidence, repair test-owned artifacts, and issue an audit report; it must not edit product source or diagnose product root cause.
- New commits use the `dsw-33987` subject prefix and are pushed to `legacy-remote/v0.0.15beta` through hooks.

### Sources Read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-16-expert-squad-development-sdk.md`
- `specs/records/2026-07/2026-07-22-cross-squad-goal-ownership-and-sdk-collaboration-contract.md`
- `specs/artifacts/portable-expert-squad-template/authoring-skill/SKILL.md`
- `packages/sdk/js/src/expert-squad-authoring.ts`
- `packages/opencorvus/src/expert-squad/{registry,manager,prompt-profile-resolver}.ts`
- `packages/opencorvus/script/generate-expert-squad-payload.ts`
- `expert-squads/wujiang/opentest/{expert-squad.jsonc,README.md,selector.md}`
- `expert-squads/wujiang/opentest/agents/{orchestrator,opentest-integrity-reviewer}/system.md`
- `expert-squads/builtin/research-studio/**` as the current minimal SDK-authored package example

### Whole-Repository Search Evidence

| Search                                                                                                                                                            | Finding and disposition                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rg -n "expert[-_ ]squad\|MirrorTest\|opentest\|virtual_workflows\|capability_projection" .`                                                                        | Registry, Manager, Resolver, package manifests, payload generation, docs, and package tests are the complete expert-squad surface. The new capability belongs in a package, not global prompts.                                                                                                                                            |
| `rg -n "review\|debug\|root cause\|failure ownership\|product defect\|repair_agent_id" expert-squads packages/opencorvus/test/expert-squad specs/records/2026-07` | Current MirrorTest explicitly stops at reproducible product-defect ownership. Product debugging has no current dedicated package owner. Historical `frontend-automation-debug` references are not a current runtime package and will not be restored as a compatibility path.                                                                |
| `rg -n "renderExpertSquadPackageFiles\|writeExpertSquadPackage\|validateExpertSquadCollaboration" packages/sdk packages/opencorvus`                               | The existing SDK writer owns scaffold materialization; the collaboration validator owns static squad/workflow/evidence/repair-agent checks without executing or persisting workflow state.                                                                                                                                                 |
| `rg -n "payloadPackageSources\|renderExpertSquadPayloadModule\|repositoryExpertSquadRoot" packages/opencorvus`                                                    | Payload discovery reads tracked `expert-squads/<namespace>/<id>/**` files. Exact package lists in package-manager tests, reviewer-manifest inventory, and the generated payload must be updated.                                                                                                                                           |
| `rg -n "base_role\|goal_concurrency" expert-squads/*/*/expert-squad.jsonc`                                                                                        | Existing runtime templates provide `explore`, `deep-research`, `build`, `integrity`, and `visual-qa`; no new host role is needed. Reviewer identities use `goal_concurrency: single`.                                                                                                                                                      |
| Phase 08 SQLite session/tool evidence                                                                                                                             | The Task correctly selected `review-debug`, then `manage_task.add_goal` returned `no active task contract/spec snapshot`. All three package workflows started with Goal-scoped nodes and projected no requirements or architect adapter, creating a circular prerequisite before any worker could run.                                     |
| Repository manifest topology audit                                                                                                                                | Review & Debug was the only all-Goal workflow package, but General evidence/interface and standalone Mirror PRD/Design/Code workflows also contained Goal nodes without canonical planning lineage. They must become Task-scoped; Mission stage workflows that already contain real requirements and architect nodes retain Goal delivery. |

### Independent Agent Feedback

No sub-agent was used. The user did not request independent or parallel agents, and the active multi-agent instruction prohibits inferred delegation. The primary agent will perform the required second review.

## Design

### Package Identity and Boundary

The package is `builtin/review-debug` with manifest identity `review-debug`. `builtin` is its release namespace, not an active-state alias. It is distributed through the existing tracked payload path and remains inactive until selected through `prompt_profile.active`.

Select `review-debug` for evidence-backed review of existing changes or behavior, reproducible product-defect investigation, product root-cause analysis and repair, graphical defect repair with real browser evidence, and independent repair verification before a later MirrorTest audit. Do not select it for greenfield feature construction, broad product planning, test-suite-only authoring, test infrastructure repair, or a release/audit report without product repair ownership.

### Dynamic Agents

| Agent                                  | Base runtime    | Ownership                                                                                                                                                | Mutation boundary                                                  | Concurrency      |
| -------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------- |
| `review-debug-evidence-investigator`   | `explore`       | Reproduce the symptom, inventory evidence, bound the affected surface, and preserve exact commands/errors/artifacts.                                     | Read-only.                                                         | `disjoint_goals` |
| `review-debug-code-reviewer`           | `integrity`     | Review the change and surrounding call graph for correctness, regressions, single-source violations, missing tests, and causal clues.                    | Read-only; findings require file/line/evidence.                    | `single`         |
| `review-debug-root-cause-investigator` | `deep-research` | Prove the causal chain from observable symptom through trigger and data/control flow to the design fault, and explain why earlier paths did not cure it. | Read-only; no speculative cause or title-based inference.          | `disjoint_goals` |
| `review-debug-repair-implementer`      | `build`         | Apply the narrow root repair, delete the superseded path, add regression tests, and run focused verification.                                            | Owns product and product-owned test changes after causal evidence. | `disjoint_goals` |
| `review-debug-integrity-reviewer`      | `integrity`     | Independently review the diff and rerun the original reproduction plus regression checks; reject unresolved findings.                                    | Read-only.                                                         | `single`         |
| `review-debug-visual-reviewer`         | `visual-qa`     | Reproduce and verify graphical defects with a real task-scoped preview, screenshots, interaction/focus states, and diagnostics.                          | Read-only; reports exact visual discrepancies.                     | `single`         |

### Binding Workflows

1. `review-only`: evidence investigator then code reviewer. It produces an evidence-backed review and does not imply repair.
2. `debug-repair`: evidence investigator, then code reviewer and root-cause investigator in parallel, then repair implementer, then integrity reviewer. Repair requires both review and causal evidence.
3. `visual-debug-repair`: evidence investigator, then code reviewer, root-cause investigator, and visual reviewer, then repair implementer, then fresh visual and integrity review. Post-repair screenshots cannot reuse reproduction evidence.

All Review & Debug nodes are Task-scoped. The dependency graph remains binding, so the Orchestrator must still execute every selected node in order, but no Goal or active spec snapshot is required. Re-dispatch for concrete reviewer findings is an Orchestrator decision using visible messages in the same Task; the manifest does not encode a loop or state machine.

Goal scope is an opt-in persistence mode, not a synonym for Agent collaboration. A workflow may use Goal-scoped nodes only when the same graph first runs real Task-scoped `requirements` and `architect` adapters and every Goal node depends on that planning lineage. The Registry and SDK collaboration validator enforce this as manifest data integrity.

### MirrorTest Handoff

The SDK collaboration test models two independently accepted stages:

1. `product-repair` selects `review-debug/debug-repair`, consumes `defect-evidence`, and produces `repaired-product` plus `repair-regression-evidence`. Its repair owner is `review-debug-repair-implementer`.
2. `post-repair-audit` selects `opentest/mirror-prism-acceptance-stage`, consumes both repair outputs, and produces `audit-report`. Its repair owner is `opentest-test-implementer`, which can repair only audit/test-owned artifacts.

The collaboration definition is authoring-time validation only. Runtime handoff remains a visible terminal Task outcome followed by Mission creation of the exact next fixed-profile Task. A stage may own Goals only when its selected package workflow provides the canonical planning lineage.

## Implementation Plan

1. Commit and push this design/Recall before package implementation.
2. Materialize `expert-squads/builtin/review-debug` through `@opencorvus-ai/sdk/expert-squad-authoring`, then inspect every generated file.
3. Add a focused `review-debug-package.test.ts` covering Registry load, manifest graph, role boundaries, Manager import, Resolver projection, payload release, and SDK collaboration with current MirrorTest.
4. Add the manifest to the repository workflow-protocol inventory and its reviewer identities to the exact single-concurrency expectation.
5. Update exact payload package lists, stage new package source, regenerate the single generated payload, and verify byte parity.
6. Run focused package/SDK/payload/registry/resolver tests, documentation health, historical links, TypeScript checks, `git diff --check`, and residue searches.
7. Perform a primary-agent second review against the user requirement and MirrorTest boundary; record results here.
8. Commit with `dsw-33987`, fetch/merge `legacy-remote/v0.0.15beta`, rerun required checks when merge changes relevant files, and push through hooks.

## Non-Goals

- Do not modify MirrorTest into a product debugger or product repair team.
- Do not add a host-level bug router, review gate, workflow engine, issue state machine, or hidden repair loop.
- Do not create a generic feature-development squad or copy General's full software-delivery team.
- Do not revive the retired `frontend-automation-debug` package or add an alias for it.
- Do not claim a final MirrorTest audit without actually selecting and running MirrorTest in a separate ready Goal.

## Implementation Evidence

- The package was materialized through `writeExpertSquadPackage` from `@opencorvus-ai/sdk/expert-squad-authoring`; the permanent SDK regression round-trips every package byte and parses the generated manifest.
- `review-debug` projects seven exact dynamic Agent identities, one package Skill, no package tool or package MCP server, and the three distinct `review-only`, `debug-repair`, and `visual-debug-repair` binding workflows.
- Investigators and reviewers have explicit read-only prompts. `review-debug-repair-implementer` is the only product mutation owner and receives Browser Model Context Protocol (MCP) tools for graphical repair.
- The SDK collaboration regression validates two fixed-profile Mission Tasks: `review-debug/debug-repair` produces repaired-product and regression evidence; `opentest/mirror-prism-acceptance-stage` consumes it and produces the independent audit report while keeping its repair ownership limited to test-owned artifacts.
- The first primary-agent review found that the initial `review-only` graph incorrectly required a runtime reproduction even for pure static review. The package was revised to establish requirement, target revision/diff, call graph, and relevant checks for review-only scope, while keeping exact runtime reproduction mandatory for debug workflows. The manifest revision advanced from `2026.07.22.1` to `2026.07.22.2`.

## Validation Evidence

- Review & Debug Registry, prompt-boundary, Resolver projection, and fresh-project bundled provisioning tests: `4 pass`.
- SDK package round-trip and `review-debug` → MirrorTest collaboration tests: `3 pass`.
- Payload generation/parity, manifest workflow, and reviewer-concurrency tests combined with the focused package and SDK cases: `22 pass`, `254 assertions`.
- Manager payload inventory and selector expert-contract cases: `2 pass`, `398 assertions`.
- Historical links and document health: `82 pass`, `1,362 assertions`.
- SDK and OpenCorvus TypeScript checks passed; working-tree and staged diff whitespace checks passed.
- The concurrent Mission contract task committed the complete expert-squad source closure, regenerated OpenAPI and the single bundled payload, retained all Review & Debug commits, and pushed `a3953f902` to `legacy-remote/v0.0.15beta`. The generated payload contains `builtin/review-debug` revision `2026.07.22.2`, and fresh-project release now installs and reloads that exact package.

### Phase 08 Correction Verification

- Review & Debug revision `2026.07.23.1` declares all fourteen binding workflow nodes as Task-scoped and explicitly forbids manufacturing Goals for review or repair execution.
- General's unplanned evidence/interface workflows and the standalone Mirror PRD, Design, and Code workflows are Task-scoped. Existing Mission-stage workflows retain Goal scope only where their graph contains the canonical Task-scoped requirements then architect planning lineage.
- Registry load and SDK collaboration validation reject a Goal-scoped workflow when it lacks that lineage, when architect does not depend on requirements, or when a Goal node does not transitively consume the architect. This is package data-integrity validation, not a runtime gate or workflow engine.
- The repository manifest audit loads every shipped package and proves every retained Goal-scoped node has canonical planning ancestry.
- The combined expert-squad, Orchestrator prompt, Mission prompt, and SDK suite initially exposed a real test-infrastructure race: the Mirror PRD asset fixture used Bun's in-process ephemeral server while other package tests also exercised process-global network surfaces, so the full parallel suite could route the fixture request to unrelated text. The fixture now uses an independently bound Node TCP server. Three repeated five-file contention runs produced `141 pass`, `0 fail`, followed by the full `489`-test run at `488 pass`, `1 intentional skip`, `0 fail`.
- Root TypeScript checks completed all nine typecheck tasks across the eleven-package workspace scope. The final historical-links, product-doc single-source, and document-health run produced `87 pass`, `0 fail`; `docs:check`, `api:routes-check`, payload parity, focused Registry/SDK/Resolver/Manager cases, and `git diff --check` passed.
- Primary-agent second review found no remaining repository-authored unplanned Goal workflow and no MirrorTest product-debug ownership regression. The failed Phase 08 Task remains immutable failure evidence; recovery is a new fixed-profile Task, not mutation or replay of the failed record.
