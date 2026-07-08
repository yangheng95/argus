# Expert Squad Project-Open Payload Release

Date: 2026-07-08
Status: Implemented, adversarially reviewed, and verified
Owner: Codex

## Recall

### User Request

The user reported that opening a new project does not automatically release the expert-squad payload.

### Acceptance Criteria

- Opening/providing a project through the real project lifecycle must provision bundled non-general expert-squad payload packages into `.opencorvus/expert-squads/<namespace>/<id>/`.
- The automatic release must use `ExpertSquadPackageManager.releasePayloadPackages()` as the single payload provisioning owner.
- Existing project packages must not be overwritten, including packages with the same manifest `id` in another namespace.
- `prompt_profile.active` must remain the only active expert-squad selection source and must not be modified by payload release.
- `PromptProfileResolver` must remain read-only for package discovery/catalog/projection and must not call payload release.
- The existing explicit `POST /expert-squad/release-payload` route can remain as a manual provisioning surface, but it must not become a second implementation.
- Failures during automatic release must surface as project-open/bootstrap failures instead of being silently ignored.

### Hard Constraints

- No fallback, compatibility alias, inactive-package scan, hidden state, second active field, or UI-only filtering.
- Keep namespaced package layout only: `.opencorvus/expert-squads/<namespace>/<id>/`.
- Keep runtime built-in packages limited to `general`; payload packages are released into project directories before normal discovery.
- Do not restart, kill, refresh, or otherwise interfere with running OpenCorvus or overlay processes.
- Do not use `git reset`, create a worktree, or overwrite unrelated dirty changes.
- Existing unrelated dirty worktree entries at task start:
  - `packages/opencorvus/src/provider/models-snapshot.ts`
  - `specs/artifacts/expert_provider.zip`

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-06-expert-squad-namespaced-source-layout.md`
- `specs/records/2026-07/2026-07-08-expert-squad-selector-contract-completion.md`
- `specs/records/2026-07/README.md`
- `packages/opencorvus/src/project/instance.ts`
- `packages/opencorvus/src/project/project.ts`
- `packages/opencorvus/src/project/runtime-paths.ts`
- `packages/opencorvus/src/expert-squad/manager.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/server/routes/expert-squad.ts`
- `packages/opencorvus/src/config/config.ts`
- `packages/opencorvus/test/expert-squad/package-manager.test.ts`
- `packages/opencorvus/test/server/expert-squad-routes.test.ts`
- `packages/opencorvus/test/project/instance-cache.test.ts`
- `packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`

### Repository Search Evidence

- `rg -n "releasePayloadPackages|payloadPackageSources|release-payload|expert-squad/release|ExpertSquadPackageManager|fromDirectory|provide\\(|ProjectRuntimePaths|prompt_profile\\.active|expert-squads" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records/2026-07`
  - Initial finding: `releasePayloadPackages()` was owned by `ExpertSquadPackageManager`; the server route and overlay service called the explicit provisioning route; project lifecycle did not call it.
- `rg --files .opencorvus packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/opencorvus/test/project packages/overlay/test`
  - Finding: current repository payload sources are namespaced under `.opencorvus/expert-squads/builtin/*` and `.opencorvus/expert-squads/wujiang/opentest`.
- `rg -n "project open|open project|new project|release payload|payload release|release-payload|expert squad payload|ExpertSquadPackageManager.releasePayloadPackages" packages/opencorvus/test packages/overlay/test specs/current specs/records/2026-07`
  - Initial finding: package-manager tests covered explicit release behavior, and route tests asserted `GET /expert-squad/catalog` did not release payload packages for an empty project. There was no project-open regression.
- `rg -n "projectConfigRoot\\(|Instance\\.directory|Instance\\.worktree|\\.opencorvus/expert-squads|expert-squads" packages/opencorvus/src/expert-squad packages/opencorvus/src/config packages/opencorvus/src/server/routes/expert-squad.ts packages/opencorvus/test/expert-squad packages/opencorvus/test/server/expert-squad-routes.test.ts packages/opencorvus/test/project -g "*.ts"`
  - Finding: expert-squad package storage uses `ProjectRuntimePaths.projectConfigRoot(projectDirectory)` and the explicit route passes `Instance.directory`. Automatic release must use the same directory source to avoid a second package root.
- `rg -n "function loadState|async function loadState|loadState\\(|snapshotForProject" packages/opencorvus/src/config/config.ts`
  - Finding: `Config.snapshotForProject()` calls `loadState({ readOnly: true, directory, worktree })`; it does not call `Instance.provide`, so invoking release during project bootstrap does not create an `Instance.provide` recursion.
- `rg -n "ExpertSquadPackageManager.releasePayloadPackages" packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
  - Finding: existing tests intentionally prevent resolver/read paths from calling payload release. This remains correct; the release hook belongs to project lifecycle bootstrap.

### Independent Agent Feedback

Two read-only adversarial agents were started for this task:

- Boole confirmed the single initialization path: project-scoped server routes enter `Instance.provide({ directory, init: InstanceBootstrap })`, which creates context through `Project.fromDirectory()`. Boole found production release call sites only in `POST /expert-squad/release-payload`, with overlay holding only a service wrapper. Recommendation: hook release into `bootstrapContext()` in `packages/opencorvus/src/project/instance.ts`, keep resolver/catalog pure, and add project-open tests for release, no-overwrite, active profile stability, and idempotent explicit release.
- Godel confirmed no recursion from `releasePayloadPackages()` to `Instance.provide()` because `Config.snapshotForProject()` uses read-only `loadState({ readOnly: true, directory, worktree })`. Godel found four actionable issues: update route tests from first-install to idempotent/repair semantics, fail fast on stale direct-child roots during bootstrap, update this implementation record after code changes, and add project-open coverage for same manifest ID in a different namespace. All four were addressed.

No additional unresolved issue remained after those fixes.

## Diagnosis

The previous namespaced layout repair removed implicit payload release from resolver and catalog read paths because those paths mutated projects during read-only catalog/projection requests. That repair was correct, but it left only the explicit route/manual overlay action as the provisioning path. A newly opened project can therefore reach the catalog with only built-in `general`, because no lifecycle bootstrap has released bundled payload packages yet.

The root fix is not to restore resolver/catalog mutation. The correct single lifecycle point is `Instance.provide()` bootstrap, after `Project.fromDirectory()` has materialized the project context and before user code or routes run inside that context. This keeps provisioning tied to opening a project, preserves the explicit manager as the only release implementation, and leaves resolver/catalog as pure readers.

## Implementation Summary

- Added `ExpertSquadPackageManager.releasePayloadPackages({ projectDirectory: ctx.directory })` to `bootstrapContext()` in `packages/opencorvus/src/project/instance.ts`.
- Kept payload installation single-source in `ExpertSquadPackageManager`; no resolver/catalog release call was added.
- Added `ExpertSquadRegistry.discover(ctx.directory)` immediately after release in bootstrap so stale direct-child roots, malformed canonical package metadata, and other normal discovery failures surface during project open instead of later catalog reads.
- Updated project-open regression tests to prove payload packages are released on first `Instance.provide()`, `prompt_profile.active` remains unchanged, `config.agent` is not written, same-ID project packages in another namespace are not overwritten, cached provide does not rewrite project-owned package files, and stale direct-child package roots fail fast.
- Converted `instance-cache.test.ts` to serial no-activity timeout wrapping because project-open now performs real payload release work and fixed elapsed-time test limits were cutting off live async bootstrap work.
- Updated expert-squad route tests so `GET /expert-squad/catalog` reads project-open released payload packages, and `POST /expert-squad/release-payload` remains an idempotent/manual repair surface that installs a deliberately removed package or skips already released packages.
- Updated the July records README with this record while leaving unrelated concurrent README additions untouched.

## Validation Results

Passed:

- `bun test packages/opencorvus/test/project/instance-cache.test.ts`
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts`
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --test-name-pattern "general expert-squad selectors load package selector instructions"`
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --test-name-pattern "payload release"`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

Initial validation findings:

- The first no-overwrite project-open test wrote an expert-squad package into a git fixture before the first `ensureGitignore()` bootstrap commit. That polluted the git initialization scenario, so the test was corrected to model an already-owned directory project package before release; git-project automatic release remains covered by the first project-open test.
- Running `instance-cache.test.ts` and `expert-squad-routes.test.ts` as two concurrent Bun processes produced transient git/process cleanup failures from shared test roots. The suites were rerun serially and both passed. No production change was made for this test-runner concurrency artifact.

Pending final validation after staging:

- `git diff --cached --check`
