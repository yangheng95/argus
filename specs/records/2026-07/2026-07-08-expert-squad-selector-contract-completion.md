# Expert Squad Selector Contract Completion

Date: 2026-07-08
Status: Implemented and verified
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
- Do not change OpenTest virtual-agent runtime identity or introduce custom roles.
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
  - Finding: existing tests validate selector mechanics and formal contracts, but `payload packages carry formal expert contracts` only checks selector text for frontend and OpenTest packages; it does not require selector-visible contracts for all payload expert squads.

### Independent Agent Feedback

Not used. The issue is a direct definition/protocol completion with existing registry, resolver, and payload tests.

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
   - `bun test --timeout 30000 packages/opencorvus/test/expert-squad/package-manager.test.ts --test-name-pattern "payload package sources match|payload packages carry formal expert contracts"`
   - `bun test --timeout 30000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "projects selector skills only from explicitly installed project packages|resolves general skill projection to selector skills"`
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

## Validation Results

Initial validation findings:

- `payload packages expose selector-visible expert contracts` first failed because the new assertion required the exact `## Expert Contract` heading, while `frontend-automation-debug` intentionally uses `## Expert Debug Contract`. The test was corrected to require an Expert/Contract selector section without weakening package-specific formal-contract assertions.
- The same test then failed because OpenTest selector text did not contain the literal `select_expert_squad` tool name. This was a real selector protocol gap; `wujiang/opentest/selector.md` was repaired and payload was regenerated.

Passed:

- `bun packages/opencorvus/script/generate-expert-squad-payload.ts`
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts --timeout 30000`
- `bun test --timeout 30000 packages/opencorvus/test/expert-squad/package-manager.test.ts --test-name-pattern "payload package sources match|payload packages expose selector-visible expert contracts|payload packages carry formal expert contracts"`
- `bun test --timeout 30000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "projects selector skills only from explicitly installed project packages|resolves general skill projection to selector skills"`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 30000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
- `git diff --cached --check`
