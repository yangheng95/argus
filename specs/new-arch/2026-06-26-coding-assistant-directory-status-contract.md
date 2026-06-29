# 2026-06-26 Coding Assistant Directory And Status Contract

## Problem

The right-sidebar Coding Assistant should show assistant chats scoped to the
currently selected task/project directory. A live selected assistant session can
also receive `session.status` events shaped like:

```json
{
  "type": "session.status",
  "payload": {
    "sessionID": "ses_...",
    "status": { "type": "streaming" },
    "summary": "[object Object]"
  }
}
```

The overlay then throws `conversation agent live view: message info is missing
channel` because `session.status` is a lifecycle event but still must carry the
same backend-stamped `channel/resolvedRole` metadata as other session-scoped
events.

## Recall

| Source                                                     | Constraint                                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                | No fallback, no duplicate source, inspect disk plans before edits, test changes, visual-check UI changes, do not restart the user's live overlay process. |
| `2026-06-10-right-sidebar-session-bridge-channel-fix.md`   | Missing `channel/resolvedRole` must be fixed in `session-mirror.ts`, not inferred in the frontend.                                                        |
| `2026-06-12-standalone-session-bridge-channel-contract.md` | Plain assistant session streams are valid session-scoped streams and must be enriched before SSE dispatch.                                                |
| `2026-06-16-lifecycle-empty-agent-card-fix.md`             | Lifecycle-only events must not create blank conversation cards; they may update lifecycle/rail state when correctly stamped.                              |
| `2026-06-11-coding-assistant-session-history.md`           | Coding Assistant history uses canonical session routes; `/coding` owns only project-bound discovery/actions.                                              |

## Call Point Inventory

| Surface                                                               | Evidence                                                                                                                                                                          | Repair                                                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/protocol/session-mirror.ts`                  | `message.*` and `session.error` use `stampSessionPayload` / `stampSessionEventPayload`; `session.status` returns raw `props` and stringifies `props.status` to `[object Object]`. | Stamp `session.status` with `sessionEventMeta()` and summarize from `status.type` / `status.reason`.                           |
| `packages/opencorvus/test/protocol/session-mirror.test.ts`            | Covers `message.*` and `session.error`, not `session.status`.                                                                                                                     | Add a right-sidebar assistant status mapping assertion.                                                                        |
| `packages/opencorvus/test/server/session-conversation-routes.test.ts` | Route-level SSE covers message enrichment, not status enrichment.                                                                                                                 | Add a plain assistant `/session/:id/events` status assertion.                                                                  |
| `packages/opencorvus/src/coding-assistant/session.ts`                 | List query accepts optional `directory` and falls back to `Instance.directory`.                                                                                                   | Make listing use `Instance.directory` as the single server-side project scope after middleware resolves the request directory. |
| `packages/opencorvus/src/server/routes/coding.ts`                     | `CodingSessionQuery` includes optional `directory` only for list internals.                                                                                                       | Remove directory from the local list schema; the shared project-route directory policy still owns request scoping.             |
| `packages/overlay/src/services/coding-assistant.ts`                   | `loadCodingAssistantSessions()` builds `coding/sessions?...` without explicit directory and relies on API context injection.                                                      | Require a directory input and place it in the request path so the caller's selected task/project scope is explicit.            |
| `packages/overlay/src/main.tsx`                                       | Initial load, search, retry, and load-more call `loadCodingAssistantSessions()` without scope.                                                                                    | Pass `activeDirectory()` at every list load call.                                                                              |
| Overlay tests                                                         | Existing tests assert the old call text and row-action directory behavior.                                                                                                        | Add/adjust tests so list load sends the directory explicitly.                                                                  |

## Acceptance

- `session.status` from a standalone assistant session carries top-level
  `channel="assistant"` and `resolvedRole="assistant"`.
- The status event summary is readable (`session status: streaming`, terminal
  reason when present), never `[object Object]`.
- Frontend Coding Assistant session listing always includes an explicit
  directory chosen by the caller.
- Opening/searching/retrying/loading more Coding Assistant sessions uses the
  active project directory, which is the selected task owning directory while a
  task is selected.
- No frontend fallback infers missing lifecycle metadata.
- Focused backend, overlay, and isolated browser verification pass.
