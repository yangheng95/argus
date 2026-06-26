# Coding Assistant Stop Prompt State Lifetime

Date: 2026-06-26
Status: implemented and verified

## Problem

Stopping a right-sidebar Coding Assistant chat can surface:

```text
source: coding-assistant.stop
HTTP 409 /coding/session/:sessionID/abort
TaskCancellationIncompleteError
Cancellation did not complete for SessionPrompt.cancel:
no live prompt state matched session directory
```

The visible error is emitted by the right-sidebar stop action, but the backend
cause is deeper: `SessionStatus` is process-global while `SessionPromptState`
is stored under `Instance.state` / `State.create`. When an `Instance` is
disposed or reset, `State.dispose(directory)` removes the prompt-state entry
without aborting or preserving the live handle. The prompt loop can still have
set `SessionStatus` to `streaming`, so a later explicit stop sees
`streaming` but cannot find the directory-matched prompt state it must cancel.

That is not a frontend delete problem and must not be handled by swallowing
409s in the overlay. The root ownership state must stay addressable until the
prompt loop finishes or an explicit cancellation reaches it.

## Recall

| Source | Constraint |
| --- | --- |
| `AGENTS.md` | No fallback, no masking errors, inspect disk plans before edits, tests required for behavior changes. |
| `2026-06-23-task-stop-agent-settle-validation.md` | Ordinary stop success must wait for prompt state settlement; terminal `SessionStatus` is not proof. |
| `2026-06-22-delete-active-task-record-context.md` | User/operator cancellation must remain fail-loud when a live session has no matching prompt state. |
| `2026-06-26-coding-assistant-directory-status-contract.md` | Coding Assistant uses canonical session routes and must carry the selected project directory explicitly. |
| `session/prompt/state.ts` comment | `Instance.dispose()` must not abort running sessions merely because configuration or overlay context is refreshed. |

## Call Point Inventory

Command sweep before this plan:

```powershell
rg -n "coding-assistant\\.stop|TaskCancellationIncompleteError|SessionPrompt\\.cancel|awaitSessionPromptFinishedInScope|/abort" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test packages/sdk/js/src
rg -n "SessionPromptState\\.start|SessionPrompt\\.loop|enqueuePromptAfterPersistingUserMessage|prompt_async" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test
rg -n "SessionStatus\\.set|SessionStatus\\.get|State\\.dispose|Instance\\.dispose|lazyInstanceState" packages/opencorvus/src packages/opencorvus/test
```

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/session/prompt/state.ts` | Prompt states are per-directory `State` entries with no disposer. `State.dispose(directory)` can remove them while `SessionStatus` remains process-global. | Replace prompt state storage with one process-local map keyed by resolved directory. Do not attach it to `Instance.state`. |
| `packages/opencorvus/src/session/loop.ts` | Loop starts/resumes/finishes prompt state with `session.directory`. | Keep call shape. The state module continues to require the same directory key. |
| `packages/opencorvus/src/engine/cancellation-scope.ts` | `cancelSessionPromptInScope` correctly rejects `streaming` without matched prompt state. | Preserve fail-loud invariant; the fix is preventing state loss, not weakening cancellation proof. |
| `packages/opencorvus/src/server/routes/coding.ts` | Coding abort validates the right-sidebar session and calls the shared cancellation scope. | Keep route semantics and 409 on genuine missing live owner. |
| `packages/overlay/src/services/coding-assistant.ts` / `main.tsx` | Frontend already sends row/session directory explicitly. | No frontend 409 suppression. |
| Existing tests | `extra-tools.test.ts`, `coding-routes.test.ts`, and `session-prompt-async.test.ts` pin fail-loud behavior for manually inconsistent `streaming` status. | Keep or adjust only where the new lifetime invariant changes observable state. Add survival regression. |

## Fix Plan

1. Make `SessionPromptState` own a process-local `Map<directory, PromptState>`
   rather than `lazyInstanceState` / `State.create`.
2. Normalize every directory key through the same filesystem resolver used by
   `Instance.provide`; when no explicit directory is passed, use the active
   `Instance.directory`.
3. Keep the current explicit cancellation contract:
   `SessionPrompt.cancel(sessionID, directory)` returns `false` when no matching
   live prompt state exists, and `cancelSessionPromptInScope` still converts a
   non-idle/non-terminal status into `TaskCancellationIncompleteError`.
4. Delete empty prompt-state buckets when the last session finishes so the
   process map does not grow without bound.
5. Add a regression proving a prompt state survives `Instance.disposeAll()` and
   can still be cancelled with the session directory.
6. Add or extend a right-sidebar route regression so `/coding/session/:id/abort`
   cancels a live prompt state after an `Instance` disposal/re-provide cycle
   instead of returning 409.

## Acceptance

- Prompt state for a live session is not destroyed by `Instance.dispose()` or
  `Instance.disposeAll()`.
- Right-sidebar Coding Assistant stop reaches the live prompt state by
  `session.directory` after an instance disposal/re-provide cycle.
- Existing fail-loud semantics remain: if `SessionStatus` is `streaming` and no
  directory-matched prompt state exists, cancellation still returns
  `TaskCancellationIncompleteError`.
- No frontend catch/ignore of the 409 is introduced.
- No fallback directory, route bypass, duplicate status source, or compatibility
  branch is introduced.

## Verification Plan

```powershell
bun test packages/opencorvus/test/session/prompt-state-terminal.test.ts packages/opencorvus/test/session/extra-tools.test.ts --timeout 30000
bun test packages/opencorvus/test/server/coding-routes.test.ts --timeout 60000
bun test packages/opencorvus/test/server/session-prompt-async.test.ts --timeout 60000
bun run --cwd packages/opencorvus typecheck
```

After tests pass, self-review the diff to verify cancellation proof was not
weakened and the overlay still reports real backend failures.

## Verification Result

Executed on 2026-06-26:

```powershell
bun test packages/opencorvus/test/session/prompt-state-terminal.test.ts packages/opencorvus/test/session/extra-tools.test.ts --timeout 30000
bun test packages/opencorvus/test/server/coding-routes.test.ts --timeout 60000
bun test packages/opencorvus/test/server/session-prompt-async.test.ts --timeout 60000
bun run --cwd packages/opencorvus typecheck
```

All commands passed. Self-review confirmed the route still returns
`TaskCancellationIncompleteError` when `SessionStatus` claims a live prompt but
no directory-matched prompt state exists; the fix keeps the live prompt state
reachable across instance disposal instead of masking that error.
