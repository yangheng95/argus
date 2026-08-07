# Wait Park Turn Boundary

Date: 2026-07-02

## Objective

Repair the failure where the model can call `wait` repeatedly in one latest
message even though `wait` did not really wait. The current `wait` tool
correctly schedules a nonblocking cron wake, but the session tool-result loop
still treats that result like ordinary evidence and may continue reading the
same model stream into another `wait` call.

The fix must preserve the nonblocking cron design. Do not turn `wait` back into
an in-process sleep, do not add a polling loop, and do not patch around the
symptom by keyword-counting repeated wait calls.

## Recall

- User request: "修复问题", following the diagnosis that latest messages showed
  repeated `wait` calls without a real wait.
- Acceptance criteria:
  - A scheduled `wait` still creates exactly one cron wake and returns quickly.
  - After a scheduled `wait` tool result, the active session turn parks instead
    of consuming further same-stream model output.
  - Aborted or unscheduled `wait` calls do not park the turn.
  - Existing non-wait tools continue through the normal tool-result loop.
  - Orchestrator no-decision classification continues accepting successful
    scheduled wait as a decision.
- Hard constraints:
  - No fallback, compatibility branch, hidden message, polling gate, state
    machine, or blocking sleep.
  - Do not restart or refresh the running OpenCorvus/overlay process.
  - Do not revert user or pre-existing working tree changes.
  - Add regression tests for any code change.
- Landed sources read:
  - `specs/records/2026-06/2026-06-26-task-cron-nonblocking-wait.md`
  - `specs/records/2026-06/2026-06-26-wait-cron-early-activity-consume.md`
  - `specs/records/2026-06/2026-06-26-wait-tool-twenty-minute-recommendation.md`
  - `specs/records/2026-06/2026-06-26-orchestrator-park-lifecycle-evidence-algorithm.md`
  - `specs/records/2026-06/orchestrator-no-decision-stop-2026-06-18.md`
  - `specs/records/2026-06/task-queue-explicit-wake-no-poll-2026-06-17.md`
  - `specs/records/2026-06/2026-06-25-terminal-refill-no-decision-contract-repair.md`
  - `specs/records/2026-06/2026-06-22-orchestrator-live-build-park-prompt.md`
- Whole-repository search evidence:
  - `rg -n "wait|Wait|CronService|scheduled park|nonblocking|poll|polling|live build|terminal refill|stopWhen|maxSteps|toolChoice" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 -g "*.ts" -g "*.tsx" -g "*.txt" -g "*.md"`
  - `rg -n -C 8 "stopWhen|maxSteps|streamText|for await|toolCallCount|toolChoice|fullStream|finishReason|tool-result|execute" packages/opencorvus/src/session/loop.ts packages/opencorvus/src/session/llm.ts packages/opencorvus/src/tool/tool.ts`
  - `rg -n "orchestratorDecisionEffect|DecisionEffect|withDecisionEffectMetadata|decision signature|ORCHESTRATOR_NO_DECISION|observation|stateful" packages/opencorvus/src/orchestrator packages/opencorvus/test/orchestrator -g "*.ts"`
  - `rg -n "SessionProcessor|process\\(|fullStream|finish-step|tool-result|tool-call|tool-input|partFromToolCall|ensureToolPart|finish" packages/opencorvus/src/session/processor.ts packages/opencorvus/test/session -g "*.ts"`
  - `rg -n "nonblocking|mode|jobID|elapsedMs|orchestratorDecisionEffect|metadata\\.preTerminalReflection|preTerminalReflection" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- Independent agent feedback:
  - No sub-agent was spawned. The current multi-agent tool contract says not to
    spawn sub-agents unless the user explicitly asks for sub-agents,
    delegation, or parallel agent work. The local investigation above is
    therefore the authoritative evidence for this repair.

## Root Cause

`wait` already has the correct external behavior: `executeWait` writes a
one-shot cron row and returns immediately. The missing piece is that this
scheduled park effect is represented only in prose and generic metadata
(`nonblocking: true`). `SessionProcessor` persists the `tool-result`, then the
AI SDK stream may continue with the model's next step. If the model ignores the
prompt text, it can call `wait` again before the scheduled wake ever fires.

This is not a scheduler failure and not a cron failure. The due cron wake and
early-activity consumption paths are already implemented. The bug is a turn
lifecycle contract mismatch: a successful nonblocking wait is a park decision,
but the session processor does not have a typed way to stop consuming the
current stream after that park decision lands.

## Callpoint Inventory

| Surface | Current evidence | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/tool/wait.ts` | `WaitTool` returns metadata with `nonblocking: true`, `aborted`, `jobID`, `mode`, but no explicit session-loop park signal. | Add a typed metadata key for successful scheduled park. Keep the cron behavior and existing metadata. |
| `packages/opencorvus/src/orchestrator/tools.ts` | Orchestrator wrapper preserves wait metadata and adds `orchestratorDecisionEffect`. Successful wait already becomes decision because `cron_job.task_id` changes the task decision signature. | No orchestrator-specific retry or repeated-wait rule. The generic metadata must survive the wrapper. |
| `packages/opencorvus/src/session/processor.ts` | The `tool-result` handler completes the part, then continues reading the stream unless a pre-terminal reflection flag was set. | When a completed tool result carries the park metadata, mark the assistant finish as `tool-calls`, stop reading the current stream, and return `stop` from the processor turn. |
| `packages/opencorvus/src/session/loop.ts` | The outer loop continues when the processor returns `continue`; it breaks on `stop`. | Reuse the existing stop return path. Do not add a new queue, timer, or background poller. |
| `packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts` | Existing processor tests already mock `LLM.stream`, message parts, and same-turn continuation behavior. | Add a regression where a second `wait` after the first wait result is never consumed. |
| `packages/opencorvus/test/orchestrator/wait-tool.test.ts` | Confirms wait schedules cron immediately and marks orchestrator decision effect. | Extend assertions to pin the new park metadata on scheduled waits and absence on aborted waits. |

## Design

1. Add a single exported metadata key for nonblocking park decisions, for
   example `opencorvusParkAfterToolResult`.
2. `WaitTool` sets the key only when `executeWait` actually schedules a wake.
   Aborted wait results keep `aborted: true` and do not park the session turn.
3. `SessionProcessor` checks completed tool-result metadata for that key.
   When present, it:
   - completes the current tool part normally;
   - sets assistant finish to `tool-calls`;
   - breaks the current stream;
   - returns `stop` from `process`.
4. Do not inspect the tool name. The tool that owns park semantics publishes
   the typed metadata. This avoids a keyword rule and keeps the contract on the
   tool result itself.

## Acceptance

- Focused tests pass:
  `bun test packages/opencorvus/test/orchestrator/wait-tool.test.ts packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts`
- Historical docs link test passes after adding this record:
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Manual code review confirms no blocking sleep, polling loop, repeated-wait
  counter, hidden message, or OpenCorvus/overlay process restart was added.
