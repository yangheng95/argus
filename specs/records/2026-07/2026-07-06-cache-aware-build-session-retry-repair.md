# Cache-Aware Build Session Retry Repair

Date: 2026-07-06
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | Investigate why TradingView frontend-replica G5 reported passed after retrying, why retries used fresh context, and implement the correction. The user rejected the premise that continuing the same session requires constructing synthetic replay messages, and pointed out that provider-side cache makes appending a real message to the original session the preferred path. |
| Acceptance criteria | Build goal retry must prefer appending a real retry message to the prior Build session when that session is structurally valid; raw transcript size or locally estimated replay pressure must not force a fresh session; fresh session remains valid only for concrete non-resumable evidence such as missing session rows, missing external provider resume refs, prior assistant context/prompt-budget failure, failed/pending compaction markers, or repeated actual continuation failure; no synthetic/hidden retry messages; no fallback/session dual-source; tests must prove high raw replay pressure still reuses the prior session. |
| Hard constraints | Follow `AGENTS.md`; no fallback or compatibility path; no gate/state-machine workaround; no blind patch; no git reset; do not restart OpenCorvus/overlay processes; specs live under root `specs/`; implementation must update focused tests and docs index; keep task requirements durable through context compression. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-03-build-session-replay-pressure-repair.md`; `packages/opencorvus/src/orchestrator/tools.ts`; `packages/opencorvus/src/build/agent.ts`; `packages/opencorvus/src/build/session-replay-pressure.ts`; `packages/opencorvus/src/config/config.ts`; `packages/opencorvus/test/orchestrator/tools.test.ts`; `packages/opencorvus/test/build-agent/session-replay-pressure.test.ts`; `packages/opencorvus/test/build-agent/contract-error.test.ts`. |
| Whole-repository grep | `rg -n "BuildSessionReplayPressure\|retry_replay_token_limit\|createMissingTerminalReplayPressureError\|prior_session_replay_pressure\|goal build retry opens a fresh session\|goal build retry reuses" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07 specs/README.md` found all code and test call sites for the old replay-pressure path. |
| Runtime evidence | Task `tsk_f35383534001EfPelzeSfvvgNv`, G5 `gol_f3557d8cd005Cz0Ps7yZXIMs9B`: run `0f79b033` failed content contract, then `c517ef88` was cancelled, then `26969155` completed. Decision logs forced fresh with `prior_session_replay_pressure` estimates `63716` and `51975` against limit `32000`, while provider usage rows showed large cache reads: first session `cache_read=1593344`, second `cache_read=441344`, completed retry `cache_read=5150208`. The old local estimate ignored provider cache and misclassified resumable sessions as non-resumable. |
| Independent agent feedback | None in this turn. The current repair is based on direct DB, code, spec, and grep evidence. |

## Root Cause

The 2026-07-03 replay-pressure repair assumed a retry must locally replay the
whole prior Build transcript and therefore treated raw persisted tool-output
volume as a context-unavailable condition. That assumption is wrong for the
provider session continuation path used by Build retry: `existingSessionID`
continues the original session by appending a real new message, and provider
cache evidence from G5 shows the previously sent prefix is cached.

The defect is not that G5 retried after a failed run. The defect is that the
retry selector converted a structurally valid, provider-cached session into a
fresh session solely from a local replay-pressure estimate. That discarded
useful session cache and violated the user's requirement to retry from original
context as much as possible.

## Repair Plan

1. Remove `BuildSessionReplayPressure` from Build retry session selection.
   A large raw transcript is diagnostic information, not a fresh-session
   decision source.
2. Remove the missing-terminal recovery shortcut that throws a replay-pressure
   contract error before attempting same-session continuation.
3. Remove the now-dead `agent.build.retry_replay_token_limit` config field and
   its tests. Keeping it would preserve a second source for retry resumability.
4. Keep existing concrete non-resumable checks: missing prior session, missing
   external native resume ref, assistant context/prompt-budget errors, failed
   compaction marker, and pending compaction marker.
5. Replace the high-pressure fresh-session regression with a regression that
   seeds high raw usage and verifies the prior Build session is still reused.
6. Run focused Build retry, contract-error, config, and docs-link tests, then
   inspect the diff for dead code or remaining `prior_session_replay_pressure`
   references.

## Non-Goals

- Do not introduce a model-facing `freshContext` flag.
- Do not add a new retry state machine, gate, fallback, or synthetic message.
- Do not alter task-specific frontend-replica evidence flow.
- Do not remove the existing fresh-session behavior for real context overflow,
  prompt budget overflow, missing provider resume refs, or compaction failure.

## Validation Plan

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "goal build retry (reuses the prior build session by default|reuses the prior build session despite high raw replay pressure|opens a fresh session on the same worktree after prior context overflow)"`
- `bun test packages/opencorvus/test/build-agent/contract-error.test.ts`
- `bun test packages/opencorvus/test/config/config.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

## Implementation

- Removed `BuildSessionReplayPressure` from Build retry session selection.
- Removed the missing-terminal replay-pressure short-circuit so same-session
  finalizer continuation is still attempted unless the provider reports a real
  context failure.
- Deleted the replay-pressure implementation module and its unit test.
- Rejected the retired `config.agent.build.retry_replay_token_limit` key at
  config validation time so it cannot survive as an agent option.
- Replaced the old high-pressure fresh-session orchestrator test with a
  high-raw-usage same-session reuse regression.

## Validation

- Passed: `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "goal build retry (reuses the prior build session by default|reuses the prior build session despite high raw replay pressure|opens a fresh session on the same worktree after prior context overflow)"`
- Passed: `bun test packages/opencorvus/test/config/config.test.ts --test-name-pattern "rejects obsolete build retry replay token limit config"`
- Passed: `bun test packages/opencorvus/test/build-agent/contract-error.test.ts --test-name-pattern "persists a build-scoped same-session finalizer continuation"`
- Passed: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Passed: `bun run --cwd packages/opencorvus typecheck`
- Scan passed for running code: `rg -n "BuildSessionReplayPressure|retry_replay_token_limit|createMissingTerminalReplayPressureError|prior_session_replay_pressure" packages/opencorvus/src packages/opencorvus/test` returned only the explicit config rejection test/code and the orchestrator negative assertion.
- Known unrelated timeout: full `packages/opencorvus/test/config/config.test.ts` reported two 5-second per-test timeouts in pre-existing slow config/plugin tests. Full `packages/opencorvus/test/build-agent/contract-error.test.ts` reported one 5-second timeout in the same continuation test that passed when run alone.
