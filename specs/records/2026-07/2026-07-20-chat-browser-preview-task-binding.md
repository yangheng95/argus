# Chat Browser Preview Task Binding

## Recall

### User request

- Fix the case where Chat starts a local project and reports a URL, but the
  right-side Browser component remains on its empty new-tab surface.
- Screenshot evidence shows `browser_preview` rejected the Chat turn because
  it had no task context; Chat then started the server through a background
  shell and printed `http://127.0.0.1:3000`, leaving no persisted preview target.

### Acceptance criteria

- A right-sidebar Chat that is explicitly bound to a real project task projects
  that task ID into the canonical prompt/tool context.
- A task explicitly created from Chat becomes that Chat session's selected task
  binding. Ordinary Chat creation and greetings still do not create tasks.
- The Chat runtime is told to hand an unbound preview/start request to an
  explicit task instead of substituting a background shell after
  `browser_preview` reports missing task context.
- Session conversation hydration and live `session.updated` events expose the
  same persisted binding to the Overlay.
- The right-side Browser uses the bound task's existing task-scoped backend
  target/evidence routes while Chat remains selected, refreshes when that task
  publishes its target, and opens when the ready target arrives.
- No URL is parsed from assistant prose or shell output. No session-scoped
  preview target, iframe, query override, local URL signal, fallback, or hidden
  task is introduced.
- Focused backend, Overlay, real Node-launched Playwright, screenshot, type,
  document-health, and second-review checks pass.

### Hard constraints

- Preserve the task-scoped `browser_preview_target` EngineArtifact as the only
  URL authority.
- Preserve the 2026-07-14 Chat routing decision: ordinary Chat must not
  implicitly manufacture a task.
- Fix dispatcher context projection and the persisted Chat/task binding instead
  of weakening `browser_preview` or teaching it to infer a target internally.
- Do not restart, refresh, close, or kill the user's running OpenCorvus/Overlay.
  Visual verification must use an isolated HTTP fixture and Playwright launched
  with Node, not Bun.
- Preserve unrelated dirty-worktree edits; do not create another worktree.
- New commits use the `dsw-33987` subject prefix and are pushed to `legacy-remote`.

### Landed sources read before implementation

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-07/2026-07-01-browser-preview-native-webview-root-repair.md`
- `specs/records/2026-07/2026-07-14-chat-default-assistant-routing.md`
- `specs/records/2026-06/2026-06-11-coding-assistant-session-history.md`
- `packages/opencorvus/src/chat/session.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/server/routes/coding.ts`
- `packages/opencorvus/src/tool/browser-preview.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/browser-preview/persist.ts`
- `packages/opencorvus/src/agent/primary-assistant-registry.ts`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/components/BrowserPreviewPanel.tsx`
- `packages/overlay/src/services/coding-assistant.ts`
- `packages/overlay/src/services/conversation.ts`
- `packages/overlay/src/services/events.ts`
- `packages/overlay/src/services/sse.ts`
- `packages/overlay/src/store/board.ts`
- Browser Preview, Coding routes, Panel tool, conversation hydrate, event router,
  and Node browser fixtures under `packages/opencorvus/test/**` and
  `packages/overlay/test/**`.
- The user-supplied screenshot at
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-7360b1f9-0ce1-47e6-838e-f62f65eb2b8b.png`.

### Whole-repository search evidence

The pre-change inventory searched all production, test, and landed design
sources for `browser_preview`, `browser_preview_target`, `selectedTaskID`,
`setRightSidebarChatSelectedTask`, `applyRightSidebarChatPromptOverlay`,
`create_task`, `SessionConversationHydration`, `BrowserPreviewPanel`,
`activeTaskID`, `task.updated`, and the `/coding/session/:sessionID/selection`
route. Historical Git inspection covered the introduction of the Chat selection
metadata and route as well as all Overlay callers.

| Call point                                                             | Evidence                                                                                                                      | Disposition                                                                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `chat/session.ts::applyRightSidebarChatPromptOverlay`                  | Forces Chat identity and surface but does not project persisted `selectedTaskID`; caller-supplied `extra.taskID` can survive. | Accept only a dispatcher-validated task ID and overwrite/remove spoofed task context.                                                    |
| `server/routes/session.ts::applySessionPromptRouteOverlay`             | Loads the authoritative Chat session but drops its selected-task metadata before enqueueing the prompt.                       | Validate the bound task against the same project and directory, then project it into the prompt.                                         |
| `tool/browser-preview.ts`                                              | Correctly rejects missing `ctx.extra.taskID` before starting a process and is the only startup-output URL inference owner.    | Preserve unchanged.                                                                                                                      |
| `tool/panel.ts::create_task`                                           | Explicit Chat task creation persists a real EngineTask but leaves the Chat binding empty.                                     | Persist the created task as the caller Chat's selected task after successful creation.                                                   |
| `agent/primary-assistant-registry.ts`                                  | Chat prompt permits direct coding but does not forbid the observed shell bypass after missing preview context.                | Add natural guidance to create a task for an unbound preview request and never replace preview publication with background shell output. |
| `engine/model.ts::SessionBoardEnvelope` and session conversation route | Session hydrate omits the selected-task projection.                                                                           | Add the optional selected task ID derived from canonical Chat metadata.                                                                  |
| `overlay/store/board.ts` and `main.tsx`                                | Browser Preview and message URL opening read only `activeTaskID()`, which is empty for Chat sessions.                         | Add one derived preview task selector: explicit task selection first, otherwise the selected Chat's persisted binding.                   |
| `overlay/services/events.ts`                                           | `session.updated` only invalidates config; global task events refresh only an actively selected task.                         | Apply the current Chat's binding from the session event and refresh Browser target discovery for the bound task's task event.            |
| `BrowserPreviewPanel.tsx` and browser-preview service                  | Already load only `task/:taskID/browser-preview` and persisted task evidence.                                                 | Reuse unchanged as the single target/evidence consumer.                                                                                  |
| `/coding/session/:sessionID/selection`                                 | Validates project/directory and writes the same metadata, but has no production Overlay caller.                               | Preserve; do not add a second selection API or client-side URL store.                                                                    |

No independent agents were used because the user did not request delegation.

## Causal chain

Observable symptom: Chat reports a reachable localhost URL while the right-side
Browser remains blank.

Direct trigger: `browser_preview` receives no task ID and rejects before it can
persist a `browser_preview_target`; Chat then starts a background shell whose
stdout is not a preview publication channel.

Deep cause: the persisted Chat/task binding protocol exists but is disconnected
at all three consumers. Explicit Chat task creation does not write the binding,
the prompt dispatcher does not project it, and the Overlay Browser reads only
the currently selected task even while a Chat session is the selected source.

Why the previous path did not root-fix it: printing a URL proves only that a
process emitted text. It creates neither the task-scoped EngineArtifact nor the
task update event that Browser Preview discovery consumes, so the right-side
component has no authoritative target to render.

## Implementation plan

1. Make right-sidebar Chat metadata expose one strict selected-task reader.
2. Validate and project that binding at the session prompt dispatcher, removing
   any caller-spoofed task context.
3. Bind explicit Chat `panel.create_task` results back to the caller session and
   add Chat prompt guidance for unbound preview requests.
4. Project the binding through session conversation hydration and live
   `session.updated` events.
5. Derive Browser Preview's task scope from either the explicit task source or
   the selected Chat's persisted binding; use task-list events only as refresh
   notifications for the same backend target route.
6. Add focused regressions and an isolated rendered browser scenario showing a
   Chat conversation whose task-scoped target automatically fills the right
   Browser component.

## Verification plan

- Focused tests for `packages/opencorvus/test/session/prompt-final-input.test.ts`,
  `packages/opencorvus/test/server/coding-routes.test.ts`, and
  `packages/opencorvus/test/tool/panel.test.ts`.
- `bun test --timeout=0 test/coding-assistant-service.test.ts test/events-refresh.test.ts test/browser-preview-panel.test.ts`
  from `packages/overlay`.
- `node test/browser-runner.mjs test/browser/chat-browser-preview-task-binding-browser.test.ts`
  from `packages/overlay`.
- Visual inspection of the task-scoped Browser region screenshot emitted by the
  browser test.
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 120000`
- `git diff --check`
- Exact-diff and whole-repository second review for alternate URL sources,
  unvalidated task IDs, and missed Browser consumers.

## Verification results

- Backend prompt overlay, Panel task binding, prompt queue projection, and
  session hydrate regressions: 5 focused tests passed.
- Overlay session/task event projection, coding-assistant selection, and Browser
  panel regressions: 46 tests passed.
- Real Node browser publication transition (`missing` → `task.updated` →
  `ready`): 1 test passed. The run proved the unbound Chat made no task-preview
  request, then used only
  `/task/tsk_chat_browser_preview/browser-preview` and task evidence routes
  after the persisted binding arrived.
- Visual review passed for
  `packages/overlay/.scratch/chat-browser-preview-binding/chat-bound-task-preview.png`:
  the right Browser was open, its address field showed the task target URL,
  and the persisted evidence image and task-scoped diagnostic were visible.
- OpenCorvus and Overlay TypeScript checks passed.
- Managed OpenAPI and TypeScript SDK artifacts were regenerated from the route
  schema. API route, docs render, document-health, Git diff, hook, and push
  results are recorded by the delivery commit.
