# Expert Squad Formal Contracts

Date: 2026-07-06
Status: Implemented

Supersession note: `2026-07-06-expert-squad-namespaced-source-layout.md` supersedes this record's direct-child `.opencorvus/expert-squads/<id>` path and `software-testing` package-name wording. Current repository package sources are namespaced under `.opencorvus/expert-squads/<namespace>/<id>/`; the former software-testing package is now manifest `id = "opentest"` under `wujiang/opentest`.

Glossary:

- API means Application Programming Interface.
- MCP means Model Context Protocol.
- SUT means System Under Test.
- URL means Uniform Resource Locator.

## Recall

| Item | Details |
| --- | --- |
| User request | After the `frontend-automation-debug` repair, the user reported that the other expert squads have the same issue: they read like empty slogans rather than expert definitions. |
| Acceptance criteria | Every repository non-general expert-squad package must define a domain-specific expert contract that is falsifiable: required input evidence, reasoning/modeling steps, owned outputs, rejection conditions, and final proof. The repair must not add global prompt rules, host-side gates, fallback routing, compatibility aliases, or a second active expert-squad source. Tests must prove payload and selector projection expose the updated contracts. |
| Hard constraints | Keep `.opencorvus/expert-squads/<namespace>/<id>` as package source, manifest `id` as identity, `prompt_profile.active` as the active selection source, and `PromptProfileResolver` as the single projection path. Preserve unrelated dirty worktree changes. Specs stay under `specs/records/2026-07/`. No process restart. No broad git reset. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/current/architecture/04-extensions.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`; `specs/records/2026-07/2026-07-05-expert-squad-payload-seeding-and-skill-refresh.md`; `specs/records/2026-07/2026-07-06-expert-squad-decoupling-agents-rule.md`; `specs/records/2026-07/2026-07-01-expert-squad-concrete-prompts.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`; current README, selector, manifest, and key role overlays for `algorithm`, `backend`, `frontend-innovate`, `frontend-replica`, `software-testing`, and the repaired `frontend-automation-debug` package. |
| Repository search | `rg -n "ExpertSquadRegistry\|ExpertSquadPackageManager\|PromptProfileResolver\|expert-squads\|expert-squad.jsonc\|prompt_profile.active\|select_expert_squad\|active_skill_projection\|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records -g "*.ts" -g "*.tsx" -g "*.md"`; `rg -n "loadEmbeddedPackage\|EmbeddedPackageSource\|renderSelectorSkillMarkdown\|discover\\(\|loadPackage\\(\|loadSourcePackage\\(\|importDirectory\\(\|importArchive\\(\|exportArchive\\(\|payload\|seed\|release" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`; `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test`; `rg -n "slop\|sloppy\|placeholder\|polish\|expert\|best practice\|deep\|深入\|root cause\|causal\|evidence\|proof\|acceptance\|contract\|definition\|quality\|professional\|robust\|production\|comprehensive" .opencorvus/expert-squads -g "*.md"`. |
| Findings | `frontend-automation-debug` now has a falsifiable causal-debug contract. `frontend-replica` and `frontend-innovate` have useful evidence/process guidance but lack a top-level expert-definition contract that states what counts as an expert result and what must be rejected. `algorithm` and `backend` READMEs are especially thin and only list broad focus areas plus overlays. `software-testing` has a good workflow/protocol and package tools, but its selector/README do not yet formalize test-expert judgment, including meaningful assertions, oracle quality, fixture control, stale-script classification, and run evidence. `backend` and `algorithm` currently have no selector metadata, so adding selectors would alter catalog/selection behavior and is out of scope for this prompt-contract repair. |
| Independent agent feedback | Not used. This is a direct package prompt-contract repair with source and resolver tests. |

## Design

Use one shape across packages, with domain-specific content:

1. `## Expert Contract` in every non-general package README.
2. Selector packages also expose the same contract in `selector.md`, because selector text is what the Orchestrator sees before activation.
3. Key role overlays must preserve the contract through scheduling, modeling, implementation, and acceptance.
4. The contract must name concrete rejection conditions so "expert" is not a title or tone:
   - no evidence anchor;
   - no domain model;
   - no rejected alternatives or risk classification;
   - no executable or rendered proof;
   - output proves a narrower happy path than the claim;
   - acceptance is based on prose, unrelated checks, or stale artifacts.

Package-specific contract themes:

| Package | Expert standard |
| --- | --- |
| `algorithm` | Correctness claim, input domain, invariants, reference oracle, adversarial cases, complexity bound, reproducible benchmark, and proof that the implementation satisfies exactly the claimed behavior. |
| `backend` | Application Programming Interface and state contract, schema/storage/error single source, state transition model, negative and permission cases, concurrency/idempotency risks, runtime route/integration proof, and no parallel contract branch. |
| `frontend-innovate` | Design-resource evidence, user/page job, competing directions, selection rationale, rejected generic traits, component/data/interaction/accessibility contract, rendered proof, and no novelty without evidence. |
| `frontend-replica` | Source evidence ledger, visible surface model, source-to-target binding, implementation ownership, rendered parity proof, bounded feedback accounting, and no source-row/prose/screenshot-only completion. |
| `software-testing` | System-under-test contract, test oracle, fixture/control model, assertion strength, stale-script versus product-bug classification, exact command run evidence, and release-risk judgment. |

## Implementation Plan

1. Add domain-specific `## Expert Contract` sections to `algorithm`, `backend`, `frontend-innovate`, `frontend-replica`, and `software-testing` READMEs.
2. Add matching selector contract sections for selector-backed packages: `frontend-innovate`, `frontend-replica`, and `software-testing`.
3. Update key role overlays for each package so Orchestrator, Requirements, Architect, Build, Integrity, and relevant specialists carry the same contract.
4. Add payload tests that assert every repository payload package carries its formal expert contract.
5. Add resolver selector-projection tests that assert selector-backed packages expose the contract through general selector skills.
6. Run focused package/resolver/docs validation and `git diff --check`.

## Implementation

- Added `## Expert Contract` sections to repository package READMEs for `algorithm`, `backend`, `frontend-innovate`, `frontend-replica`, and `software-testing`.
- Added selector-visible contract sections for `frontend-innovate`, `frontend-replica`, and `software-testing`.
- Updated key role overlays so Orchestrator, Requirements, Architect, Build, Integrity, and relevant frontend/testing specialists carry the same contract during scheduling, implementation, and acceptance.
- Added package-manager payload tests that assert each repository payload package carries its formal expert contract through `ExpertSquadRegistry.loadEmbeddedPackage`.
- Extended resolver selector projection tests so general selector skills expose the updated contracts for selector-backed packages.
- Synchronized the currently open demo project's existing `algorithm`, `backend`, `frontend-innovate`, and `frontend-replica` prompt files with the repository package changes. The demo project did not already contain `software-testing`, so this task did not create it there.

## Validation Results

- Passed: `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts -t "payload packages carry formal expert contracts|frontend automation debug payload carries"`; 2 pass, 0 fail.
- Passed: `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "projects selector skills only from explicitly installed project packages"`; 1 pass, 0 fail.
- Passed: `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts -t "payload package sources match current repository expert-squad packages"`; 1 pass, 0 fail.
- Passed: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`; 19 pass, 0 fail.
- Passed: `git diff --check`.
