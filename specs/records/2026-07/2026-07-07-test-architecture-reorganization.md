# Test Architecture Reorganization

Date: 2026-07-07
Status: Active implementation record
Owner: Codex

## Glossary

- API: Application Programming Interface.
- E2E: End-to-End.
- MCP: Model Context Protocol.
- SUT: System Under Test.

## Recall

### User Request

The user asked to reorganize tests according to the latest code and architecture.

### Acceptance Criteria

- Tests follow the current expert-squad package architecture: non-general expert squads are discovered from `.opencorvus/expert-squads/<namespace>/<id>/`, `prompt_profile.active` remains the only active selection source, and `PromptProfileResolver` remains the single runtime projection surface.
- Generic test infrastructure must not live under one domain such as `mcp` when it is used by expert-squad, file, server, and fixture tests.
- Mock-heavy isolated suites must remain executable through an explicit wrapper with an activity-based timeout and must not be collected accidentally by the default Bun test discovery.
- Reorganization must be mechanical and behavior-preserving: no fallback, compatibility alias, hidden gate, or weakened assertion.
- Focused validation must run the moved harness tests, domain wrappers, expert-squad tests, docs link tests, typecheck where touched, and `git diff --check`.

### Hard Constraints

- Do not use `git reset` or destructive rollback.
- Do not create a new git worktree.
- Do not restart, kill, refresh, or interfere with a running OpenCorvus or overlay process.
- Preserve existing uncommitted work and only change the test organization needed for this request.
- Browser/visual tests must continue to use the existing Node-based browser runner; no Bun-launched Playwright browser benchmark is introduced here.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-07-opentest-futures-e2e.md`
- `specs/records/2026-07/2026-07-07-opentest-lifecycle-virtual-agents.md`
- `specs/records/2026-07/2026-07-06-gui-quality-bug-hunt-iteration.md`
- An untracked July planning draft was observed as background user notes only and is not a committed source for this record.
- The pre-reorganization isolated Bun runner and self-test, now located at `packages/opencorvus/test/harness/isolated-bun-runner.ts` and `packages/opencorvus/test/harness/isolated-bun-runner.test.ts`
- `packages/opencorvus/test/mcp/headers.test.ts`
- `packages/opencorvus/test/mcp/headers.isolated.ts`
- `packages/opencorvus/test/mcp/oauth-browser.test.ts`
- `packages/opencorvus/test/mcp/oauth-browser.isolated.ts`
- `packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver-mcp-execution.test.ts`
- `packages/opencorvus/test/file/ripgrep.test.ts`
- `packages/opencorvus/test/file/ripgrep-early-stop.isolated.ts`
- `packages/opencorvus/test/fixture/tmpdir-git-lifecycle.test.ts`
- `packages/opencorvus/test/fixture/tmpdir-git-lifecycle.isolated.ts`

### Repository Search Evidence

| Command | Finding |
| --- | --- |
| `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile\\.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records` | Current expert-squad behavior spans registry, manager, resolver, catalog/routes, overlay services, and tests; tests must remain aligned to namespaced packages and resolver-owned projection. |
| `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release|runIsolatedBunTest|isolated-bun-runner|inactivity|Process\\.spawn|Ripgrep\\.files|browser-runner" packages/opencorvus/src packages/opencorvus/test packages/opencorvus/script packages/overlay/src packages/overlay/test specs/current specs/records` | The result is intentionally broad; the relevant cluster shows `runIsolatedBunTest` under `test/mcp` but used by MCP, expert-squad, server, file, and fixture tests. |
| `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test` | Current package sources are namespaced under `builtin/<id>` and `wujiang/opentest`; MirrorTest has `requirements`, `architect`, `build`, and `integrity` virtual-agent resources. |
| `rg -n "isolated-bun-runner|headers\\.isolated|oauth-browser\\.isolated|prompt-resource-fail-fast\\.isolated|ripgrep-early-stop\\.isolated|isolated-runner-|tmpdir-git-lifecycle\\.isolated" packages/opencorvus/test` | `runIsolatedBunTest` is a generic harness, not an MCP-specific helper. Mock-heavy isolated leaf suites should be grouped under domain `isolated/` directories while wrappers remain ordinary `.test.ts` files. |
| `git diff --name-status -- packages/opencorvus/test packages/overlay/test packages/opencorvus/src/expert-squad packages/opencorvus/src/mcp packages/opencorvus/src/file packages/opencorvus/src/util packages/opencorvus/src/executor packages/opencorvus/script packages/sdk/js/script specs/records/2026-07` | The current tree already contains broad uncommitted changes across expert-squad, MCP, process lifecycle, overlay browser tests, SDK generation, and docs records; this reorganization must avoid reverting or masking that work. |

### Independent Agent Feedback

No independent sub-agent was used for this request. The user did not explicitly request a new independent-agent review, and the current task is a scoped test-organization repair.

## Current Diagnosis

The current test layout violates the latest architecture in one specific way: a generic isolated Bun test harness lives in `packages/opencorvus/test/mcp/`, even though non-MCP tests import it. That creates a false ownership signal and makes future test authors couple process-isolation behavior to the MCP package.

The correct source boundary is:

- `packages/opencorvus/test/harness/` owns reusable test runners and runner self-tests.
- Domain directories such as `mcp/`, `file/`, `fixture/`, and `expert-squad/` own their wrappers and isolated leaf suites.
- Isolated leaf suites use non-`.test.ts` names under an `isolated/` subdirectory so Bun's default discovery does not run them directly.

## Implementation Plan

1. Move `isolated-bun-runner.ts` and its self-test from `test/mcp/` to `test/harness/`.
2. Move runner fixture programs from the generic fixture root into `test/harness/fixtures/`.
3. Move mock-heavy MCP leaf suites into `test/mcp/isolated/`.
4. Move the ripgrep mock leaf suite into `test/file/isolated/`.
5. Move the tmpdir lifecycle isolated leaf suite into `test/fixture/isolated/`.
6. Update imports and isolated-file paths without changing assertions.
7. Validate the moved harness and all wrapper suites, then run docs tests, typecheck, and `git diff --check`.

## Validation Plan

- `bun test packages/opencorvus/test/harness/isolated-bun-runner.test.ts`
- `bun test packages/opencorvus/test/mcp/headers.test.ts packages/opencorvus/test/mcp/oauth-browser.test.ts packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver-mcp-execution.test.ts`
- `bun test packages/opencorvus/test/file/ripgrep.test.ts`
- `bun test packages/opencorvus/test/fixture/tmpdir-git-lifecycle.test.ts`
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Implementation Summary

- Moved the generic isolated Bun runner from `packages/opencorvus/test/mcp/` to `packages/opencorvus/test/harness/`.
- Moved the runner self-test fixtures from `packages/opencorvus/test/fixture/` to `packages/opencorvus/test/harness/fixtures/`.
- Moved MCP mock-heavy isolated leaf suites into `packages/opencorvus/test/mcp/isolated/`.
- Moved the ripgrep early-stop isolated leaf suite into `packages/opencorvus/test/file/isolated/`.
- Moved the tmpdir git lifecycle isolated leaf suite into `packages/opencorvus/test/fixture/isolated/`.
- Updated expert-squad, server, file, fixture, and MCP wrapper imports to use `packages/opencorvus/test/harness/isolated-bun-runner.ts`.

## Validation Results

Passed:

- `bun test packages/opencorvus/test/harness/isolated-bun-runner.test.ts`: 6 pass, 0 fail.
- `bun test packages/opencorvus/test/file/ripgrep.test.ts packages/opencorvus/test/fixture/tmpdir-git-lifecycle.test.ts`: 9 pass, 0 fail.
- `bun test packages/opencorvus/test/mcp/headers.test.ts packages/opencorvus/test/mcp/oauth-browser.test.ts packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts`: 3 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver-mcp-execution.test.ts`: 4 pass, 0 fail.
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts`: 1 pass, 0 fail, 24 expect calls.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 69 pass, 0 fail.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `git diff --check`: passed.

## Second Review

- The moved harness is now owned by `test/harness`, which matches its cross-domain use by MCP, expert-squad, server, file, and fixture tests.
- Domain-specific isolated leaf suites remain under their feature areas, but no longer sit at the feature root where they look like ordinary manually runnable suites.
- Assertions and expected pass counts were preserved; the change only updates ownership and paths.
- No fallback, compatibility alias, hidden gate, second active source, or weakened timeout behavior was introduced.
