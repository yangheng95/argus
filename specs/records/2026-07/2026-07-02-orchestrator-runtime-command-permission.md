# Orchestrator Runtime Command Permission

Date: 2026-07-02
Status: Planned

## Recall

| Item | Details |
| --- | --- |
| User request | 给调度器完整的 bash/command 权限，用于修复运行期间遇到的问题，但禁止替代执行器执行任务。 |
| Acceptance criteria | Orchestrator keeps the existing single `bash` tool instead of a second command surface; command shape is no longer limited to git or single invocations; pipelines, chaining, redirects, command substitution, newlines, package/test/browser/toolchain commands are valid command payloads; the role prompt explicitly scopes bash to runtime/toolchain repair and forbids using it to produce the task deliverable, author product code, research/write content, or replace `build` / specialist executors; tests cover both the broadened command permission and the executor-boundary prompt contract. |
| Hard constraints | No fallback, no compatibility path, no host-side workflow gate; no new `run_command`; no broad git reset; preserve unrelated dirty worktree changes; inspect landed specs before edits; write focused tests; do not restart or disturb running OpenCorvus / overlay processes; keep specs under `specs/records/2026-07/` and update the July index. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/08-agent-tool-adapter.md`; `specs/current/architecture/14-agent-runtime-mode.md`; `specs/records/2026-06/2026-06-15-user-authorized-mission-orchestrator-bash.md`; `packages/opencorvus/src/orchestrator/tools.ts`; `packages/opencorvus/src/prompt/core/orchestrator-core.txt`; `packages/opencorvus/src/agent/tool-pool-contract.ts`; `packages/opencorvus/src/agent/agent.ts`; `packages/opencorvus/test/orchestrator/bash-tool.test.ts`; `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`. |
| Whole-repository grep | `rg -n "orchestrator.*bash|bash.*orchestrator|Git Merge Repair Bash|Toolchain Readiness|validateOrchestratorBashCommand|ORCHESTRATOR_BASH|git-only merge-state|user-authorized|single-command evidence|runtime repair|executor bypass|替代执行器" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-06 specs/records/2026-07 -g "!**/target*/**" -g "!**/node_modules/**"`. |
| Independent agent feedback | Not spawned. The active Codex multi-agent tool policy only permits sub-agents when the user explicitly asks for sub-agents/delegation/parallel agent work. This request did not, so independent review is replaced by direct source inventory plus focused regression tests. |

## Current Root Cause

The current Orchestrator command contract is internally inconsistent and too
narrow for runtime repair:

1. `AgentToolPool.roleAssignments.orchestrator` exposes global `bash`.
2. `createOrchestratorTools()` implements a custom Orchestrator `bash` tool.
3. `validateOrchestratorBashCommand()` still rejects every non-`git` command
   and rejects shell syntax such as chaining, pipelines, redirects, command
   substitution, and newlines.
4. `packages/opencorvus/test/orchestrator/bash-tool.test.ts` already expects
   non-git commands such as `npm test` and `node --version`, proving the old
   git-only implementation has drifted from the intended command surface.
5. `orchestrator-core.txt` still repeats the old git-only merge repair policy,
   so the model is told not to use the exact command surface the user now wants
   for runtime blockers.

The fix is not to add another command tool or a host-side classifier. The
single command surface remains Orchestrator `bash`; the executable schema
accepts full command text, while the role prompt defines when that power is
allowed.

## Repair Contract

1. Keep `bash` as the single Orchestrator command tool.
2. Make command validation only reject an empty command. Do not gate command
   syntax by git, single invocation, shell metacharacters, or process-killing
   keywords; those restrictions would be the old narrow surface under another
   name.
3. Update the tool description and command schema description to describe
   runtime/toolchain repair power, not user-authorized evidence or git merge
   repair.
4. Replace the `Git Merge Repair Bash` prompt section with a `Runtime Command
   Repair Bash` section:
   - allowed for shell/git/package manager/test runner/browser preview/tool
     readiness and other runtime blockers encountered while orchestrating;
   - not a deliverable producer, code author, content/research path, or
     substitute for `build`, `visual_qa`, `integrity`, `requirements`,
     `architect`, `frontend_research`, `frontend_design`, or `deep_research`;
   - route product/source/code changes through `build` or the responsible
     specialist, except command-side runtime materialization such as dependency
     install or cache/tool repair when that is the blocker.
5. Update `Deadlock Repair Responsibility`, `Toolchain Readiness`, and the
   `Tool Selection` entry so they no longer route all non-git runtime repair
   back to Build by default.

## Validation Plan

- `bun test packages/opencorvus/test/orchestrator/bash-tool.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 30000`
