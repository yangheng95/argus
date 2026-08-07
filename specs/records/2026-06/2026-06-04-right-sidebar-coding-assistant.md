# Right Sidebar Coding Assistant

Status: superseded by `specs/records/2026-06/2026-06-10-tui-removal-plan.md`.

This document is retained only as historical context. Its recommendation to avoid embedding OpenTUI in the web right sidebar was superseded first by the 2026-06-04 upstream opencode comparison, and that embedded terminal/TUI direction was later retired by the TUI removal plan. Do not use this note as current right-sidebar implementation guidance.

Date: 2026-06-04

## Decision

Build the coding assistant as a first-class right-panel tab in the Overlay, at the same hierarchy as Explorer, Files, and Inspector. Do not embed OpenTUI's terminal renderer inside the web right sidebar.

The surface should reuse OpenCorvus' existing session database and the canonical session prompt/history/event APIs, but the current event spine must be fixed before the panel depends on it:

- Persist conversation in `session`, `message`, and `part`.
- Use `session.kind = "assistant"` as the durable identity.
- Mark right-sidebar sessions with required namespaced metadata.
- Bind every right-sidebar assistant session to the current project/directory and expose project-scoped task/team capabilities.
- Submit prompts through `POST /session/:sessionID/prompt_async`.
- Hydrate through `GET /session/:sessionID/conversation`.
- Stream through `GET /session/:sessionID/events` only after standalone assistant sessions are mirrored into session protocol events.

## Codex Review Feedback

Independent review results on 2026-06-04 agreed on the direction, but found these required corrections:

- P0: current `GET /session/:sessionID/events` is not proven to stream standalone assistant messages. It subscribes to `ProtocolStore`, while task message bridge drops sessions without a task and the existing session mirror is mission-only. The implementation must generalize the session mirror for `kind="assistant"` before depending on this route.
- P1: `/coding/session/:sessionID/prompt` would create a second prompt entry point. Remove it. Prompt submission stays canonical through `/session/:sessionID/prompt_async`.
- P1: `metadata.surface` cannot be optional. `assistant` also covers MCP, Debug, Panel, and scheduled wake sessions, so right-sidebar sessions need mandatory namespaced metadata.
- P1: do not create and then patch metadata. The initial `session.created` event must already contain the right-sidebar metadata.
- P2: the assistant panel must not call the main conversation tree pipeline (`loadConversation`, `startSSE`, `routeSSEEvent`, `replayTaskEventToTree`, or `cardTreeStore`).
- P2: the spec must include i18n and existing right-panel tests as call points.
- P2: opencode evidence and compatibility risks must be explicit: OpenTUI is compatible as a terminal runtime, but the right sidebar should not depend on its runtime API, PTY lifecycle, or TUI plugin API.

## OpenCode Evidence

Upstream opencode latest investigated on 2026-06-04:

- `opencode-ai` latest stable is `1.15.13`.
- Upstream catalog pins `@opentui/core`, `@opentui/keymap`, and `@opentui/solid` to `0.3.1`, and has a `fix-node-pty` postinstall plus `@lydell/node-pty`.
- TUI source imports OpenTUI renderer/keymap APIs and owns terminal lifecycle, keymap, plugin runtime, and renderer destruction.

| Evidence           | Source                                                                                     | Meaning for OpenCorvus                                             |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| TUI + server split | `https://dev.opencode.ai/docs/server/`                                                     | The terminal TUI is a client over a server/OpenAPI surface.        |
| Terminal attach    | `https://dev.opencode.ai/docs/web/#attaching-a-terminal`                                   | A terminal TUI can attach to a running server and share state.     |
| TUI surface docs   | `https://dev.opencode.ai/docs/tui/`                                                        | TUI-specific UX is terminal oriented.                              |
| Plugin docs        | `https://dev.opencode.ai/docs/plugins/`                                                    | Backend plugins and TUI plugin runtime are distinct concerns.      |
| TUI app source     | `https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/tui/app.tsx` | OpenTUI renderer/keymap/plugin APIs are process/terminal specific. |
| Root catalog       | `https://github.com/anomalyco/opencode/blob/dev/package.json`                              | OpenTUI is pre-1.0 and the repo includes native PTY dependencies.  |

The useful pattern to copy is backend/session/event separation. The wrong pattern is embedding a terminal renderer in a DOM/Solid right panel.

## Local Call Points

| Area                           | Existing source                                                                                                         | Decision                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Right panel top tabs           | `packages/overlay/src/components/RightPanelTabs.tsx`                                                                    | Extend `RightPanelTab` with `assistant`.                                                                               |
| Right panel DOM bodies         | `packages/overlay/src/index.html`                                                                                       | Add `rightPanelAssistant` and `solidRightAssistantMount` beside Explorer/Files/Inspector.                              |
| Right panel activation         | `packages/overlay/src/main.tsx`                                                                                         | Mount the assistant panel and include it in the same `rightPanelTab()` effect.                                         |
| Right panel labels             | `packages/overlay/src/i18n/en-US.json`, `packages/overlay/src/i18n/zh-CN.json`                                          | Add Assistant labels in both locales.                                                                                  |
| Existing right-panel tests     | `packages/overlay/test/acceptance-panel-mount.test.ts`, `file-explorer-editor.test.ts`, `right-panel-tabs-flat.test.ts` | Update structural tab/body assertions.                                                                                 |
| Existing file workbench        | `packages/overlay/src/components/RightFilesPanel.tsx`                                                                   | Leave it as Files-internal Changes/Diff; do not put assistant here.                                                    |
| Main conversation tree         | `packages/overlay/src/services/conversation.ts`, `services/sse.ts`, `services/events.ts`, `store/card-tree.ts`          | Do not use this pipeline for the side assistant.                                                                       |
| Session identity               | `packages/opencorvus/src/session/session.sql.ts`                                                                        | Reuse `assistant`; comments already define it for externally-driven sessions.                                          |
| Session persistence            | `packages/opencorvus/src/storage/ddl.ts` + `session.sql.ts`                                                             | No new tables.                                                                                                         |
| Project/task capability source | `packages/opencorvus/src/panel/capability.ts`, `packages/opencorvus/src/tool/panel.ts`                                  | Reuse `PanelCapabilityRegistry`; do not invent a parallel task/team action schema.                                     |
| Current coding tools           | `packages/opencorvus/src/agent/agent.ts`                                                                                | The default `coding` agent excludes `panel`; the right-sidebar assistant needs an explicit session tool overlay.       |
| Agent team execution           | `packages/opencorvus/src/task-api/index.ts`, `packages/opencorvus/src/engine/store.ts`                                  | Operate agent teams through engine tasks and panel capabilities, not direct orchestrator stage tools.                  |
| Prompt execution               | `packages/opencorvus/src/server/routes/session.ts`                                                                      | Reuse `POST /session/:sessionID/prompt_async`; no `/coding` prompt wrapper.                                            |
| Session stream                 | `packages/opencorvus/src/server/routes/session.ts`, `packages/opencorvus/src/protocol/session-mirror.ts`                | Generalize session mirror before relying on `GET /session/:sessionID/events`.                                          |
| Current coding routes          | `packages/opencorvus/src/server/routes/coding.ts`                                                                       | Keep CLI launcher routes; retire `message/stream` and `session/:id/messages` after canonical session path is verified. |
| Overlay transport              | `packages/overlay/src/services/api.ts`, `services/host-transport.ts`                                                    | Reuse `HostTransport.openStream` / `apiJson`; do not introduce raw `fetch` / raw `EventSource` bypasses.               |

## Database Plan

Use one authoritative persisted object:

```ts
Session.create({
  kind: "assistant",
  title: "Coding assistant",
  metadata: {
    codingAssistant: {
      surface: "right-sidebar",
    },
  },
})
```

`assistant` remains the durable `SessionKind` because it is already the generic externally-driven assistant kind. The right-sidebar surface is not inferred from title, agent name, route, or missing metadata.

`Session.create` / `Session.createNext` must accept optional metadata and persist it atomically in the initial insert. Do not create a session and then call `Session.mergeMetadata` for this marker; the created row and `session.created` event must already include `metadata.codingAssistant.surface`.

`GET /coding/sessions` must query:

- `kind = "assistant"`
- current project/directory scope
- not archived
- `json_extract(session.metadata, '$.codingAssistant.surface') = 'right-sidebar'`

Project binding is mandatory:

- `session.directory` is the canonical project directory binding.
- `session.projectID` is the canonical project identity.
- right-sidebar assistant tools must resolve project scope from the session/Instance context, never from model-supplied parameters.
- task/team queries must be scoped to the current project/directory unless an existing backend API explicitly supports global listing.

Do not add a `coding_session` table, localStorage transcript, frontend-only transcript cache, title-based classifier, or separate project-binding record.

## Server Plan

Keep `/coding/cli/profiles` and `/coding/cli/open` for external terminal launchers.

`/coding` owns only right-sidebar assistant discovery and creation:

- `GET /coding/sessions`
- `POST /coding/session`
- optional `GET /coding/session/:sessionID` claim/validate endpoint

Prompt submission, hydration, task status, and events remain canonical `/session` APIs:

- `GET /session/:sessionID/conversation`
- `POST /session/:sessionID/prompt_async`
- `GET /session/:sessionID/prompt_async/:taskID`
- `GET /session/:sessionID/events`

Retire `/coding/message/stream` and `/coding/session/:sessionID/messages` after tests prove the canonical session path. Do not replace them with a different `/coding` prompt or history path.

## Project and Agent Team Tools

The right-sidebar assistant is a project-bound coding assistant, not a detached chat. It must be able to inspect the current project task state and operate agent teams through existing OpenCorvus control-plane capabilities.

Single source:

- Tool schemas come from `PanelCapabilityRegistry`.
- Execution goes through `PanelTool`.
- Mutations ultimately call `EngineService` / existing engine writers.
- The right-sidebar assistant receives these capabilities through a session-scoped tool overlay, because the default `coding` agent currently excludes `panel`.

The implementation may expose this as the existing `panel` tool, or as a thin `project` / `project_team` facade generated from `PanelCapabilityRegistry`. If a facade is added, it must not duplicate schemas; it must derive allowed actions and JSON schemas from the registry.

Required tool capability set:

| Capability             | Existing action/source             | Kind           | Purpose                                                                           |
| ---------------------- | ---------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| Project task list      | `panel.view_tasks`                 | query          | List recent tasks in the current project.                                         |
| Task board             | `panel.view_board`                 | query          | Inspect one task board, status, acceptance, evaluation, and summary.              |
| Task plan              | `panel.view_plan`                  | query          | Inspect goals/plan for one task.                                                  |
| Structured task query  | `panel.query_task`                 | query          | Batch reconcile task IDs, include children and pending interactions.              |
| Create agent team task | `panel.create_task`                | mutation       | Dispatch a new orchestrator-led task/team for the current project.                |
| Send task follow-up    | `panel.send_task_message`          | mutation       | Steer an existing task/team with an operator message.                             |
| Cancel task/team       | `panel.cancel_task`                | mutation       | Stop active work.                                                                 |
| Retry task/team        | `panel.retry_task`                 | mutation       | Queue a retry for failed or terminal work when operator intent is clear.          |
| Replan task/team       | `panel.replan_task`                | mutation       | Queue a replan through existing task retry/replan semantics.                      |
| Reply interaction      | `panel.reply_interaction`          | mutation       | Answer pending permissions/questions for a task.                                  |
| Reject interaction     | `panel.reject_interaction`         | mutation       | Reject pending permissions/questions for a task.                                  |
| Update checks          | `panel.update_checks`              | mutation       | Adjust verification checks before or during task execution.                       |
| Update goal            | `panel.update_goal`                | mutation       | Edit a goal description/acceptance spec when the operator explicitly requests it. |
| Delete goal            | `panel.delete_goal`                | mutation       | Delete a goal when the operator explicitly requests it.                           |
| Focus task             | `panel.select_task`                | local mutation | Switch the desktop panel to a task.                                               |
| Focus session          | `panel.select_session`             | local mutation | Switch the desktop panel to a session.                                            |
| Set executor           | `panel.set_executor`               | local mutation | Select default executor for new desktop panel tasks.                              |
| Screenshot overlay     | `panel.capture_overlay_screenshot` | query          | Capture current OpenCorvus GUI for visual debugging.                              |

Optional project-bound knowledge tools:

| Capability              | Existing source                       | Kind           | Purpose                                                                              |
| ----------------------- | ------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| Project memories        | `GET /panel/knowledge/memory`         | query          | List memories scoped to current project/session/task.                                |
| Memory search           | `POST /panel/knowledge/memory/search` | query          | Search durable project/task memory.                                                  |
| Active executors/models | `GET/PATCH /executor/*`               | query/mutation | Inspect or set executor model only if exposed through a registry-derived capability. |

Do not expose these directly to the right-sidebar assistant:

- orchestrator stage tools such as `build`, `requirements`, `architect`, `frontend_design`, `integrity`, `fact_check`, `cancel_subagent`, `steer_subagent`, or `restart_from_stage`;
- `mission_state`, because right-sidebar assistant is not a Mission session;
- generic `task` sub-agent dispatch, because agent team work should enter through `EngineService.createTask`;
- raw DB queries or raw engine table mutation;
- direct `/orchestrator/*` route calls bypassing `PanelCapabilityRegistry`.

Provenance:

- Right-sidebar initiated task mutations should set `metadata.actor = "right_sidebar_assistant"` or extend `PanelActor` with `right_sidebar_assistant`; do not let the model supply this field.
- `create_task` should mark `source = "right-sidebar-assistant"` unless a more specific existing source is provided by the server.
- If `PanelActor` is extended, update `derivePanelActor` and tests so the actor is server-derived from session metadata/tool context.

Confirmation policy:

- Irreversible or destructive actions (`delete_goal`, `delete_session` if ever exposed, DB reset, permanent deletion) require existing explicit confirmation mechanisms.
- Normal task/team actions (`create_task`, `send_task_message`, `cancel_task`, `retry_task`, `replan_task`, `reply_interaction`, `reject_interaction`) are allowed tool calls because the right-sidebar assistant is an operator-facing coding assistant. Do not add a new host-side routing gate; rely on tool permissions, visible tool results, and existing interaction/permission flows.

## Event Plan

Before the Overlay panel depends on `/session/:sessionID/events`, generalize the existing session mirror so standalone `kind="assistant"` sessions publish session-scoped protocol events.

Required event coverage:

- `message.updated`
- `message.part.updated`
- `message.part.delta`
- `session.status`
- `session.error`
- `permission.asked`
- `permission.replied`
- `question.asked`
- `question.replied`

The events should be emitted as `aggregate = "session"` with `sessionID` and source `session.bridge` / `session.mirror` naming consistent with existing protocol events.

Do not recreate a raw Bus SSE stream in `/coding`. The fix belongs in the single session event spine.

## Overlay Plan

Add a new component:

- `packages/overlay/src/components/RightAssistantPanel.tsx`

Responsibilities:

- Create or load the right-sidebar assistant session for the current directory.
- Hydrate its transcript from `GET /session/:sessionID/conversation`.
- Subscribe to `GET /session/:sessionID/events` using `HostTransport.openStream`.
- Render user/assistant text, tool calls/results, status, errors, permission requests, and questions.
- Submit text through `POST /session/:sessionID/prompt_async` with `agent: "coding"`.

Preferred UI wiring:

- Add `assistant` to `RightPanelTab`.
- Add an Assistant tab label beside Files/Explorer/Inspector.
- Mount `RightAssistantPanel` in a new tab body beside `rightPanelExplorer`, `rightPanelFiles`, and `rightPanelInspector`.
- Add CSS under `inspector.css` or a new surface stylesheet only if it follows the existing right-panel surface conventions.

Hard constraints:

- `RightAssistantPanel` must not import or call `loadConversation`, `startSSE`, `routeSSEEvent`, `replayTaskEventToTree`, `tree-writer`, or `cardTreeStore`.
- It may reuse display primitives, markdown rendering, buttons, icons, and transport helpers.
- It needs a panel-local session transcript store so it cannot pollute the task workflow conversation.
- Keyboard shortcuts apply only inside the panel/composer focus scope. Enter, Escape, paste/copy, command palette interactions, terminal focus, and CJK IME composition need explicit tests.
- It must render project-bound tool results distinctly enough that task/team operations are visible in the transcript.
- It should offer compact UI affordances for selected tool results: open/focus task, view board, reply to pending interaction, and cancel/retry when the tool result includes the relevant IDs.

## Compatibility With OpenCode TUI

OpenTUI is compatible as a terminal TUI dependency, but it is the wrong primitive for an Overlay right sidebar. Embedding it would require a PTY-like terminal surface inside a web panel and would import terminal-specific lifecycle problems into a DOM panel.

| Risk                                 | Decision                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| OpenTUI pre-1.0 runtime API          | Right sidebar does not depend on OpenTUI APIs.                                                                            |
| Native PTY / ConPTY / WSL lifecycle  | No PTY is created for the right-sidebar assistant.                                                                        |
| Terminal resize, signals, scrollback | Use DOM/Solid panel layout and existing Overlay scroll behavior.                                                          |
| Global terminal keymap               | Use focus-scoped DOM key handling only.                                                                                   |
| OpenCode TUI plugin runtime          | Do not depend on TUI plugin slots/keymap/renderer APIs. Future side-panel extensions need OpenCorvus-owned slots/actions. |
| Backend plugin hooks                 | Continue to consume OpenCorvus session parts/events/permission contracts.                                                 |

OpenCorvus already has the backend split through `Session`, `SessionPrompt`, and protocol events, so the right solution is a native Overlay panel, not a nested terminal TUI.

## Tests

Server:

- `POST /coding/session` creates `kind="assistant"` with `metadata.codingAssistant.surface = "right-sidebar"` in the initial insert and `session.created` event.
- `GET /coding/sessions` returns only active right-sidebar assistant sessions for the current directory.
- untagged assistant, archived assistant, wrong directory, and non-assistant sessions are excluded/rejected.
- `POST /session/:sessionID/prompt_async` accepts the right-sidebar assistant session with `agent: "coding"` and does not create an `engine_task`.
- `GET /session/:sessionID/events` for that assistant session emits message delta, message update, tool result, status, error, permission, and question events.
- `/coding/message/stream` and `/coding/session/:sessionID/messages` are removed or explicitly rejected after the canonical path is verified.
- right-sidebar assistant prompt execution receives the project/team tool overlay and the default `coding` agent outside this surface still excludes `panel`.
- project/team tool calls are scoped to the assistant session project/directory.
- `create_task`, `send_task_message`, `query_task`, `cancel_task`, `retry_task`, `replan_task`, interaction reply/reject, check update, goal update/delete, and local select actions all execute through `PanelCapabilityRegistry` / `PanelTool`.
- model-supplied provenance fields cannot override server-derived actor/source metadata.

Overlay:

- `RightPanelTabs` includes `assistant`; `index.html` declares `rightPanelAssistant`; `main.tsx` toggles all four bodies.
- `en-US.json` and `zh-CN.json` include the Assistant tab label.
- Existing right-panel static tests are updated for the fourth tab/body.
- `RightAssistantPanel` creates/loads one session per directory and does not import `cardTreeStore`, `loadConversation`, `startSSE`, `routeSSEEvent`, or `tree-writer`.
- composer posts to `/session/:sessionID/prompt_async`.
- session events for the selected assistant session update only the assistant transcript.
- Enter, Escape, copy/paste, command palette focus, terminal focus, and CJK IME composition are covered.
- project/team tool result cards include task IDs and expose local focus actions without mutating the main conversation store.

Visual/e2e:

- Right panel opens on Assistant tab at desktop and narrow widths.
- Empty, streaming text, tool-call, tool-result, error, permission, and question states render without overlap.
- Scrolling stays inside the assistant panel and does not move the main conversation.

## Implementation Order

1. Extend session creation metadata atomically and add `/coding` list/create/claim helpers.
2. Add the right-sidebar assistant project/tool overlay using `PanelCapabilityRegistry` / `PanelTool`.
3. Generalize the session mirror and prove `prompt_async + session.events` for standalone assistant sessions.
4. Retire `/coding/message/stream` and `/coding/session/:sessionID/messages` once the canonical path is covered.
5. Add Overlay top-level Assistant tab mount, i18n, and static wiring tests.
6. Build `RightAssistantPanel` with panel-local transcript hydration, streaming, composer, and project/team tool result rendering.
7. Add visual/e2e coverage for the right panel.
