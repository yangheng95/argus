# Packaged Expert Squad Plugin Runtime

Date: 2026-07-07
Status: Implemented and verified
Owner: Codex

## Glossary

- ABI: Application Binary Interface, the runtime module surface package tools import when they are compiled for execution.
- DB: Database.
- UI: User Interface.

## Recall

### User Request

The user asked why task `tsk_f3c7c3054001AgA4zquJPTcFU5` appeared paused after requesting the MirrorTest expert squad to comprehensively test the replicated futures webpage and generate test cases plus a report.

### Acceptance Criteria

- Explain the pause from durable task, decision-log, protocol-event, and sidecar package evidence rather than treating `active` as the root cause.
- Preserve the MirrorTest expert-squad architecture: active selection remains `prompt_profile.active = "opentest"` and package tools are projected by `PromptProfileResolver`.
- Fix the packaged runtime root cause so expert-squad package tools can resolve `@opencorvus-ai/plugin` from the sidecar executable directory.
- Do not add fallback module lookup, aliases, inactive package scanning, hidden gates, or an MirrorTest-specific workaround.
- Add focused tests proving the packaged runtime module copy includes the package-tool runtime surface and can resolve it through the same packaged `package.json` path used at runtime.
- Do not restart, refresh, kill, or otherwise disturb the running OpenCorvus or overlay process.

### Hard Constraints

- No fallback or compatibility path.
- No second active expert-squad source.
- No changes to expert-squad identity, namespace, catalog, payload release, or prompt selection semantics.
- No new worktree and no git reset.
- Runtime timeout semantics remain no-activity based; this repair is not allowed to weaken the MirrorTest runner timeout contract.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-06-expert-squad-namespaced-source-layout.md`
- `specs/records/2026-07/2026-07-06-expert-squad-payload-generation.md`
- `specs/records/2026-07/2026-07-07-opentest-lifecycle-virtual-agents.md`
- `specs/records/2026-07/2026-07-07-opentest-visual-qa-runner-registration.md`
- `specs/records/2026-07/2026-07-07-opentest-futures-e2e.md`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/runtime/package-require.ts`
- `packages/opencorvus/script/build-artifact.ts`
- `packages/opencorvus/script/build-runtime-node-modules.ts`
- `packages/opencorvus/script/build.ts`
- `packages/opencorvus/test/script/build-artifact.test.ts`
- `packages/plugin/package.json`
- `packages/plugin/src/index.ts`
- `packages/plugin/src/tool.ts`
- `C:/Users/chuan/AppData/Local/ai.opencorvus.overlay/embedded/sidecar-12073-7afd9c8835ec1dc1/package.json`

### Repository Search Evidence

| Command | Finding |
| --- | --- |
| `sqlite3 -readonly ... engine_task where id='tsk_f3c7c3054001AgA4zquJPTcFU5'` | The task has `time_started` but no `time_completed`; `error` contains `Cannot find module '@opencorvus-ai/plugin' from ...sidecar.../package.json`. |
| `sqlite3 -readonly ... decision_log where task_id='tsk_f3c7c3054001AgA4zquJPTcFU5'` | The only decision log is `select_expert_squad`, switching from `general` to `opentest`. No goals were produced. |
| `sqlite3 -readonly ... protocol_event where task_id='tsk_f3c7c3054001AgA4zquJPTcFU5'` | The final event remains `status:"active"` but summarizes `Orchestrator failed: Cannot find module '@opencorvus-ai/plugin'...`, so the UI status is stale relative to the stored error. |
| `Get-Content ...sidecar.../package.json` and `Test-Path ...node_modules/@opencorvus-ai/plugin` | The extracted sidecar package has a minimal `package.json` and no `node_modules/@opencorvus-ai/plugin`. |
| `rg -n "@opencorvus-ai/plugin|runtimePackageRequire\\(\\)\\.resolve" packages/opencorvus/src packages/opencorvus/test packages/overlay -S` | `PromptProfileResolver.bundlePackageTool` resolves `@opencorvus-ai/plugin` through `runtimePackageRequire().resolve()` before compiling package tools. MirrorTest payload tools import `tool` from that package. |
| `rg -n "artifactRuntimeNodeModules|copyRuntimeNodeModules|artifactExternalModules|@opencorvus-ai/plugin" packages/opencorvus/script packages/opencorvus/src packages/opencorvus/test/script packages/opencorvus/test/expert-squad -S` | `artifactRuntimeNodeModules()` is the single source for runtime `node_modules` copied beside packaged executables; it includes Playwright, Sharp, watcher, credential provider, pty, and screenshots, but not `@opencorvus-ai/plugin`. |
| `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\\.jsonc|prompt_profile\\.active|select_expert_squad|active_skill_projection|capability_projection" ...` | Expert-squad selection and projection remain owned by `prompt_profile.active` and `PromptProfileResolver`; this repair should not change those surfaces. |
| `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test` | Current MirrorTest package source is `.opencorvus/expert-squads/wujiang/opentest` and already carries package tools that import `@opencorvus-ai/plugin`. |

### Independent Agent Feedback

No independent sub-agent was used. The failure is localized to packaged runtime module copying, and no user request authorized sub-agent delegation.

## Failure Chain

Observable phenomenon: the task appears paused or active with no terminal and no goals.

Direct trigger: after `select_expert_squad` switched the task to MirrorTest, the Orchestrator tried to project active MirrorTest package tools. `PromptProfileResolver.bundlePackageTool()` called `runtimePackageRequire().resolve("@opencorvus-ai/plugin")`, using the embedded sidecar executable directory's `package.json` as the module root. That root had no `node_modules/@opencorvus-ai/plugin`, so module resolution threw before Requirements, Architect, Build, Visual QA, or Integrity could start.

Deep cause: packaged sidecar runtime dependency generation did not include the package-tool runtime surface required by expert-squad package tools. This is a packaging/runtime-module omission, not an MirrorTest workflow pause, not a test-runner timeout, and not a generated test-case failure.

Why previous validation missed it: MirrorTest resolver tests covered package tool projection from the development workspace, and packaged overlay health tests verified runtime native/browser modules. No test combined packaged runtime `package.json` module resolution with an expert-squad package tool import of `@opencorvus-ai/plugin`.

## Implementation Plan

1. Add `@opencorvus-ai/plugin` to `artifactRuntimeNodeModules()` so normal packaged runtime module copying includes the package-tool runtime surface beside CLI and overlay-server executables.
2. Do not add it to `artifactExternalModules()` unless a build test proves static bundling must be externalized. The immediate runtime failure is from `runtimePackageRequire().resolve()` needing a filesystem module path for package-tool compilation.
3. Add a focused `build-artifact.test.ts` test that:
   - asserts the runtime module set includes `@opencorvus-ai/plugin`;
   - copies that module with `copyRuntimeNodeModules()`;
   - resolves it through a packaged `package.json`;
   - compiles and imports a temporary package tool that imports `tool` from `@opencorvus-ai/plugin`.
4. Update this record and the monthly README.
5. Validate with the focused build-artifact test, docs link test, typecheck, and `git diff --check`.

## Implementation Summary

- Added `@opencorvus-ai/plugin` to the packaged runtime node module manifest in `packages/opencorvus/script/build-artifact.ts`.
- Left expert-squad identity, namespace, payload release, active selection, catalog loading, and package refs unchanged.
- Added `packages/opencorvus/test/script/build-artifact.test.ts` coverage proving:
  - the packaged runtime module set includes `@opencorvus-ai/plugin`;
  - `copyRuntimeNodeModules()` copies the plugin package and its workspace SDK dependency;
  - a temporary package tool importing `tool` from `@opencorvus-ai/plugin` can compile through the same packaged `package.json` resolution path used by `PromptProfileResolver.bundlePackageTool()`.
- Confirmed the actual packaged overlay-server artifact now contains `node_modules/@opencorvus-ai/plugin/package.json` and `node_modules/@opencorvus-ai/sdk/package.json`.

## Verification Results

Passed:

- `bun test packages/opencorvus/test/script/build-artifact.test.ts -t "packaged runtime ships expert-squad package tool plugin runtime|runtime node module copy lets expert-squad package tools resolve the plugin runtime" --timeout 120000`
- `bun test packages/opencorvus/test/script/build-artifact.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/packaged-overlay-server-health.test.ts --timeout 240000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
- `Test-Path packages/opencorvus/dist/opencorvus-overlay-server-windows-x64/node_modules/@opencorvus-ai/plugin/package.json`
- `Test-Path packages/opencorvus/dist/opencorvus-overlay-server-windows-x64/node_modules/@opencorvus-ai/sdk/package.json`

## Review Notes

- This is not fallback: package tool compilation has one required runtime ABI path, and the packaged runtime now ships that path.
- This does not change MirrorTest identity, namespace, payload, selector, package refs, or active selection.
- Existing running tasks will still use their already-extracted sidecar until the packaged overlay/server is rebuilt and relaunched by an explicitly authorized operation.
