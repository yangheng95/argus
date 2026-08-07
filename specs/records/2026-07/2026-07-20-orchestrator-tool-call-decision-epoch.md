# Orchestrator Tool-Call Decision Epoch

## Recall

| Item | Evidence |
| --- | --- |
| User request | Fix the General Orchestrator at the prompt layer first: every scheduler turn must express execution through a real tool call; when no executable in-task action exists, use the nonblocking wait, user-question, or terminal task tool instead of prose. The infrastructure must not silently dispatch, retry, wait, or complete on the model's behalf. |
| Acceptance criteria | A just-returned terminal producer result that changes the current Goal closure starts a new decision epoch. Tool calls from an earlier epoch cannot justify a prose-only stop. The prompt names the real outcomes: dispatch or another scheduler action, one-shot `wait` for a named external event, `question` for missing external input, or `manage_task` terminal action. |
| Hard constraints | Prompt-first repair only. Do not modify `classifyOrchestratorDecisionStop`, queues, leases, wake ownership, refill, or host routing. Do not add a gate, state machine, automatic retry, automatic dispatch, or task-specific cryptocurrency rule. Preserve the existing rule that `wait` is not an internal child/Goal polling primitive. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/03-control.md`; `specs/current/architecture/13-agent-communication-matrix.md`; `packages/opencorvus/src/prompt/core/orchestrator-core.txt`; `packages/opencorvus/src/tool/wait.ts`; `packages/opencorvus/src/orchestrator/agent.ts`; `packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts`; the formal Task-C durable session evidence summarized below. |
| Whole-repository search | `rg -n "ORCHESTRATOR_CORE\|orchestrator-core\\.txt\|classifyOrchestratorDecisionStop\|collectOrchestratorWakeToolNames\|OrchestratorNoDecisionStopError" packages/opencorvus specs/current specs/records/2026-07`; `rg -n "status-only\|plain text\|tool call\|finish\|wait\|complete_task\|fail_task\|decision" packages/opencorvus/src/prompt/core/orchestrator-core.txt packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts`; `rg -n "non.?blocking\|wait\|complete_task\|fail_task\|manage_task\|dispatch_agent" packages/opencorvus/src packages/opencorvus/test specs/current/architecture`. Production prompt loading has one source: `orchestrator/agent.ts` imports `orchestrator-core.txt` and projects it through `withObservableWorkNarrative`. The host stop classifier and its tests remain explicitly out of scope. |
| Independent agent feedback | Independent read-only audit proved that the Architect completed normally and persisted four Goals. The Orchestrator then promised to dispatch Bootstrap but emitted `finish=stop` without a tool part. `collectOrchestratorWakeToolNames()` still contained the earlier Architect dispatch, so the wake-wide classifier regarded the old decision as sufficient. The reviewer recommended a prompt-only rule: a terminal producer result that changes closure invalidates earlier decisions and requires an immediate real scheduling tool call. |

## Root cause and boundary

The defect is not missing Architect output, lost terminal refill, or a broken worker owner. It is a scheduler-model protocol error: the prompt says prose is not a decision, but does not say that a terminal tool result creates a new decision obligation which cannot be discharged by a tool call made before that result existed.

The host's wake-wide decision classifier is deliberately coarse observability. Making it infer semantic closure epochs would move scheduling judgment into a host gate and violate the prompt-over-host boundary. This change therefore strengthens only the common scheduler instruction and its prompt projection regression.

## Design

1. Add one general `Decision Epoch and Tool-Call Exit` contract to `orchestrator-core.txt`.
2. Require every fresh operator input and every just-returned terminal/closure-changing tool result to end in a real action tool call before the model may stop.
3. State explicitly that earlier dispatch, diagnostic, or plan-mutation calls do not satisfy the new epoch.
4. Enumerate the valid no-work outcomes without inventing a new workflow: `wait` only for a named external event, `question` for unresolved external input, and `manage_task` `complete_task`/`fail_task` for terminal evidence.
5. Preserve a nonterminal `dispatch_agent status=running` as the current decision; it must not trigger a second dispatch or a scheduled polling wait.

## Verification

- Prompt regression asserts the epoch boundary, tool-call exit, valid explicit outcomes, and prohibition on host substitution.
- Existing prompt, prompt-hygiene, terminal-task, and stale-recovery tests remain green.
- Document link/health/single-source tests remain green after indexing this record.

## Verification results

- `bun test packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/agent/orchestrator-stale-recovery-prompt.test.ts`: 21 passed, 0 failed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`: 87 passed, 0 failed.
- `bun run typecheck`: 9 package tasks passed.
- `packages/opencorvus/test/orchestrator/terminal-task-completion.test.ts` was also sampled and failed on its pre-existing assertion for the absent source string `projectedCoordinationActionSummary(binding, "recovered persisted integrity attempt")`; this prompt-only change does not touch that source or rewrite the unrelated stale assertion.
