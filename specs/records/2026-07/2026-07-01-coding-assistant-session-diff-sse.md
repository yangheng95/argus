# Coding Assistant Session Diff SSE Repair

## Recall

- User request: "It seems sending an OpenCorvus Coding Assistant message has no response; try it."
- Original acceptance:
  - Sending a right-sidebar Coding Assistant message must produce a visible assistant reply in the same live chat without reloading or reselecting the session.
  - The canonical `/session/:sessionID/events` Server-Sent Events (SSE) stream must remain open through a normal assistant turn and emit assistant message parts after `/session/:sessionID/prompt_async`.
  - `/session/:sessionID/conversation` and the live SSE stream remain the single canonical sources; do not add frontend polling, hydrate fallback, local transcript fallback, or alternate message routes.
  - A non-message session event must not close the session stream before assistant parts arrive.
  - Tests must cover the broken event sequence, not only schema or static route checks.
  - Visual/UI (User Interface) verification must use a real page/browser path when the changed server is available, without restarting or killing the user's current OpenCorvus/overlay process.
- Hard constraints retained:
  - No fallback or compatibility branch.
  - No default/implicit event passthrough that invents protocol shape for unknown Bus events.
  - No git reset or broad revert.
  - No new worktree.
  - Do not restart, kill, reload, or otherwise disturb the user's running OpenCorvus/overlay process without explicit approval.
  - Every code change needs a focused regression test.
- Disk records read before editing:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/current/architecture/99-principles.md`
  - `specs/records/2026-06/2026-06-04-right-sidebar-coding-assistant.md`
  - `specs/records/2026-06/2026-06-11-coding-assistant-session-history.md`
  - `specs/records/2026-06/2026-06-13-coding-assistant-restore-selection-race.md`
  - `specs/records/2026-06/2026-06-24-active-task-restart-message.md`
  - `specs/records/2026-06/2026-06-26-coding-assistant-directory-status-contract.md`
  - `specs/records/2026-06/2026-06-26-coding-assistant-stop-prompt-state-lifetime.md`
- Whole-repository grep performed before editing:
  - `rg -n "Message\.Event\.(PartUpdated|PartDelta|Updated)|PartUpdated|PartDelta|message\.part\.updated|message\.part\.delta|Bus\.publish|publish\(" packages/opencorvus/src/session packages/opencorvus/src/protocol packages/opencorvus/src/scheduler packages/opencorvus/src/server/routes/session.ts`
  - `rg -n "prompt_async|enqueuePromptAfterPersistingUserMessage|executeSessionWake|SessionPrompt\.loop|SessionPrompt\.prompt|subscribeSessionMirror|applySessionPromptRouteOverlay" packages/opencorvus/src packages/opencorvus/test packages/overlay/src`
  - `rg -n "persistMessage\(|saveMessage\(|updateMessage\(|updatePart\(|insert\(PartTable\)|PartTable" packages/opencorvus/src/session packages/opencorvus/src/scheduler packages/opencorvus/src/server packages/opencorvus/src/agent packages/opencorvus/src/orchestrator packages/opencorvus/test/session packages/opencorvus/test/server packages/opencorvus/test/protocol`
  - `rg -n "Event\.Diff|session\.diff|Diff:|Session\.Event\.Diff|Event = \{" packages/opencorvus/src/session packages/opencorvus/src packages/opencorvus/test`
  - `rg -n "mapSessionBusEvent\(|mirrorSessionBusEvent\(|session\.diff" packages/opencorvus/test packages/opencorvus/src/protocol packages/opencorvus/src/server packages/overlay/src`
- Independent agent feedback: not spawned because the currently exposed multi-agent tool policy says not to spawn sub-agents unless the user explicitly asks for sub-agents/delegation/parallel agent work. Direct live API, browser, SSE, source, and log evidence are used instead.

## Evidence

- Direct API prompt against `http://127.0.0.1:7878` created session `ses_0e3412dabffehiYL0ZOKCviF7x`; `/session/:id/conversation` showed assistant text `OK`, proving provider/runtime reply generation works.
- Real UI prompt in the in-app browser created session `ses_0e33e9636ffeuP9d7YCHsBE36D`; the UI showed only the user bubble, while `/session/:id/conversation` contained assistant text `OK` with persisted text parts.
- Robust SSE sampling opened `/session/:id/events`, waited for `session.connected`, then posted `/session/:id/prompt_async`. The stream emitted:
  - `session.connected`
  - user `message.updated`
  - user `message.part.updated`
  - `session.status` streaming
  - assistant `message.updated`
  - then the stream closed before assistant parts.
- Runtime logs show the precise stream-closing error:
  - `session-mirror` eventType `session.diff`
  - error `session-mirror: session.diff missing envelope orderKey`
  - server logged `session event stream write failed`
- `SessionSummary.summarize` publishes `Session.Event.Diff` during the turn, before the assistant part stream finishes. `mapSessionBusEvent` currently has an implicit default branch that returns arbitrary Bus event types without adding a canonical envelope order key. `mirrorSessionBusEvent` then rejects the mapped event and closes the SSE stream.

## Design

- Treat `session.diff` as an explicit session-scoped event with a session-level order key, matching the overlay event policy where `session.diff` is a known router/tree-writer no-op.
- Treat `config.changed` the same way because it is another session-scoped event with `sessionID` that currently reaches the same implicit default path.
- Remove the implicit default passthrough from `mapSessionBusEvent`. Unsupported Bus events should not be projected into the canonical session protocol unless they have an explicit mapping with ordering semantics.
- Do not modify frontend rendering, optimistic user-message projection, `prompt_async`, or conversation hydration.

## Validation Plan

- Add protocol tests proving:
  - `session.diff` maps to a canonical session event with session order key.
  - `config.changed` maps to a canonical session event with session order key.
  - unsupported session-scoped Bus events are ignored instead of being default-projected.
  - a `session.diff` event arriving before an assistant part does not report a mirror error and does not prevent the later `message.part.updated` event from being mirrored.
- Run:
  - `bun test packages/opencorvus/test/protocol/session-mirror.test.ts`
  - `bun test packages/opencorvus/test/server/session-prompt-async.test.ts`
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- After code is loaded into a server instance, verify with the same inactivity-based SSE sample that assistant text parts arrive after `session.diff`.
- If isolated server/UI verification is not feasible in this turn, explicitly report that the running user server at port `7878` still has old code because rule 39 forbids restarting it without approval.
