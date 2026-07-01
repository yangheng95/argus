# Task Request Single Source and Requirements Rerun Repair

## Recall

User request:

- Asked why stale detection still exists and why it caused a requirements restart for task `tsk_f1d0130d10011Lo0lb10X0IElG`.
- Then requested: `修复问题`.

Acceptance criteria:

- Do not remove the queue inactivity stale failure path unless evidence shows it restarted requirements. It did not.
- Prevent a completed/started workflow from rerunning `requirements` in the same task because a later visible task-root operator message exposes request constraints that were missing from `engine_task.request`.
- Keep the original user request as the single task request source for downstream requirements and architect prompts. Do not add fallback request merging.
- Preserve the prompt-over-host invariant: fix LLM routing through prompt/tool contracts, not host-side route gates or state-machine bypasses.
- Add focused regression tests for the prompt/tool contract.
- Do not restart or refresh OpenCorvus / overlay processes.
- Do not create a new worktree or use destructive git reset.

Hard constraints:

- No fallback or compatibility lane.
- No workflow gate or host route bypass for teaching the model which tool to use.
- No state-machine workaround.
- Every implementation edit must be backed by tests.
- Specs live only under `specs/`.

On-disk sources read:

- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-06/task-queue-explicit-wake-no-poll-2026-06-17.md`
- `specs/records/2026-06/operator-wake-status-facts-not-scheduler-2026-06-17.md`
- `specs/records/2026-06/2026-06-26-enterprise-a2a-protocol-root-repair.md`
- `specs/records/2026-06/2026-06-23-intent-analysis-dynamic-followup.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/13-agent-communication-matrix.md`

Whole-repository search evidence:

- `rg -n "stale" packages/opencorvus/src packages/opencorvus/test specs/current specs/records`
- `rg -n "requirements.*again|operator message changed scope|If execution has begun|propose_task|stale" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-06 specs/records/2026-07`
- `rg -n "requirements" packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/test/orchestrator packages/opencorvus/test/agent`
- Relevant locations:
  - `packages/opencorvus/src/scheduler/task-queue-service.ts` keeps an inactivity-based stale running queue failure path. Existing June specs say this path must fail visibly and must not auto-retry.
  - `packages/opencorvus/src/task-api/index.ts` wakes active tasks after server restart through `server_restart_active_task_recovered`; the remote task transcript did not contain that lifecycle fact.
  - `packages/opencorvus/src/prompt/core/orchestrator-core.txt` allowed `requirements` rerun after successful requirements when an operator message changed scope, then separately said execution-started fundamental mismatches should use `propose_task`.
  - `packages/opencorvus/src/orchestrator/tools.ts` requirements tool description allowed rerun for operator scope change without first making the execution-started boundary absolute.
  - `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts` pinned the old ambiguous wording.

Independent agent feedback:

- Not used. The current tool policy only allows subagent/thread delegation when the user explicitly asks for it; this request did not authorize independent agents.

Remote task evidence:

- Task request stored on the board was only: `我需要复刻网页：<https://www.tradingview.com/markets/world-stocks/>`.
- The task-root visible user message at `2026-07-01T09:28:04.821Z` contained the full constraints: component-by-component goals, complete mock functionality, no placeholders, reuse TradingView non-code assets, and copying `/root/.local/share/opencorvus/blank-template` first.
- Goal 1 completed at `2026-07-01T10:55:51.663Z`.
- At `2026-07-01T10:56:44.711Z`, Orchestrator described the completed first scaffold goal and a "stale running owner", treated the later full operator message as a material scope change, and called `requirements`.
- At `2026-07-01T11:00:56.837Z`, Orchestrator called `architect` with the new requirements snapshot and changed the graph.
- Transcript search found no `server_restart_active_task_recovered`, no `lifecycleFact`, and no automatic restart message. The direct requirements rerun was the Orchestrator tool decision above.

## Root Cause

The incident had two different "stale" surfaces:

1. Queue stale recovery still exists by design. It converts inactive running queue rows into visible failures and does not auto-retry.
2. The requirements rerun came from an Orchestrator prompt/tool-contract gap. The active workflow had already executed a build goal, but the prompt still had an earlier exception that let "operator message changed scope" justify rerunning `requirements`. Because the stored task request was a shortened URL-only request while the visible root message contained the full original request, the model interpreted the full root message as a later scope change and rewound the requirements stage in place.

The deeper data-flow issue is request single-source violation at task creation time. Downstream agents correctly read `engine_task.request`; that value was already missing load-bearing constraints. The repair here does not add a fallback merger between task request and root-session user messages. It closes the same-task rewind path so this mismatch cannot restart requirements after execution begins; the task must continue through explicit goal repair or create a separate inheriting workflow with `propose_task` if the active contract is fundamentally wrong.

## Implementation Plan

1. Tighten `orchestrator-core.txt` so `requirements` may only be rerun before any execution starts, and execution-started mismatches must use goal repair or `propose_task`.
2. Tighten the `requirements` tool description with the same execution-started boundary.
3. Replace the old hygiene test that pinned the ambiguous exception, and add source assertions for the tool description.
4. Run focused prompt tests and docs link validation.

## Verification Plan

- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts -t "orchestrator prompt does not rerun successful requirements"`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
