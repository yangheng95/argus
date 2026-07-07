# LLM Activity Retry Attempt Isolation

Date: 2026-07-07

## Objective

Repair the Architect retry failure where a provider-side activity retry reused
the same assistant message after the first attempt had already persisted a
pending `submit_architect` tool part. The retry produced a later successful
`submit_architect`, but the first pending tool part remained open, so
`SessionProcessor` correctly raised `ProcessorLostPartsError`.

## Recall

| Item | Details |
| --- | --- |
| User request | After diagnosing task `tsk_f3c9a5a3c001UUYlmD0yGuJc15`, the user asked how to solve the Architect retry issue and then said "开始改". |
| Acceptance criteria | A same-message provider retry after a partial `tool-input-start` must not leave stale pending/running tool parts; discarded retry-attempt fragments must not reach later model replay; provider retry must not repeat an attempt after tool execution has started; the existing `lost-open-tool-parts` processor check remains strict; focused processor/activity tests and docs-link tests pass. |
| Hard constraints | Follow `AGENTS.md`; no fallback/compatibility logic; no gate that hides the root cause; no keyword matching; no OpenCorvus/overlay restart; no git reset; preserve user/unrelated working tree changes; code edits require regression tests; specs remain under root `specs/`. |
| Runtime evidence | First Architect session `ses_0c360c843ffdrQ8S9cdxELRicn` created pending `submit_architect` part `prt_f3ca5b8470011M426sW6n12qvQ` with empty input, activity retried after idle, a second `submit_architect` part completed with `PASS`, then `SessionProcessor lost open tool parts` aborted the whole Architect stage. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/99-principles.md`; `specs/records/2026-07/2026-07-02-wait-park-turn-boundary.md`; `specs/records/2026-06/2026-06-28-tool-pending-start-time-contract.md`; `specs/records/2026-07/2026-07-06-cache-aware-build-session-retry-repair.md`; `packages/opencorvus/src/llm/activity.ts`; `packages/opencorvus/src/session/processor.ts`; `packages/opencorvus/src/session/message.ts`; `packages/opencorvus/src/session/index.ts`; `packages/opencorvus/test/llm/activity.test.ts`; `packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts`. |
| Whole-repository grep | `rg -n "withLLMActivity\\(|LLMActivityPolicy|LLMActivityRun|SessionProcessor|ProcessorLostPartsError|lost-open-tool-parts|tool-input-start|tool-input-delta|tool-call|tool-result|tool-error|Session\\.removePart|Message\\.toModelMessages" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.md" -g "*.txt"`; `rg -n "toModelMessages|tool_call_id|toolCallId|state\\.status|Message\\.parts|type === \"tool\"" packages/opencorvus/src/session packages/opencorvus/src -g "*.ts"`; `rg -n "deletePart|removePart|part_message_tool_call_idx|updatePart\\(|Session\\.updatePart|DELETE FROM.*part|session_part" packages/opencorvus/src/session packages/opencorvus/src -g "*.ts"`. |
| Independent agent feedback | No sub-agent was spawned. The current Codex multi-agent tool contract only permits spawning when the user explicitly asks for sub-agents/delegation/parallel agents. This plan therefore uses direct DB evidence, source reads, and whole-repository grep as the authoritative review input. |

## Root Cause

`withLLMActivity` owns internal provider retries, but `SessionProcessor` owns
assistant-message materialization. The activity layer currently retries by
calling the same `attemptFn` again inside one `SessionProcessor.process()` call.
That means multiple upstream attempts write into one assistant message.

This violates the persisted message contract. A provider attempt that stalls
after `tool-input-start` has already created provider-visible message state. If
the next attempt succeeds with a different `toolCallId`, the old attempt's
pending part is still open. `SessionProcessor` is correct to fail on that
residue; deleting or weakening the `lost-open-tool-parts` check would only hide
message corruption.

The deeper boundary is side-effect safety. Before a tool actually starts
executing, the partial attempt is discardable stream material. After a
`tool-call`, `tool-result`, or `tool-error`, retrying inside the same assistant
message can duplicate side effects or replay a mixed transcript. Such cases must
surface as a real failed attempt so the caller can make a fresh explicit
decision.

## Callpoint Inventory

| Surface | Current behavior | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/llm/activity.ts::withLLMActivity` | Retries provider attempts internally and exposes only retry status events. It has no message-materialization hook. | Add an optional retry-boundary hook. It runs before the retry status is emitted and before the next attempt starts. If the hook fails, the activity fails with the hook's real cause. |
| `packages/opencorvus/src/session/processor.ts::process` | One processor call persists all activity attempts into one assistant message. | Track per-attempt created part ids and tool side-effect boundary. On safe retry, remove only parts created by that provider attempt and clear processor in-memory maps. On unsafe retry, throw a typed processor error instead of retrying in-place. |
| `processor.ts::tool-input-start`, `text-start`, `reasoning-start`, `start-step`, `finish-step`, patch part writes | These create message parts during streaming. | Register newly-created parts with the current activity attempt so safe retries can discard partial stream fragments. |
| `processor.ts::tool-call`, `tool-result`, `tool-error` | These mark the point where tool execution has begun or ended. | Mark the attempt as non-discardable. Internal provider retry must not continue in the same assistant message after this point. |
| `processor.ts::lost-open-tool-parts` | Fails the message when stream finish leaves pending/running tool parts. | Keep unchanged except for adding the new regression coverage; it remains the final corruption detector. |
| `packages/opencorvus/src/session/message.ts::toModelMessages` | Converts completed/error tool parts back into provider-visible tool output/error content. | Do not encode discarded partial attempts as completed/error tool parts, because that would pollute future model replay. Deleting attempt-created fragments is the correct safe retry behavior. |
| `packages/opencorvus/src/session/index.ts::Session.removePart` | Deletes a specific part by `(sessionID, messageID, partID)` and publishes removal. | Reuse it for safe cleanup; do not add raw SQL deletion or a second part-removal path. |
| `packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts` | Already owns processor stream regressions, duplicate tool-call handling, and lost open tool part tests. | Add attempt-isolation regressions here. |
| `packages/opencorvus/test/llm/activity.test.ts` | Owns retry policy tests. | Add a focused hook-order/fail-fast test if needed by the activity API change. |

## Repair Plan

1. Extend `withLLMActivity` with an optional retry-boundary callback that
   receives the retry event plus the original failed attempt error.
2. In `SessionProcessor`, create a per-activity-attempt write scope:
   - track parts newly created by that attempt;
   - track tool call ids owned by that attempt;
   - mark the attempt unsafe once `tool-call`, `tool-result`, or `tool-error`
     appears.
3. Before an internal retry:
   - if the failed attempt is safe, remove only its newly-created parts using
     `Session.removePart`, clear `toolcalls`, text/reasoning buffers, and delta
     buffers for those ids, then let `withLLMActivity` retry;
   - if the failed attempt crossed the tool-execution boundary, throw an
     explicit processor retry-isolation error so the message is not reused.
4. Add regressions:
   - partial `tool-input-start` followed by idle retry then successful terminal
     tool completes without `ProcessorLostPartsError`, and the abandoned part is
     absent from stored parts/model replay;
   - retry after `tool-call` has been observed fails fast and does not call the
     provider a second time in the same assistant message.
5. Run focused tests, typecheck, docs link verification, and second review.

## Verification Plan

```bash
bun test packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts --test-name-pattern "activity retry"
bun test packages/opencorvus/test/llm/activity.test.ts --test-name-pattern "retry boundary"
bun test packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun run --cwd packages/opencorvus typecheck
git diff --check
```

## Implementation

- Added an optional `withLLMActivity(..., { beforeRetry })` retry-boundary hook.
  The hook runs after retry classification and before the retry status event or
  next provider attempt. If the hook throws, the activity emits one failed
  terminal event and surfaces the hook error as the real cause.
- Added `SessionProcessor.ProcessorUnsafeRetryError` and per-activity-attempt
  write scopes inside `SessionProcessor.process()`.
- Safe retry cleanup now removes only parts created by the failed provider
  attempt, clears matching in-memory tool/text/reasoning buffers, and restores
  the assistant message cost/token/finish/error snapshot from before that
  attempt.
- Once `tool-call`, `tool-result`, or `tool-error` is observed, the attempt is
  non-discardable. A later retryable stream failure no longer reuses the same
  assistant message; the processor records the open tool part as an error and
  stops the turn.
- Existing `lost-open-tool-parts` behavior remains strict and unchanged.

## Validation

- Passed: `bun test packages/opencorvus/test/llm/activity.test.ts --test-name-pattern "retry boundary"`
- Passed: `bun test packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts --test-name-pattern "activity retry"`
- Passed: `bun test packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts --test-name-pattern "does not retry the same assistant"`
- Passed: `bun test packages/opencorvus/test/llm/activity.test.ts`
- Passed: `bun test packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts`
- Passed: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Passed: `bun run --cwd packages/opencorvus typecheck`
- Passed: `git diff --check`

## Review

Manual diff review found no fallback/compatibility branch, no keyword rule, no
weakening of `ProcessorLostPartsError`, and no path that converts an abandoned
partial retry attempt into provider-visible tool error content.
