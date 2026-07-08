# Expert Squad Payload Seeding and Skill Refresh

Supersession note: Package-layout statements in this record that use `.opencorvus/expert-squads/<id>` are superseded by `2026-07-06-expert-squad-namespaced-source-layout.md`; current payload and project package roots are `.opencorvus/expert-squads/<namespace>/<id>/`.

## Recall

User request:

- The existing `opencorvus-expert-squad-creator` Codex skill is outdated and no longer matches the current architecture.
- Update that skill first so it guides agents through the current dynamic `.opencorvus/expert-squads/<id>` architecture.
- Then make the current expert squads into built-in payloads and automatically release those expert squads into each project.
- Before creating payloads, ensure the payload source is the latest expert-squad configuration.

Acceptance criteria:

- The personal Codex skill `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator` no longer instructs agents to edit obsolete PromptProfile/built-in selector-skill surfaces as the main path.
- The refreshed skill points agents to current runtime authority: `packages/opencorvus/src/expert-squad/**`, `.opencorvus/expert-squads/<id>`, `PromptProfileResolver`, catalog/manager routes, and current architecture records.
- The non-`general` project expert squads currently in repository `.opencorvus/expert-squads` are validated against current registry/config before being embedded as payloads.
- Payload release installs missing payload packages into a project canonical directory `.opencorvus/expert-squads/<id>` using the same validation semantics as package import, with no fallback, no name guessing, no second active-selection source, and no hidden compatibility path.
- Built-in runtime packages remain only `general`; payload packages are released to project directories and then loaded through the normal project package discovery path.
- Tests prove empty projects get payload packages, existing same-ID project packages are not overwritten, and payload sources match current repository expert-squad packages.

Hard constraints:

- No fallback or compatibility logic.
- No double source for active selection; `prompt_profile.active` remains the selected expert-squad ID.
- No host-side routing gate; payload provisioning must be a concrete package installation step before catalog/discovery surfaces.
- No automatic overwrite of user/project packages with the same ID unless an explicit replace API is used.
- Do not restart, refresh, or kill running OpenCorvus / overlay processes.
- Any code change must include tests.
- All spec records stay under `specs/records/2026-07/`.

Sources read before implementation:

- `C:/Users/chuan/.codex/skills/.system/skill-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/agents/openai.yaml`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-05-expert-squad-skill-projection-completeness.md`
- `specs/records/2026-07/2026-07-05-expert-squad-catalog-stale-session-scope-repair.md`
- `packages/opencorvus/src/expert-squad/builtin/index.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/manager.ts`
- `packages/opencorvus/src/expert-squad/catalog.ts`
- `packages/opencorvus/test/expert-squad/registry.test.ts`
- `packages/opencorvus/test/expert-squad/package-manager.test.ts`

Repository search evidence:

- `rg --files packages/opencorvus/src/expert-squad .opencorvus packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test`
- `rg -n "ExpertSquadRegistry|expert-squads|expert-squad.jsonc|importExpertSquad|exportExpertSquad|builtin|built_in|general|PromptProfileResolver|payload|seed|release|copy|extract" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current/architecture specs/records/2026-07 -g "*.ts" -g "*.tsx" -g "*.md"`
- `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(" packages/opencorvus/src/expert-squad/registry.ts packages/opencorvus/src/expert-squad/catalog-profile.ts packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/test/expert-squad/registry.test.ts`

Findings:

- Current architecture says expert squads are internal scenario / agent capability packages, not personal Codex skills.
- `PromptProfile.builtIns` should only retain the common built-in `general` profile; non-general squads are package-discovered from `.opencorvus/expert-squads/<id>`.
- `packages/opencorvus/src/expert-squad/builtin` currently contains only `general`, while repository `.opencorvus/expert-squads` contains the current non-general squads: `algorithm`, `backend`, `frontend-automation-debug`, `frontend-innovate`, and `frontend-replica`.
- `ExpertSquadPackageManager.importDirectory` and `importArchive` already normalize imports into `.opencorvus/expert-squads/<id>`, reject runtime internals, reject built-in ID collision, serialize same-ID replacements, validate after move, and preserve session/project selection state.
- `ExpertSquadRegistry.loadEmbeddedPackage` already parses embedded in-memory files, but built-in runtime source intentionally only includes `general` today.
- `ExpertSquadRegistry.loadPackage/loadSourcePackage` are the validation authority for clear-text package directories.
- There is no existing payload seed/release entry point.

Independent agent feedback:

- Lorentz reviewed the implemented payload/projection/skill-doc surfaces and confirmed non-`general` squads did not return to `PromptProfile.builtIns`, payload release does not overwrite existing project packages, and selector/default/package skills share `PromptProfileResolver` as the runtime projection surface.
- Lorentz found one blocking directory-safety issue: embedded payload file keys were written directly and only manifest-referenced files were validated by `ExpertSquadRegistry.loadEmbeddedPackage`. The implementation now validates every embedded payload file key with the same relative-path rules used for archives and asserts each write remains inside the staging directory.
- Lorentz found one missing route-level test: `/expert-squad/catalog` needed an empty-project payload seeding test because the user-visible failure came from overlay catalog calls. The server route test now covers this path.
- Lorentz noted a residual cleanup candidate: `PromptProfile.catalog()` is still exported as a built-ins-only helper but current source search found no runtime callers, only historical spec mentions. It was not deleted in this task because dead-code deletion requires explicit cleanup approval.

## Design

Use one package payload source generated from the current repository `.opencorvus/expert-squads/<id>` folders. The payload source is not runtime `builtInPromptProfiles`: it is a distribution payload that is released into projects before normal project package discovery.

The release operation must:

1. Validate every payload package through the current registry parser before installation.
2. Install only when `.opencorvus/expert-squads/<id>` is missing.
3. Never overwrite a project/user package automatically.
4. Write the clear-text package files into the canonical project package directory.
5. Re-load the installed package after writing, matching import-directory post-move validation.
6. Be called from catalog/discovery surfaces before listing project packages, so an empty project becomes usable without manual import.

## Implementation Plan

1. Replace the outdated personal skill content and checklist with current architecture guidance.
2. Add a payload module under `packages/opencorvus/src/expert-squad/` that imports generated text payload files for non-general squads.
3. Add a package-manager release function that installs missing payloads with validation and no overwrite.
4. Call payload release from project expert-squad catalog/discovery paths before package listing.
5. Add tests for skill contents, payload freshness against repository packages, empty-project release, no overwrite, and docs index health.

## Implementation

- Refreshed `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator` so the skill now points agents to the dynamic package architecture, current registry/manager/resolver authority, README-as-Orchestrator-append-prompt behavior, payload release rules, and focused validation commands.
- Added `packages/opencorvus/src/expert-squad/payload.ts` with embedded text payload sources generated from the current repository `.opencorvus/expert-squads/{algorithm,backend,frontend-automation-debug,frontend-innovate,frontend-replica}` packages.
- Added `ExpertSquadPackageManager.releasePayloadPackages()` to release missing payloads into `.opencorvus/expert-squads/<id>`, validate embedded and staged packages, reject built-in ID collisions, reject symlink/non-directory targets, skip existing directories without overwrite, and remove newly moved targets if post-move validation fails.
- Added embedded payload file-key validation so payload maintenance mistakes such as `../x`, absolute Windows paths, empty keys, or alternate-data-stream-style `:` keys cannot escape the staging directory.
- Wired payload release into `PromptProfileResolver` project package discovery, direct project package load, and selector catalog loading. Empty projects therefore expose payload squads and selector skills through the same project package path as imported packages.
- Kept runtime built-in expert squads limited to `general`; non-`general` payloads become project packages before catalog/resolver usage.
- Updated current architecture docs to distinguish runtime built-in `general` from distributable non-`general` payloads that are released as clear-text project packages.

## Validation Results

- `python C:/Users/chuan/.codex/skills/.system/skill-creator/scripts/quick_validate.py C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator` passed.
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/server/expert-squad-routes.test.ts` passed: 29 pass, 0 fail, 211 `expect()` calls. This includes payload source freshness, no-overwrite release, unsafe embedded key rejection, non-directory target rejection, post-move rollback, and empty-project `/expert-squad/catalog` seeding.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed earlier in this task after selector catalog payload release was added: 68 pass, 0 fail, 308 `expect()` calls.
- `bun test packages/opencorvus/test/agent/prompt-profile.test.ts` passed earlier in this task: 18 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts` passed earlier in this task: 7 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts` passed earlier in this task: 44 pass, 0 fail.
- `bun test packages/opencorvus/test/server/config-routes.test.ts` passed after payload catalog wiring: 14 pass, 0 fail, 120 `expect()` calls.
- `bun test packages/opencorvus/test/server/skill-routes.test.ts` passed earlier in this task after the stale-session route test was tightened: 24 pass, 1 skip, 0 fail, 201 `expect()` calls.
- `bun test packages/opencorvus/test/tool/skill.test.ts` passed after skill projection checks: 13 pass, 0 fail, 150 `expect()` calls.
- `bun test packages/opencorvus/test/engine/git-ignore.test.ts` passed: 5 pass, 0 fail, 38 `expect()` calls.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 pass, 0 fail, 66 `expect()` calls.
- `bun run --cwd packages/opencorvus typecheck` passed after payload source typing was made explicit.
- `bun run --cwd packages/opencorvus build` passed, confirming the actual build pipeline accepts the repository-root text payload imports.
- `git diff --check -- <relevant expert-squad, engine, route, test, and spec files>` passed.
