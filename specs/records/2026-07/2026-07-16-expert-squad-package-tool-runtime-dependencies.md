# 2026-07-16 Expert Squad Package Tool Runtime Dependencies

## Recall

- User request: investigate and fix the expert-squad install failure shown in Settings, and search for similar failures rather than only answering whether it is an environment or package problem.
- Acceptance criteria:
  - Explain and fix the root cause for payload install failing with `Cannot find package 'typescript'`.
  - Prevent similar package-tool runtime dependency omissions.
  - Preserve the current expert-squad package architecture: payload packages release into `.opencorvus/expert-squads/<namespace>/<id>`, and `prompt_profile.active` remains the only active selection source.
  - Do not add fallback lookup, parent `node_modules` probing, compatibility aliases, hidden gates, or second dependency sources.
- Hard constraints:
  - No fallback logic.
  - Do not restart or refresh the running Overlay/OpenCorvus process.
  - Do not touch unrelated dirty user changes; current unrelated dirty file observed: `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`.
  - Every code change needs focused tests.
- Sources read:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/current/architecture/04-extensions.md`
  - `specs/records/2026-07/README.md`
  - `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
  - `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
  - `packages/opencorvus/src/expert-squad/package-tool-bundle.ts`
  - `packages/opencorvus/src/runtime/package-require.ts`
  - `packages/opencorvus/script/build-artifact.ts`
  - `packages/opencorvus/script/build-runtime-node-modules.ts`
  - `packages/opencorvus/test/script/build-artifact.test.ts`
  - `.opencorvus/expert-squads/wujiang/opentest/lib/opentest/opentest-protocol-engine.ts`
- Repository search evidence:
  - `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
  - `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\(|loadPackage\(|loadSourcePackage\(|importDirectory\(|importArchive\(|exportArchive\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test`
  - `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | Sort-Object`
  - `rg -n "ALLOWED_EXTERNAL_IMPORTS|externalImportFingerprint|runtimePackageRequire\(\)\.resolve|artifactRuntimeNodeModules|artifactRuntimeNodeModuleNames|copyRuntimeNodeModules|runtimePackageRequireForExecPath|typescript" packages/opencorvus/src packages/opencorvus/script packages/opencorvus/test package.json packages/opencorvus/package.json .opencorvus/expert-squads -S`
- Findings:
  - `PackageToolBundle` allows package tools to import `typescript` as the only external Application Binary Interface dependency and fingerprints it through `runtimePackageRequire().resolve("typescript")`.
  - `runtimePackageRequire()` intentionally resolves from the packaged executable directory `package.json`, refusing parent `node_modules` in packaged runtime.
  - The packaged runtime module list includes `@opencorvus-ai/plugin` for expert-squad package tools but omits `typescript`.
  - MirrorTest's protocol engine imports `typescript`, so payload install legitimately exercises the allowed ABI dependency.
  - The local installed sidecar under `C:/Users/chuan/AppData/Local/ai.opencorvus.overlay/embedded/sidecar` contains no `node_modules/typescript`, matching the screenshot failure.
- Independent agent feedback: not used; this is a narrow package-runtime dependency repair with direct source evidence.

## Root Cause

The package-tool compiler and the packaged runtime dependency packer drifted. The compiler permits and fingerprints the `typescript` package as a runtime external dependency, while the packaged Overlay sidecar does not copy that dependency into its runtime `node_modules`. Installed source builds work because workspace `node_modules` is present; packaged sidecar installs fail because strict runtime package resolution starts from the sidecar `package.json`.

## Plan

1. Add `typescript` to the packaged runtime node module set used by CLI and overlay-server packages.
2. Export the package-tool allowed external dependency list as a source constant and add a regression test that proves every entry is present and resolvable from a copied packaged runtime tree.
3. Keep package-tool import policy unchanged; do not add fallback resolution from parent or global dependency locations.
4. Run focused script packaging tests plus docs link and diff checks.
