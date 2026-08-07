# Right Dock Embedded Terminal

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Reference the supplied Codex terminal surface, implement a real terminal, and place it in the right side like the other components. |
| Acceptance criteria | The Right Dock catalog exposes Terminal; opening it creates or reconnects project-bound shell sessions; multiple sessions can be created, selected, resized, typed into, streamed, and explicitly closed; the terminal uses the active project directory; keyboard focus and copy/select behavior work; the supplied desktop layout informs density and hierarchy without copying brand assets; a real rendered page and screenshot are reviewed. |
| Hard constraints | Reuse the existing project-scoped Pseudo Terminal (PTY) host and `/pty` lifecycle as the only process source; use one mature terminal renderer rather than a hand-written ANSI parser; no fallback shell, second process runner, temporary iframe, local signal/query preview override, or workflow gate; preserve concurrent dirty work; do not restart the running OpenCorvus/Overlay; Windows Playwright runs through Node; desktop-only scope. |
| Sources read | `AGENTS.md`; Browser control skill; supplied Codex screenshot; `specs/current/architecture/07-panel.md`; right-Dock ownership/header/task-scope records; retired OpenTUI/right-sidebar records; `packages/opencorvus/src/{pty,system-terminal}` and `/server/routes/pty.ts`; Overlay RightDock, API/HostTransport, main mount, styles, i18n, and tests; generated SDK/OpenAPI surfaces. |
| Whole-repository search evidence | `PtyRoutes` is mounted once at `/pty`; `PtyHost` is the only PTY process/buffer owner and already supports multiple sessions, buffered cursor replay, resize, input, exit, and project-instance isolation; no current Overlay terminal renderer or `/pty` caller exists; `TerminalProfile` is the only shell-profile registry; `RightDock.tsx` and `main.tsx` are the only Dock catalog/type/mount owners; PTY lifecycle events are already in Overlay event policy and generated SDK; historical embedded TUI commits used `ghostty-web` but that TUI surface was retired; current stable renderer research favors official `@xterm/xterm` plus `@xterm/addon-fit`, while the ghostty-web demo currently states no Windows server support. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration constraint forbids unsolicited delegation. |

## Root Cause And Design Decision

OpenCorvus already owns a real cross-platform PTY runtime, but it stops at the
server route. The Right Dock has no consumer, terminal emulator, or session UI,
so the product can launch external system terminals but cannot embed one.
Creating another shell runner would duplicate the process source. The repair is
therefore an adapter from the existing PTY lifecycle to one Right Dock panel.

The public PTY creation contract currently accepts a raw command even though the
product already has one authoritative terminal-profile registry. The embedded
Terminal will create sessions by `profileID`; the server resolves command, args,
and environment through `TerminalProfile`. This keeps custom/default shell
selection fail-loud and avoids exposing profile commands or environment values
to the Overlay.

For the output channel, the Overlay must stay on `HostTransport.openStream` so
Basic Authentication and Visual Studio Code webview proxying keep working. The
existing WebSocket-only connect route bypasses that transport. Replace it with
one Server-Sent Events (SSE) output stream plus an input request on the same PTY
session owner; do not keep both WebSocket and SSE public output paths.

## Call-Site Disposition

| Surface | Disposition |
| --- | --- |
| `Pty.CreateInput` / `Pty.create` | Replace raw command/args/env creation with required `profileID`; resolve it through `TerminalProfile`; keep current-project cwd validation. |
| `PtyHost` | Keep process, buffer, cursor, resize, and connection ownership; add only exact-ID input needed by the route adapter. |
| `PtyRoutes` | Keep list/get/update/delete; replace WebSocket `connect` with SSE output; add exact-session input; keep project namespace checks and observable 404/400 behavior. |
| SDK/OpenAPI/docs | Regenerate from the owning routes; do not hand-edit a parallel contract. |
| `services/terminal.ts` | Add the typed Overlay adapter for profiles, PTY lifecycle, stream, input, and resize through `apiJson`/`HostTransport`. |
| `TerminalPanel.tsx` | Own xterm lifecycle, fit/resize, stream handle, session tabs, profile menu, focus, visible loading/error/exit state, and cleanup. |
| `RightDock.tsx` / `main.tsx` | Add `terminal` to the catalog, panel union/order/view map, and Dock body; reuse the existing Dock chrome and active-panel lifecycle. |
| CSS/i18n | Add terminal-only surface rules and bilingual strings; preserve shared Button, menu, header, and Dock primitives. |
| Tests | Replace raw-command PTY tests with profile-bound creation and SSE/input evidence; add Overlay service/component/catalog tests plus real browser interaction and screenshot review. |

## Implementation And Verification Plan

1. Land this Recall and call-site inventory before implementation.
2. Replace the public PTY creation/output contract and add focused backend
   route tests for profile resolution, project isolation, streaming input/output,
   resize, exit, and close.
3. Add official xterm plus fit-addon dependencies and the typed Overlay terminal
   service/component.
4. Register Terminal in the Right Dock and style the desktop-only session bar
   after the supplied Codex hierarchy: compact shell tab, adjacent add action,
   restrained utility actions, and the terminal canvas filling the panel.
5. Regenerate SDK/OpenAPI/API docs and update the current panel architecture.
6. Run focused tests, typecheck, i18n, production build, docs health, and diff
   checks.
7. Start an isolated server/page without touching the running Overlay; open the
   right-side Terminal, type a command, verify output and resizing, inspect a
   task-scoped screenshot, correct visual issues, and repeat.
8. Perform a second code/diff review, commit only this task's files, and push the
   branch to legacy remote.

## Progress

- [x] Repository, history, route, dependency, and UI call sites enumerated.
- [x] Plan committed and pushed (`c79d3d77b`).
- [x] Backend PTY contract implemented and tested, including profile-bound
      creation, exact-session input, SSE output, project isolation, resize,
      deletion, and fast-exit lifecycle ordering.
- [x] Right Dock Terminal implemented and covered by focused catalog,
      lifecycle, renderer, and transport tests.
- [x] Generated SDK, OpenAPI, API docs, lockfile, bilingual strings, and current
      architecture synchronized.
- [ ] Real browser interaction and screenshot visually accepted. The isolated
      OpenCorvus page was opened and the Terminal catalog entry was exercised,
      but the application browser subsequently rejected the local page under
      its URL security policy before a visible connected-terminal screenshot
      could be captured. Alternate browser automation was not used because the
      policy explicitly forbids circumvention.
- [x] Second review, selective implementation commit `414f37a7d`, full
      pre-push hook, and legacy remote push completed.

## Second Review Findings

- Replaced a global expected-close flag with per-connection generations so an
  obsolete stream cannot mark a reconnected session as disconnected.
- Preserved SSE writes queued before process exit so the final output chunk is
  delivered before the exit event.
- Moved exit subscription into PTY creation and kept Created before Exited even
  when a shell terminates before `startPrepared` returns.
- Captured the owning project state in the native exit callback so it never
  re-enters a closed instance-cache lease.
- Removed registry-mirror churn from `bun.lock`; only the two xterm packages and
  Overlay dependency edges remain.

## Verification

| Command | Result |
| --- | --- |
| `bun test packages/opencorvus/test/server/pty-routes.test.ts` | 8 passed, 58 assertions. |
| `bun run --cwd packages/opencorvus typecheck` | Passed. |
| `bun test packages/overlay/test/terminal-panel.test.ts packages/overlay/test/right-dock*.test.ts` | 3 terminal tests passed; the wildcard selected the current Right Dock suite without failures. |
| `bun run --cwd packages/overlay typecheck` | Passed. |
| `bun run overlay:i18n-check` | Passed at panel revision `7982c6595ee10f16`. |
| `bun run --cwd packages/overlay build:vite` | Passed, 2,452 modules transformed. The existing large-chunk warning remains informational. |
| `bun run api:routes-check` | Passed across 30 route files. |
| `bun run docs:check` | Passed with 255 operations in 24 groups. |
| `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` | 20 passed after correcting retired expert-squad artifact paths and generated-payload link-scan ownership. |
| `bun test packages/opencorvus/test/expert-squad/{payload-generation,opentest-source-skills-parity}.test.ts` | 8 passed; payload/source parity and materialization verified. |
| `git diff --check` | Passed. |
