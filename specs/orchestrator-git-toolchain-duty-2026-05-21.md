# Orchestrator Git Conflict And Toolchain Duty

Date: 2026-05-21
Status: implementation spec

## Request

Give the orchestrator an explicit responsibility to resolve git conflicts and
to check that bash and required tools are available.

## Constraints Recalled

- Rule 6.1: tool-choice and escalation behavior belongs in prompts unless it is
  a data-integrity or irreversible-operation guard.
- Rule 7 / rule 8: no fallback, no parallel behavior source.
- Rule 23: when git, rg, test commands, runners, or other required tools are
  unavailable, fix the toolchain before continuing the task.
- Existing orchestrator bash schema is intentionally git-only and must not be
  widened into a general shell.

## Existing Single Sources

| Surface | Finding | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Owns orchestration policy and already contains `Git Merge Repair Bash`. | Extend this prompt as the single behavior source. |
| `packages/opencorvus/src/orchestrator/tools.ts` | `validateOrchestratorBashCommand` hard-rejects non-`git` commands and the `bash` tool obtains the accepted shell at execution time. | Preserve schema/data-integrity guard; do not add host routing logic. |
| `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts` | Locks prompt size and bash-scope wording. | Add assertions for git-conflict ownership and toolchain readiness. |
| `packages/opencorvus/test/orchestrator/bash-tool.test.ts` | Locks schema-level git-only behavior. | No schema change required. |
| `specs/active-task-hang-repair-2026-05-20.md` | Records prompt-first policy for orchestrator tool choice and closure behavior. | Follow the same prompt-first repair path. |

## Required Behavior

- The orchestrator owns primary project-root git conflict / merge blockers for
  the current task. It must clear or explicitly fail/question them before
  dispatching more specialist work.
- The only direct shell surface for that responsibility remains the existing
  narrow `bash` tool: one project-root `git <subcommand>` invocation for merge
  repair.
- Bash / accepted shell, git, package manager, test runner, browser preview
  tool, or required agent/tool surfaces are task readiness blockers when the
  current task depends on them.
- Missing or broken tools must not be ignored or routed around. The
  orchestrator chooses the smallest responsible lane from evidence: `bash` only
  for project-root git merge repair, `explore` for read-only diagnosis, `build`
  for project script/dependency/tool configuration repair, `question` for
  external credentials or installations, and `fail_task` when the required
  tool cannot be supplied inside the task contract.

## Acceptance

- `orchestrator-core.txt` states git conflict ownership explicitly.
- `orchestrator-core.txt` states toolchain readiness explicitly without
  expanding `bash` beyond git merge repair.
- Prompt hygiene tests cover both responsibilities.
- Existing git-only bash schema tests still pass.
