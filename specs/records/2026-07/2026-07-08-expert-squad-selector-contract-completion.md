# Expert Squad Selector Contract Completion

Date: 2026-07-08
Status: Implemented, adversarially reviewed, and verified
Owner: Codex

## Recall

### User Request

The user asked Codex to review the current expert-squad definitions against the latest external expert-squad contract and fix definition errors, outdated wording, unclear or incomplete contracts, and protocol gaps.

### Acceptance Criteria

- Current repository expert-squad packages under `.opencorvus/expert-squads/<namespace>/<id>/` must match the current external package contract.
- Non-general payload-distributed expert squads must expose a visible selector surface so the Orchestrator can follow the `skill` then `select_expert_squad` protocol.
- Selector-visible text must carry the same falsifiable expert contract as the runtime README and role overlays.
- Manifest `id` remains the only expert-squad identity, namespace remains source/install partition, and `prompt_profile.active` remains the only active selection source.
- `PromptProfileResolver` remains the only runtime projection surface for catalog, scheduler, worker, skill, tool, and MCP projection.
- Payload generation must remain derived from the repository source packages, not a hand-written parallel list.
- Tests must cover the repaired definition contract and prevent future payload packages from shipping without selector-visible expert contracts.

### Hard Constraints

- No fallback, compatibility aliases, hidden routing, inactive package scanning, package-owned workflow engine, or second active expert-squad field.
- Do not change MirrorTest virtual-agent runtime identity or introduce custom roles.
- Do not restart, kill, refresh, or interfere with OpenCorvus or overlay processes.
- Do not use git reset, create another worktree, or overwrite unrelated dirty worktree changes.
- Existing dirty state before this task:
  - unstaged: `packages/opencorvus/src/provider/models-snapshot.ts`
  - staged: `packages/opencorvus/src/session/loop.ts`, `packages/opencorvus/test/session/extra-tools.test.ts`, `specs/records/2026-07/2026-07-08-dispatch-agent-null-schema-pollution.md`, `specs/records/2026-07/README.md`
  - untracked: `specs/artifacts/expert_provider.zip`

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-06-expert-squad-namespaced-source-layout.md`
- `specs/records/2026-07/2026-07-06-expert-squad-formal-contracts.md`
- `specs/records/2026-07/2026-07-07-portable-expert-squad-template.md`
- `specs/records/2026-07/2026-07-07-opentest-lifecycle-virtual-agents.md`
- `specs/records/2026-07/2026-07-07-dispatch-agent-projected-target-schema.md`
- `specs/records/2026-07/2026-07-07-opentest-intent-analysis-and-visual-qa-projection.md`
- `.opencorvus/expert-squads/builtin/*/expert-squad.jsonc`
- `.opencorvus/expert-squads/builtin/algorithm/README.md`
- `.opencorvus/expert-squads/builtin/backend/README.md`
- `.opencorvus/expert-squads/wujiang/opentest/expert-squad.jsonc`
- `packages/opencorvus/src/expert-squad/payload.ts`
- `packages/opencorvus/script/generate-expert-squad-payload.ts`
- `packages/opencorvus/test/fixture/expert-squad.ts`
- `packages/opencorvus/test/expert-squad/registry.test.ts`
- `packages/opencorvus/test/expert-squad/package-manager.test.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `.opencorvus/expert-squads/builtin/frontend-innovate/agents/frontend-design/system.md`
- `.opencorvus/expert-squads/builtin/frontend-innovate/agents/build/system.md`
- `.opencorvus/expert-squads/builtin/frontend-innovate/agents/visual-qa/system.md`
- `.opencorvus/expert-squads/builtin/frontend-innovate/agents/integrity/system.md`
- `.opencorvus/expert-squads/builtin/backend/selector.md`
- `.opencorvus/expert-squads/builtin/backend/expert-squad.jsonc`
- `.opencorvus/expert-squads/builtin/backend/agents/*/system.md`
- `.opencorvus/expert-squads/builtin/algorithm/selector.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/selector.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/build/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/visual-qa/system.md`

### Repository Search Evidence

- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\.jsonc|prompt_profile\.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
  - Finding: registry, manager, resolver, routes, overlay service, core prompt, and docs all converge on manifest/package/resolver projection and visible `select_expert_squad`.
- `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\(|loadPackage\(|loadSourcePackage\(|importDirectory\(|importArchive\(|exportArchive\(|releasePayloadPackages|EXPERT_SQUAD_PAYLOAD|generate-expert-squad-payload|payloadPackages|payloadSource|PackagePayload" packages/opencorvus/src/expert-squad packages/opencorvus/script packages/opencorvus/test/expert-squad packages/opencorvus/test/server/expert-squad-routes.test.ts`
  - Finding: payload sources are generated from repository packages; release is explicit and no-overwrite; selectors are rendered only from manifest-declared `selector.md`.
- `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | Sort-Object`
  - Finding: repository packages are `builtin/algorithm`, `builtin/backend`, `builtin/frontend-automation-debug`, `builtin/frontend-innovate`, `builtin/frontend-replica`, and `wujiang/opentest`.
- `rg -n "software-testing|\.opencorvus/expert-squads/(algorithm|backend|frontend|software)|<id>|fallback|fallbacks|compat|alias|tester|script-writer|failure-handler|custom role|placeholder|TODO|TBD|WIP|dummy|mock|fake|占位|兜底|兼容|别名|旧|过时" .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad specs/current/architecture/04-extensions.md specs/artifacts/portable-expert-squad-template -g "*.md" -g "*.jsonc" -g "*.ts" -g "*.json"`
  - Finding: current source packages do not contain the old `software-testing` identity, but `algorithm` and `backend` lack `selector.md` and manifest selector metadata while selector-backed packages expose selector contracts.
- `rg -n "selector|selector skills|payload packages carry|repository expert-squad packages|project packages" packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
  - Finding: existing tests validate selector mechanics and formal contracts, but `payload packages carry formal expert contracts` only checks selector text for frontend and MirrorTest packages; it does not require selector-visible contracts for all payload expert squads.
- `rg -n "selector|schema_version|expert-squad.jsonc|missing selector|without selector" packages/opencorvus/test/expert-squad packages/opencorvus/test/server .opencorvus/expert-squads -g "*.ts" -g "*.jsonc" -g "*.md"`
  - Finding: `registry.test.ts` still had an explicit `omitted selector does not generate selector metadata` expectation, which preserved the selector-less package bypass.
- `rg -n "goal-workload-analyst|visual-html-skeleton|visual_validation_evidence|competitor_reference_evidence|screenshot_sha256|SHA-256|RPC|CLI|SDK|\bUI\b|\bAPI\b|\bMCP\b" .opencorvus/expert-squads/builtin .opencorvus/expert-squads/wujiang/opentest packages/opencorvus/test/expert-squad/package-manager.test.ts -g "*.md" -g "*.jsonc" -g "*.ts"`
  - Finding: `backend` projected `goal-workload-analyst` without a backend-specific role overlay; `frontend-innovate` downstream overlays did not all name the HTML design draft evidence contract; selected standalone selector/overlay files contained unexplained abbreviations.

### Independent Agent Feedback

Round 1 used three independent read-only agents with explicit instructions not to edit, commit, push, create worktrees, or delegate further.

- Bernoulli found a protocol validation gap: `ExpertSquadRegistry` still allowed non-general selector-less packages because manifest `selector` was optional and selector rendering returned `undefined`.
- Fermat found a proof gap: `algorithm` and `backend` had source/payload selector text, but no release/manager/resolver test proved they became visible selector skills after payload release.
- Sartre found prompt contract gaps: `frontend-innovate` downstream overlays did not all carry the `visual-html-skeleton` and `visual_validation_evidence` contract; `frontend-innovate` frontend-design omitted full `competitor_reference_evidence` field guidance; `backend` projected `goal-workload-analyst` without a backend role overlay; some standalone selector/overlay files used unexplained abbreviations.

Round 2 used three independent read-only agents after the first repair pass.

- Herschel found no new actionable issue in registry/runtime selector projection, payload generation, or tracked payload-source verification.
- Banach found that `frontend-innovate` Build still did not explicitly carry `visual_validation_evidence` or `competitor_reference_evidence`, Visual QA and Integrity still used URL without local vocabulary, and the formal contract test was too weak to catch role-field regressions.
- Lorentz found that the selector-less registry exemption was keyed only by `id === "general"` instead of `namespace === "builtin" && id === "general"`, and that the resolver validation command depended on a mechanical Bun timeout override instead of an inactivity-aware test.

Round 3 used three independent read-only agents after the second repair pass.

- Hooke found no new code-contract gap, but required the validation record to disclose that unrelated dirty worktree changes mean validation commands are current-worktree evidence rather than clean staged-only checkout evidence.
- Anscombe confirmed the prompt text itself was repaired, but found the `frontend-innovate` formal contract test was still too loose because it used scattered string checks instead of a per-role required-field matrix.

Round 4 used two independent read-only agents after the role-matrix test repair.

- Chandrasekhar found a stale fixed-duration timeout command in the implementation-plan validation list; the passed-command list was already corrected, but the plan text still contradicted the no mechanical timeout cleanup.
- Pauli found that the role matrix and prompt text still did not lock `screenshot_sha256`, URL vocabulary, and the exact `HTML design draft screenshot evidence` wording across all four `frontend-innovate` roles.

## Diagnosis

The latest namespaced external expert-squad contract makes the visible selection path part of the runtime protocol: Orchestrator reads mounted selector skills, then calls `select_expert_squad`, which writes only `prompt_profile.active`.

`algorithm` and `backend` are current non-general, payload-distributed packages with good README-level expert contracts and role overlays, but their manifests omit `selector` and the package roots lack `selector.md`. That means they can be installed and manually selected, but they do not participate in the visible selector-skill protocol used by the Orchestrator. This is a definition/protocol gap, not a resolver bug.

The fix is to add first-class selector definitions to `algorithm` and `backend`, expose their expert contracts in `selector.md`, regenerate payload, and make tests require selector-visible expert contracts for every payload-distributed non-general package.

## Implementation Plan

1. Add manifest `selector` metadata to `algorithm` and `backend`.
2. Add top-level `selector.md` files for `algorithm` and `backend` with selector-visible expert contracts, activation criteria, rejection conditions, and continuation requirements.
3. Update payload tests so every payload package declares selector metadata and ships `selector.md`; extend formal-contract expectations for algorithm and backend selector text.
4. Regenerate `packages/opencorvus/src/expert-squad/payload.ts`.
5. Update the July records README with this record.
6. Run focused validation:
   - `bun packages/opencorvus/script/generate-expert-squad-payload.ts`
   - `bun test packages/opencorvus/test/expert-squad/registry.test.ts`
   - `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --test-name-pattern "payload package sources match|payload packages expose selector-visible expert contracts|payload packages carry formal expert contracts|released payload packages project selector skills through the resolver|releases payload packages into an empty project|payload release rejects existing non-directory targets"`
   - `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "projects selector skills only from explicitly installed project packages|resolves general skill projection to selector skills"`
   - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
   - `git diff --check`

## Implementation Summary

- Added manifest selector metadata to `builtin/algorithm` and `builtin/backend` without changing their manifest IDs, namespace, active-selection semantics, or capability projection model.
- Added top-level `selector.md` files for `algorithm` and `backend` with activation criteria, selector-visible expert contracts, rejection conditions, and Orchestrator protocol requirements.
- Repaired `wujiang/opentest/selector.md` so it explicitly names the `select_expert_squad` tool instead of only showing the JSON arguments.
- Regenerated `packages/opencorvus/src/expert-squad/payload.ts` from repository package sources.
- Added payload tests that require every payload-distributed package to expose selector metadata and a selector-visible expert contract.
- Extended formal expert-contract payload assertions so `algorithm` and `backend` selector content is covered, not just README and role overlays.
- Updated the July records index for this record.
- Tightened `ExpertSquadRegistry` so selector metadata may be omitted only by the built-in runtime `builtin/general` package.
- Replaced the old selector-less registry expectation with a rejection test.
- Added a payload release plus `PromptProfileResolver.resolveSkillProjection` test proving every released payload package, including `algorithm` and `backend`, projects an Orchestrator-mounted selector skill with `required_tools: ["select_expert_squad"]`.
- Added the missing `backend` `goal-workload-analyst` prompt overlay and manifest/README binding.
- Strengthened `frontend-innovate` role overlays so Frontend Design, Build, Visual QA, and Integrity all carry the `visual-html-skeleton`, HTML design draft screenshot evidence, and `visual_validation_evidence` contract.
- Added local vocabulary lines for standalone selector/overlay files that use abbreviations.
- Restricted the selector-less registry exemption to `builtin/general` and added a `project/general` rejection test.
- Converted the slow `PromptProfileResolver` selector-skill projection test to `{ timeout: 0 }` plus `withPromptProfileResolverInactivityTimeout`, so the test uses no-activity timeout semantics rather than a fixed elapsed-time override.
- Strengthened the `frontend-innovate` formal-contract payload test into a role-field matrix covering `visual-html-skeleton`, `competitor_reference_evidence`, `screenshot_sha256`, `visual_validation_evidence`, HTML design draft screenshot evidence, and local URL vocabulary.
- During focused package-manager validation, the existing non-directory payload-release test exposed an outdated expected error string; the assertion was updated to the current manager error emitted by the owning path.
- Converted the `frontend-innovate` overlay assertions to an explicit role-by-role matrix for Frontend Design, Build, Visual QA, and Integrity so each role locks the fields it must carry.
- Removed stale fixed-duration timeout validation commands from the implementation plan.
- Strengthened the `frontend-innovate` role matrix and overlays so all four roles carry source/competitor URL traceability, `screenshot_sha256`, exact HTML design draft screenshot evidence wording, `competitor_reference_evidence`, `visual_validation_evidence`, and `visual-html-skeleton` where applicable.

## Validation Results

Initial validation findings:

- `payload packages expose selector-visible expert contracts` first failed because the new assertion required the exact `## Expert Contract` heading, while `frontend-automation-debug` intentionally uses `## Expert Debug Contract`. The test was corrected to require an Expert/Contract selector section without weakening package-specific formal-contract assertions.
- The same test then failed because MirrorTest selector text did not contain the literal `select_expert_squad` tool name. This was a real selector protocol gap; `wujiang/opentest/selector.md` was repaired and payload was regenerated.
- Third-round review noted that the worktree still contains unrelated unstaged and untracked user changes outside this staged expert-squad repair. The commands below are current-worktree validation evidence, not a clean staged-only checkout proof. No staged/unstaged overlap exists on the expert-squad files touched here; isolating staged-only verification would require hiding or moving unrelated user changes, which was intentionally not done.

Passed:

- `bun packages/opencorvus/script/generate-expert-squad-payload.ts`
- `bun packages/opencorvus/script/generate-expert-squad-payload.ts` after adversarial-review fixes
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts`
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --test-name-pattern "payload package sources match|payload packages expose selector-visible expert contracts|payload packages carry formal expert contracts|released payload packages project selector skills through the resolver|releases payload packages into an empty project|payload release rejects existing non-directory targets"`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "projects selector skills only from explicitly installed project packages|resolves general skill projection to selector skills"`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
- `git diff --cached --check`
