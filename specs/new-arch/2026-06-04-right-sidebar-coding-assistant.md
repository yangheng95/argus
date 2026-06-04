# Right Sidebar Coding Assistant

Date: 2026-06-04

## Decision

Build the coding assistant as a first-class right-panel tab in the Overlay, at the same hierarchy as Explorer, Files, and Inspector. Do not embed OpenTUI's terminal renderer inside the web right sidebar.

The surface should reuse OpenCorvus' existing session database and streaming event spine:

- Persist conversation in `session`, `message`, and `part`.
- Use `session.kind = "assistant"` as the identity.
- Use `SessionPrompt.prompt` through the existing async session prompt route.
- Render session events from `GET /session/:sessionID/events`.

## Evidence

Upstream opencode latest investigated on 2026-06-04:

- `opencode` package version is `1.15.13`.
- TUI is implemented with OpenTUI and Solid under `packages/opencode/src/cli/cmd/tui`.
- OpenTUI packages are runtime dependencies (`@opentui/core`, `@opentui/keymap`, `@opentui/solid`).
- The CLI docs expose `attach` / `run --attach`, which confirms the useful split: agent/session backend is separate from the TUI client.

Local OpenCorvus call points:

| Area | Existing source | Decision |
| --- | --- | --- |
| Right panel top tabs | `packages/overlay/src/components/RightPanelTabs.tsx` | Extend `RightPanelTab` with `assistant`. |
| Right panel DOM bodies | `packages/overlay/src/index.html` | Add `rightPanelAssistant` and `solidRightAssistantMount` beside Explorer/Files/Inspector. |
| Right panel activation | `packages/overlay/src/main.tsx` | Mount the assistant panel and include it in the same `rightPanelTab()` effect. |
| Existing file workbench | `packages/overlay/src/components/RightFilesPanel.tsx` | Leave it as Files-internal Changes/Diff; do not put assistant here. |
| Session identity | `packages/opencorvus/src/session/session.sql.ts` | Reuse `assistant`; comments already define it for externally-driven Coding/Panel sessions. |
| Session persistence | `packages/opencorvus/src/storage/ddl.ts` + `session.sql.ts` | No new tables. |
| Prompt execution | `packages/opencorvus/src/server/routes/session.ts` | Reuse `POST /session/:sessionID/prompt_async`. |
| Session stream | `packages/opencorvus/src/server/routes/session.ts` | Reuse `GET /session/:sessionID/events`. |
| Current coding routes | `packages/opencorvus/src/server/routes/coding.ts` | Keep CLI launcher routes; replace/retire `message/stream` for side assistant because it is a parallel POST-SSE path. |
| Overlay transport | `packages/overlay/src/services/api.ts`, `services/sse.ts`, `services/task.ts` | Reuse `HostTransport.openStream` / `apiJson`; do not introduce native `fetch` / raw `EventSource` bypasses. |

## Database Plan

Use one authoritative persisted object:

```ts
Session.create({
  kind: "assistant",
  title: "Coding assistant",
})
```

Add session metadata only if the right panel needs to distinguish its own assistant sessions from other generic assistant sessions:

```ts
metadata: {
  surface: "right-sidebar-assistant"
}
```

`Session.create` currently does not accept metadata, so implementation should either:

1. create the session, then call `Session.mergeMetadata({ sessionID, patch })`, or
2. extend `Session.create` / `createNext` to accept metadata and update all call sites intentionally.

Option 1 is smaller and does not change the session creation contract. It is the recommended first implementation.

Do not add a `coding_session` table, localStorage transcript, or separate message store. The assistant transcript is the existing session transcript.

## Server Plan

Keep `/coding/cli/profiles` and `/coding/cli/open` for external terminal launchers.

For the side assistant, add canonical coding session helpers that wrap session APIs instead of creating a new stream protocol:

- `GET /coding/sessions`: list unarchived `kind="assistant"` sessions for the active directory, filtered by `metadata.surface === "right-sidebar-assistant"` when that marker is present.
- `POST /coding/session`: create a right-sidebar assistant session and tag metadata.
- `POST /coding/session/:sessionID/prompt`: validate that the session is `kind="assistant"`, then delegate to `TaskQueueService.enqueuePrompt` with `agent: "coding"`.

The existing `/coding/message/stream` should not be used by the new panel. Once the panel is implemented and tests prove the session stream path, retire `/coding/message/stream` rather than keeping two live prompt/stream paths for the same surface.

## Overlay Plan

Add a new component:

- `packages/overlay/src/components/RightAssistantPanel.tsx`

Responsibilities:

- Create or load the right-sidebar assistant session for the current directory.
- Hydrate its transcript from `/session/:sessionID/conversation` or `/coding/session/:sessionID/messages`.
- Subscribe to `session/:sessionID/events` using the existing transport.
- Render user/assistant text, tool calls/results, errors, and permission/question interactions.
- Submit text through the session async prompt path with `agent: "coding"`.

Preferred UI wiring:

- Add `assistant` to `RightPanelTab`.
- Add an Assistant tab label beside Files/Explorer/Inspector.
- Mount `RightAssistantPanel` in a new tab body beside `rightPanelExplorer`, `rightPanelFiles`, and `rightPanelInspector`.
- Add CSS under `inspector.css` or a new surface stylesheet only if it follows the existing right-panel surface conventions.

Do not reuse the main task `cardTreeStore` as the assistant panel's source of truth. The assistant can reuse rendering primitives, but it needs a session-scoped transcript store so it cannot pollute the task workflow conversation.

## Compatibility With OpenCode TUI

OpenTUI is compatible as a terminal TUI dependency, but it is the wrong primitive for an Overlay right sidebar. Embedding it would require a PTY-like terminal surface inside a web panel, adding keyboard focus, rendering, and scroll semantics that conflict with the existing Solid Overlay.

The part worth copying from opencode is the architecture split:

- backend owns session, tools, model config, and events;
- UI is a client over that backend.

OpenCorvus already has that split through `Session`, `SessionPrompt`, and `session.events`, so the right solution is a native Overlay panel, not a nested terminal TUI.

## Tests

Server:

- `POST /coding/session` creates `kind="assistant"` and writes the right-sidebar surface metadata.
- `GET /coding/sessions` returns only active right-sidebar assistant sessions for the directory.
- prompt route delegates to the coding agent and does not create an `engine_task`.
- route rejects non-assistant sessions.

Overlay:

- `RightPanelTabs` includes `assistant`; `index.html` declares `rightPanelAssistant`; `main.tsx` toggles all four bodies.
- `RightAssistantPanel` creates/loads one session per directory and does not mutate `cardTreeStore`.
- composer posts to the assistant session route.
- SSE events for the selected assistant session update only the assistant transcript.

Visual/e2e:

- Right panel opens on Assistant tab at desktop and narrow widths.
- Empty, streaming text, tool-call, tool-result, error, and permission states render without overlap.

## Implementation Order

1. Add server helpers around existing session APIs and tests.
2. Add Overlay top-level Assistant tab mount and static wiring tests.
3. Build `RightAssistantPanel` with transcript hydration, streaming, and composer.
4. Add visual/e2e coverage for the right panel.
5. Retire `/coding/message/stream` after the new path is verified.
