# Overlay TUI Tank Battle Usability Case - 2026-06-06

## Corrected Goal

Use "build a Tank Battle game" as a realistic overlay TUI usability case. The test target is the overlay right-side TUI surface, not a standalone game package.

## Existing Call Points

| Path                                                  | Role                                                  | Decision                                                                |
| ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/overlay/src/components/TuiHostPanel.tsx`    | Browser terminal surface backed by `ghostty-web`.     | Keep as the single mounted TUI surface.                                 |
| `packages/overlay/src/services/tui-host.ts`           | Browser client for `/pty` routes.                     | Keep using `/pty`, no new TUI API path.                                 |
| `packages/opencorvus/src/server/routes/pty.ts`        | OpenCode-style Pseudo Terminal route set.             | Keep as the backend transport source.                                   |
| `packages/opencorvus/src/pty/index.ts`                | Creates/list/updates/connects PTY sessions.           | Keep as the server-side session contract.                               |
| `packages/opencorvus/src/tui/host.ts`                 | PTY process host, buffer, cursor, WebSocket attach.   | Keep as the single host/buffer source.                                  |
| `packages/overlay/test/tui-host-panel-visual.test.ts` | Real browser overlay right-TUI visual and input test. | Replace the trivial paste smoke with the Tank Battle usability request. |

## Acceptance

- The overlay right activity opens the TUI panel.
- The terminal is focusable and backed by `ghostty-web`.
- A multi-line Tank Battle development request can be pasted through the real browser terminal.
- The mocked PTY WebSocket receives the full request, proving input leaves the overlay terminal.
- The terminal snapshot persists the request, proving observable UI state retains the case.
- Screenshot and pixel checks still verify a visible, nonblank TUI surface.

## Non-goals

- Do not add a standalone Tank Battle package.
- Do not replace `/pty` with `/tui/host`.
- Do not use a preview iframe, query override, or local signal as the TUI source.

## Verification

- `bun test packages/overlay/test/tui-host-panel-visual.test.ts`
  - Passed 4 tests.
  - The primary browser test now pastes the Tank Battle development request and verifies the request reaches the PTY WebSocket and the persisted terminal snapshot.
- `bun test packages/overlay/test/tui-host-panel.test.ts packages/overlay/test/tui-host-service.test.ts packages/overlay/test/tui-host-terminal.test.ts`
  - Passed 6 tests.
  - Confirms the panel still uses `ghostty-web`, OpenCode-style `/pty` WebSocket attach, resize APIs, and duplicate-size suppression.
