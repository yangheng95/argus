# Mirror Prism Agent Flow Trim

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | `mirror-prism` is too bulky; trim the unnecessary flow and participating agents, then update the Skill. |
| Acceptance | `mirror/prism` keeps one fixed-profile delivery package but projects fewer agents and fewer mandatory workflow nodes. Generic delivery still covers competitor-aware Product Requirements Document (PRD), design, implementation, and MirrorTest acceptance. AInvest keeps complete source observation and feature mapping, then uses the same lean delivery chain. Every retained agent prompt must be satisfiable by the reduced graph, and every retained artifact must have a producer and consumer. The Mission Skill and focused package tests must describe the reduced graph through positive exact-contract assertions. |
| Hard constraints | Keep `prompt_profile.active` as the sole active Expert Squad source and `PromptProfileResolver` as the only projection owner. Do not add fallback, optional workflow nodes, compatibility aliases, host gates, duplicate state, negative tests, or UI tests. Delete encountered UI automation and stale negative tests. Preserve existing user work, including the parallel `packages/opencorvus/src/mission-skill/builtin-payload.ts` edit, and avoid worktrees/reset. Do not call Claude Code for this repair. |
| User correction | Expert Squads may reuse mature implementations, including package-local materialized copies. Each package must remain runtime-self-contained: its manifest, prompts, Skills, tools, libraries, assets, and runtime resolution may reference only the package itself or platform `default` resources, never another installed or inactive squad's private runtime surface. Mirror Watch has V1 only; the prior Watch V2 claim was invented and must be removed without an alias. |
| Existing records read | `2026-07-22-mirror-prism-five-squad-dissolution.md`; `2026-07-23-mirror-prism-unified-squad.md`; current `expert-squads/mirror/prism/expert-squad.jsonc`; current `mirror-prism-cluster` Skill and `virtual-workflow-contract.md`; focused package and SDK authoring tests. |
| Whole-repository grep | `mirror-prism` live references include the Prism manifest, Mission Skill collaboration references, focused OpenCorvus package test, SDK authoring/collaboration tests, payload generation tests, source-capability artifact, and historical records. Post-trim grep found stale source-observation brief/plan schemas and prompt references, retained convergence/recheck wording, an unconsumed `prism/opentest-requirements` artifact, negative assertions in Prism tests, and the encountered Overlay `expert-squad-panel.test.ts` UI automation. Historical records and independent `mirror-watch` / `opentest` packages are not Prism runtime references. |
| Independent agent feedback | Independent read-only review of commit `9df7de117a` rejected the first trim: AInvest Watch still required the deleted plan; Design, Code, and MirrorTest prompts required deleted rechecks; generic delivery lost competitor research; Watch no longer proved target/question coverage; `opentest-requirements-analyst` had no consumer; brief/plan library code remained dead; focused tests used negative assertions and missed the prompt break. |
| Independent V1 and closure review | The final read-only reviewer found the invented Watch V2 constant in the Prism ABI, publisher receipt, README, focused positive test, generated payload, and this record. It found no Prism runtime cross-package dependency: manifest refs are package-local `prism/*` or platform `default/*`, tools import only package-local code and platform dependencies, and materialized Watch/OpenTest copies are valid reuse inside the Prism closure. |

## Codex Review Feedback

The first trim reduced counts but left deleted protocol concepts inside retained prompts and schemas. This revision treats the retained agent as the complete owner instead of preserving hidden pre-planning or convergence expectations:

- Watch receives the Task-owned target and question registries directly and publishes them with an exact target-by-question decision matrix. No brief or plan artifact remains.
- Generic discovery directly owns competitor selection, evidence, and the `prism/competitor-patterns` artifact required by PRD planning.
- Design, Code, and MirrorTest reviewers make one terminal judgment from their declared dependency evidence. They do not require a missing initial review, convergence pass, or recheck node.
- MirrorTest requirements extraction is folded into `opentest-test-implementer`; the unconsumed analyst and artifact are removed.
- Tests assert complete positive projections and successful current-contract outputs. Negative assertion tests and encountered UI automation are deleted.

The first final-review pass found five additional closure defects, all addressed before delivery:

- Watch now derives target and observation-question registries from visible Task intent and authorized AInvest scope inside its single research pass.
- The AInvest general researcher completely reads and selects the typed Watch Artifact, then derives competitor patterns from that sole evidence source; generic discovery remains the sole competitor source for the generic workflow.
- MirrorTest runner work is limited to positive non-UI contracts. The visual reviewer owns live-page interaction, current screenshots, and personal inspection without UI test artifacts or runner coupling.
- The encountered `expert-squad-panel`, `expert-squad-settings-surface`, and `config-panel-sizing` UI tests were deleted. The touched `browser-error-collector` negative meta-test was also deleted instead of preserving its absence assertions.
- Touched Prism tests no longer assert prohibited or absent behavior through either negative matchers or positive matchers aimed at negative prose.

## Trim Contract

Keep these stage owners:

- AInvest source observation: one `mirror-watch-competitor-researcher`.
- PRD discovery and shaping: `mirror-prd-general-researcher`, optional AInvest mapper, `mirror-prd-stage-architect`, `mirror-prd-ui-researcher`, `mirror-prd-asset-curator`, `mirror-prd-author`, `mirror-prd-reviewer`.
- Design: `mirror-design-page-designer`, `mirror-design-visual-reviewer`, `mirror-design-integrator`.
- Code: `mirror-code-implementer`, `mirror-code-visual-reviewer`, `mirror-code-integrity-reviewer`, `mirror-code-integration-implementer`.
- MirrorTest: `opentest-test-implementer`, `opentest-integrity-reviewer`, `opentest-visual-reviewer`.

Remove these projected agents from Prism because their responsibilities are absorbed by the kept owners or are not part of the current mandatory flow:

- Watch pre-planning: `mirror-watch-competitor-requirements-analyst`, `mirror-watch-competitor-research-architect`.
- PRD side paths: `mirror-prd-competitor-scout`, `mirror-prd-stage-requirements-analyst`, `mirror-prd-ux-researcher`.
- Design/code stage pre-planning: `mirror-design-stage-requirements-analyst`, `mirror-design-stage-architect`, `mirror-design-integration-implementer`, `mirror-code-stage-requirements-analyst`, `mirror-code-stage-architect`.
- MirrorTest pre-planning: `opentest-intent-analyst`, `opentest-test-architect`.
- MirrorTest unconsumed handoff: `opentest-requirements-analyst`.

Simplify each phase to one production pass plus one independent review or fan-in. Review findings are ordinary agent output in the same Task, not separate mandatory convergence nodes.

## Implementation Plan

- [x] Rewrite the Prism manifest with the reduced agent projection and reduced `mirror-prism-generic` / `mirror-prism-ainvest` node graphs.
- [x] Delete retired Prism agent prompt and agent-local Skill directories.
- [x] Remove no-longer-projected shared Skill refs and delete unused shared Skill directories when no retained agent references them.
- [x] Update the Mission Skill and `virtual-workflow-contract.md` so the launcher names the reduced node counts and phase responsibilities.
- [x] Update focused non-UI package/SDK tests to assert the reduced exact contract.
- [x] Regenerate the expert-squad payload if required by repository checks, then run focused tests and diff review.
- [x] Remove all retained brief/plan protocol references and make Watch publish a self-contained, coverage-complete research contract.
- [x] Fold generic competitor research into the retained general researcher and align PRD planning inputs.
- [x] Rewrite retained Design, Code, and MirrorTest prompts for one-pass terminal ownership.
- [x] Remove `opentest-requirements-analyst`, its workflow node, and the unconsumed artifact contract.
- [x] Delete dead brief/plan code, encountered UI automation, and stale negative tests.
- [x] Update Mission references, source-capability artifact, README, manifest version/counts, generated payload, and positive contract tests.
- [x] Run focused non-UI tests, payload generation, documentation health, typecheck, diff review, and independent final review.

## Validation Evidence

- `mirror/prism` now projects 18 agents instead of 31.
- Historical implementation note: this commit declared 16/18 mandatory nodes instead of 38/42, but accidentally removed the sole Task-wide Requirements producer while retaining a Requirements-dependent Architect contract. The 2026-07-31 repair restores that producer and the intended 17/19-node topology.
- Watch schema version 1 publishes exact target and question registries, the complete target-by-question matrix, matching unresolved gaps, limitations, and resource roles without a brief or plan pre-artifact. No Watch V2 exists.
- Generic discovery publishes evidence-backed competitor patterns inside the single system-project contract consumed by PRD planning.
- Retained PRD, Design, Code, and MirrorTest prompts require only artifacts produced by the reduced graph and issue one terminal judgment per review owner.
- Retired planning, side-path, convergence/recheck, `opentest-requirements-analyst`, `figma-testing`, `popular-web-designs`, `agent-reach`, and `web-scrapling` files are removed from the active package closure.
- The encountered Overlay UI automation files and touched negative collector meta-test are deleted; focused Prism tests use positive exact-contract and successful-publication assertions.
- The unused Prism `gui-testing` Skill is deleted; the non-UI implementer has no browser projection, while the visual reviewer has browser tools and no test runner or GUI-test Skill.
- AInvest Watch research has one producer and one explicit downstream consumer; generic competitor research remains workflow-local.
- Focused Mirror Watch, Prism, SDK, payload-generation, historical-link, and document-health suite: 118 pass, 0 fail.
- `bun run typecheck`: 8 packages passed.
- `git diff --check` passed; live Prism/Mission/source-contract residual scans contain no deleted brief/plan, agent, locator, or old-count references.
- Independent final review reported no findings after verifying the Watch producer/consumer chain, MirrorTest UI boundary, deleted tests, positive test semantics, exact node counts, dependency closure, and generated payload.
