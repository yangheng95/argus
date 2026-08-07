## Recall

- User request:
  - `为什么build一直失败，是重构导致的原因吗，怎么系统性修复？`
  - Task under investigation: `tsk_f2fe1ec520011EYp53Xbbj2MSr` for `https://www.tradingview.com/markets/world-economy/`.
- Acceptance criteria:
  - Prove the real root cause of the repeated Build failure with code/log/DB evidence instead of surface status guesses.
  - Repair the single-source code path that causes managed worktrees to miss the `frontend-replica` Build prompt.
  - Add regression coverage so generated project `.gitignore` files and scheduler expert-squad selection cannot silently reintroduce this failure class.
  - Preserve the no-fallback, no-dual-source, no-hidden-gate constraints.
- Hard constraints:
  - Do not patch managed worktrees by copying ignored local files into them.
  - Do not add compatibility or fallback logic around missing prompt files.
  - Do not revert unrelated dirty workspace changes.
  - Any code change must ship with focused tests.
- Sources read before implementation:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/current/architecture/README.md`
  - `specs/current/architecture/10-worktree-lifecycle.md`
  - `specs/current/architecture/18-webpage-replica-agent-workflow.md`
  - `specs/records/2026-07/README.md`
  - `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
  - `specs/records/2026-07/2026-07-04-architecture-issue-subagent-investigation.md`
  - `specs/records/2026-07/2026-07-05-overlay-build-card-sse-teardown-verification.md`
  - `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
  - `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
  - `packages/opencorvus/src/engine/git.ts`
  - `packages/opencorvus/src/orchestrator/agent.ts`
  - `packages/opencorvus/src/orchestrator/tools.ts`
  - `packages/opencorvus/src/orchestrator/stateful-tool-names.ts`
  - `packages/opencorvus/src/project/task-runtime-materializer.ts`
  - `packages/opencorvus/src/worktree/index.ts`
  - `packages/opencorvus/test/engine/git-ignore.test.ts`
  - `packages/opencorvus/test/orchestrator/no-decision-stop-process.test.ts`
  - `packages/opencorvus/test/orchestrator/tools.test.ts`
  - `packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts`
  - `packages/opencorvus/test/script/document-health.test.ts`
- Whole-repository search evidence:
  - `rg -n "PromptProfile|builtIns|prompt_profile|frontend-replica|frontend-innovate|expert-squad|select_expert_squad|mounted Orchestrator expert-squad|skill tool" packages/opencorvus/src packages/opencorvus/test specs`
  - `rg -n "frontend-replica-expert-squad|frontend-innovate-expert-squad|frontend-automation-debug-expert-squad|builtin-skills|required_tools|mounted_agents" packages/opencorvus/src packages/opencorvus/test`
  - `rg -n "requiredBuiltInTargetMatrix|built-in registry pressure|overlay target|prompt-profile" packages/opencorvus/test/agent packages/opencorvus/test/server`
  - `rg -n "gitignoreEssentials|ensureGitignore|build/" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
  - `rg -n "OrchestratorNoDecisionStopError|stopped without calling any tool|decision-contract-failure" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
  - `rg -n "select_expert_squad|ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY|decisionEffect|stateful-tool-names" packages/opencorvus/src/orchestrator packages/opencorvus/test/orchestrator -g "*.ts"`
  - `rg -n "tsk_f2fe1ec520011EYp53Xbbj2MSr|run_f30005b7e001Xt839HSRYhtehZ|gol_f2ff2cd98001IRh95z3EFvVucl|agents\\.build\\.prompt|OrchestratorNoDecisionStopError" C:/Users/chuan/.local/share/opencorvus -g "*"`
- Independent-agent feedback:
  - Read-only reviewer `Hume` (`019f3089-20b7-77a0-8699-dcba44160f2b`) independently confirmed the same two-layer root cause:
    - managed worktree Build fails because demo-project `.gitignore` line 20 (`build/`) hides `.opencorvus/expert-squads/frontend-replica/agents/build/system.md`, while `fd/frontend-template.md` already exists and is not the blocker;
    - the same task records `orchestrator-decision-contract-failure` for prose-only “I made the next workflow decision” wakes, and an earlier wake logged `wake_tools=[skill,select_expert_squad]; effects=[missing,none]`, proving the expert-squad selection decision effect was not classified correctly.
  - The reviewer named the same single-source repair files: `packages/opencorvus/src/engine/git.ts`, `packages/opencorvus/src/orchestrator/tools.ts`, and `packages/opencorvus/src/prompt/core/orchestrator-core.txt`.

## Root Findings

1. The repeated Build failure is deterministic and happens before page implementation:
   - runtime logs record `build_session_error` with `Error: agents.build.prompt: referenced file does not exist`;
   - multiple `build_attempt_outcome` artifacts for goal `gol_f2ff2cd98001IRh95z3EFvVucl` carry the same failure text;
   - the managed worktree lacks `.opencorvus/expert-squads/frontend-replica/agents/build/system.md`.
2. The missing prompt file is not a task-artifact staging failure. It is a Git visibility failure:
   - the main demo project has `.opencorvus/expert-squads/frontend-replica/agents/build/system.md` on disk;
   - `git check-ignore -v` reports that file is ignored by the demo project's generic `build/` rule;
   - because the file is ignored and untracked, the managed worktree created from `HEAD` never receives it.
3. This is a refactor regression caused by single-source drift after the dynamic expert-squad migration:
   - `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md` Phase 19 already documented that repository root `.gitignore` needed explicit unignore rules for `.opencorvus/expert-squads/**/agents/build/**`;
   - the generator in `packages/opencorvus/src/engine/git.ts::gitignoreEssentials()` still emits the stale generic `build/` ignore set without those unignore rules;
   - result: repository root was repaired, but generated project `.gitignore` files stayed stale.
4. A second scheduler regression amplified the failure churn:
   - task artifacts include `orchestrator-decision-contract-failure` where `wake_tools=[skill,select_expert_squad]; effects=[missing,none]`;
   - `select_expert_squad` writes `prompt_profile.active` and schedules a continuation wake, but `decisionEffectForTool()` currently classifies it as `none` because `decisionControlTools` omits it and `taskDecisionSignature()` does not observe the root-session overlay change;
   - this means a valid expert-squad selection wake can be falsely recorded as a no-decision stop.

## Repair Plan

1. Repair the project `.gitignore` single source in `packages/opencorvus/src/engine/git.ts` so generated and upgraded projects preserve `.opencorvus/expert-squads/**/agents/build/**`.
2. Add `ensureGitignore()` regression coverage for existing-project append behavior and fresh-project output so the expert-squad Build prompt path remains Git-visible outside this repository root.
3. Mark `select_expert_squad` as a real orchestrator decision effect and add tests that assert the tool result metadata reports `decision`.
4. Tighten the Orchestrator prompt contract so diagnostic prose cannot be described as a “next workflow decision” unless the same wake actually calls the deciding tool.

## Validation Plan

- `bun test packages/opencorvus/test/engine/git-ignore.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts`
- `bun test packages/opencorvus/test/orchestrator/no-decision-stop-process.test.ts`
- `bun test packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts -t "expert-squad build agent prompts"`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Final Validation Results

- `bun test --timeout 30000 packages/opencorvus/test/engine/git-ignore.test.ts packages/opencorvus/test/orchestrator/no-decision-stop.test.ts packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts` passed: 23 pass, 0 fail.
- `bun test --timeout 30000 packages/opencorvus/test/orchestrator/tools.test.ts -t "select_expert_squad writes only active profile and schedules a visible continuation wake"` passed: 1 pass, 0 fail.
- `bun test --timeout 30000 packages/opencorvus/test/script/document-health.test.ts -t "expert-squad build agent prompts"` passed: 1 pass, 0 fail.
- `bun test --timeout 30000 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 pass, 0 fail.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `git diff --check -- packages/opencorvus/src/engine/git.ts packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/prompt/core/orchestrator-core.txt packages/opencorvus/test/engine/git-ignore.test.ts packages/opencorvus/test/orchestrator/tools.test.ts packages/opencorvus/test/orchestrator/no-decision-stop.test.ts packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts specs/records/2026-07/2026-07-05-build-prompt-worktree-gitignore-single-source-repair.md specs/records/2026-07/README.md` passed with one existing CRLF/LF warning on `packages/opencorvus/test/orchestrator/tools.test.ts` and no diff errors.
