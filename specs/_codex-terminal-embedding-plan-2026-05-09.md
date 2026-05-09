# Reliable Embedded Terminal Plan

Date: 2026-05-09
Status: proposed

## Goal

Embed a mature terminal inside the Overlay with one production terminal
contract shared by every host: Tauri desktop, browser overlay, and VS Code
webview. The terminal must run a real pseudo-terminal, render with a mature
terminal emulator, support resize/input/output/kill reliably, and avoid any
fallback or host-specific duplicate logic.

## Existing Project Facts

- `packages/opencorvus/src/pty/index.ts` already owns pseudo-terminal session
  lifecycle through `bun-pty`.
- `packages/opencorvus/src/server/routes/pty.ts` already exposes:
  - `GET /pty`
  - `POST /pty`
  - `GET /pty/:ptyID`
  - `PUT /pty/:ptyID`
  - `DELETE /pty/:ptyID`
  - `GET /pty/:ptyID/connect` as a WebSocket.
- `packages/opencorvus/src/server/routes/app.ts` already mounts `PtyRoutes`
  under project-scoped routes, so terminal sessions inherit the explicit
  `directory` instance context.
- `packages/overlay/src/services/host-transport.ts` is the existing single
  cross-host abstraction for HTTP, server-sent events, and native commands.
  It does not yet model WebSocket streams.
- `packages/overlay/src/services/api.ts` already centralizes URL, auth, and
  directory injection for HTTP-shaped calls. Terminal WebSocket URL creation
  must be added there or in a sibling terminal client helper, not copied at
  call sites.
- `packages/overlay/package.json` does not currently include xterm packages.

## Non-Goals

- Do not implement a terminal with `child_process.spawn` or Tauri shell plugin
  output. That is command execution, not a terminal.
- Do not introduce a second PTY service in Tauri, VS Code extension, or the
  Overlay.
- Do not support silent shell discovery fallback. A terminal profile must be
  explicit and validated.
- Do not store unbounded terminal output in Solid state, localStorage, or the
  task transcript.
- Do not expose hidden model-only or UI-only terminal messages. Terminal
  output is visible terminal data, not conversation content.

## Architecture Decision

Use the existing server-side PTY as the only process owner and harden it into
the official terminal service.

Frontend rendering uses `@xterm/xterm` with `@xterm/addon-fit`. The Overlay
owns only presentation and input/output wiring; it never spawns shells.

The server owns:

- terminal profile validation
- PTY spawn
- input writes
- resize
- scrollback ring buffer
- session exit and kill
- project `cwd` enforcement
- WebSocket protocol

The Overlay owns:

- terminal panel surface
- xterm instance lifecycle
- fit/resize observer
- input forwarding
- reconnect with explicit cursor
- visible session list and close controls

## Dependency Choices

### Frontend

- Add `@xterm/xterm`.
- Add `@xterm/addon-fit`.
- Add `@xterm/addon-web-links` only if clickable links are part of the first
  UI acceptance criteria.
- Do not add WebGL renderer in the first pass. Canvas or DOM renderer should
  be accepted first; WebGL is a later measured optimization.

### Backend

- Keep `bun-pty` initially because it already exists in the project and is
  wired into `Pty`. Replacing it before proving a failing acceptance case would
  be churn.
- If `bun-pty` cannot satisfy Windows resize/input/exit behavior, replace it
  in one atomic change with a single alternative PTY implementation. Do not
  keep both behind compatibility flags.

## Contract

### Create Session

`POST /pty`

Request:

```json
{
  "profileID": "default",
  "cwd": "C:/Users/chuan/myhexin-local/opecorvus",
  "title": "Workspace",
  "cols": 120,
  "rows": 32,
  "env": {
    "TERM": "xterm-256color"
  }
}
```

Rules:

- `profileID` is required.
- `cwd` is required and must resolve inside the active project/workspace
  boundary.
- `cols` and `rows` are required positive integers.
- `command` and `args` are not accepted from the Overlay UI. The server
  resolves them from a validated terminal profile.
- Unknown `profileID` is a 400 error with a clear message.
- Missing profile configuration is a 400 error. Do not fallback to
  `Shell.preferred()`.

Response:

```json
{
  "id": "pty_...",
  "profileID": "default",
  "title": "Workspace",
  "cwd": "C:/Users/chuan/myhexin-local/opecorvus",
  "status": "running",
  "pid": 12345,
  "cursor": 0
}
```

### WebSocket

`GET /pty/:ptyID/connect?cursor=<number>`

Use one typed JSON protocol. Replace the current mixed protocol of raw string
input plus binary `0x00` cursor frame. A typed protocol is easier to bridge
through VS Code postMessage and easier to test.

Client to server:

```json
{ "type": "input", "data": "npm test\r" }
{ "type": "resize", "cols": 120, "rows": 32 }
{ "type": "kill" }
```

Server to client:

```json
{ "type": "ready", "cursor": 0, "info": { "...": "..." } }
{ "type": "output", "cursor": 48, "data": "..." }
{ "type": "exit", "exitCode": 0 }
{ "type": "error", "message": "..." }
```

Rules:

- `output.cursor` is the cursor after the chunk.
- On connect, if `cursor` is older than the retained ring buffer, return the
  retained content from the oldest available cursor and include a visible
  `history_truncated` event before output.
- Invalid client messages close the socket with a protocol error. Do not
  ignore malformed messages.
- Server must reject writes/resizes to exited sessions.
- Socket close does not kill the PTY by default. Closing the terminal tab or
  pressing the explicit close button calls `DELETE /pty/:ptyID` or sends
  `kill`.

### Update Session

Keep `PUT /pty/:ptyID` for title changes and non-WebSocket resize issued by
tests, but the interactive terminal should send resize through the socket so
resize ordering is preserved with input/output.

### List Sessions

`GET /pty` remains the source for reconnecting visible running sessions after
Overlay reload.

## Terminal Profiles

Introduce a single source for profiles:

`packages/opencorvus/src/pty/profile.ts`

Profile shape:

```ts
interface TerminalProfile {
  id: string
  label: string
  command: string
  args: string[]
  env: Record<string, string>
}
```

Configuration source:

- Server config owns profiles.
- A default profile may be generated only by explicit setup code that writes
  configuration. Runtime session creation must not invent a command.
- On Windows, if the default profile is `pwsh`, its command path must be
  explicitly configured or verified at setup time. Runtime does not try
  PowerShell, then Cmd, then Git Bash.

Required validation:

- `command` path exists or is resolvable by a single configured resolver.
- `args` is an array, never shell-split from a string.
- `env` keys and values are strings.
- `cwd` is absolute and inside allowed project roots.

## Overlay UI Placement

The terminal is a workspace-level tool, not a window-level control.

Place it inside the workspace owner surface:

- Add a terminal toggle/open button to the existing workspace command dock
  near editor launchers.
- Render the terminal as a bottom workspace panel or a dedicated workspace tab,
  depending on available vertical space.
- Do not place terminal controls in the titlebar.
- Use one terminal component:
  `packages/overlay/src/components/WorkspaceTerminal.tsx`.

Minimum UI:

- session tabs with title and close button
- new terminal button
- terminal body
- visible disconnected/error state
- kill/close confirmation for running sessions

## Overlay Client Design

Add a terminal client module:

`packages/overlay/src/services/terminal.ts`

Responsibilities:

- create session via `apiJson("pty", ...)`
- build authenticated WebSocket URL through the same server URL/auth/directory
  source as `api.ts`
- connect with cursor
- expose typed callbacks for `ready`, `output`, `exit`, `error`
- send typed client messages
- close socket deterministically

Extend `HostTransport` with a WebSocket method only if VS Code webview cannot
open the server WebSocket directly with the required auth. If VS Code needs a
bridge, add a single `openSocket` method to `HostTransport` and implement it
once in each host transport. Do not special-case terminal in the component.

## Backpressure And Output Ownership

- Server keeps a fixed byte or UTF-16 character ring buffer per PTY. The
  current 2 MiB limit is acceptable as a first target, but the cursor must be
  byte/character consistent with the encoded data.
- Overlay writes terminal output directly to xterm through a small queue.
  It must not store every chunk in Solid state.
- Batch `term.write()` calls with `requestAnimationFrame` or a microtask queue
  so high-output commands do not starve UI updates.
- Expose a dropped-history event if reconnect requests data older than the
  ring buffer.

## Lifecycle

- Server shutdown kills all active PTYs through `Instance.state` cleanup.
- Project directory switch closes visible terminal panels and deletes sessions
  for the old project. Do not keep terminals attached to the wrong workspace.
- Overlay reload lists existing sessions and reconnects only sessions for the
  current project directory.
- Explicit terminal close kills the PTY.
- WebSocket disconnect leaves the PTY alive and available for reconnect.

## Security

- Terminal creation requires active project directory context.
- `cwd` must be inside the active project directory unless a future explicit
  trusted workspace policy says otherwise.
- `command` is not user-provided at runtime from the terminal open button.
- Environment variables are profile-controlled plus a small allow-list of
  terminal-specific values (`TERM`, `COLORTERM`, `OPENCORVUS_TERMINAL`).
- Do not forward arbitrary browser-provided env into the PTY.
- Basic auth and directory injection must work for the WebSocket path.
- Remote/non-loopback access must require auth before PTY routes are usable.

## Implementation Plan

### Phase 1: Server Contract Hardening

1. Add `pty/profile.ts` and remove runtime shell fallback from `Pty.create`.
2. Change `Pty.CreateInput` to require `profileID`, `cwd`, `cols`, and `rows`.
3. Replace the mixed WebSocket protocol with typed JSON messages.
4. Add strict malformed-message handling.
5. Keep one ring buffer and expose cursor/truncation semantics.
6. Add tests:
   - create requires profile
   - missing/unknown profile fails
   - create rejects cwd outside project
   - socket receives `ready`
   - input echoes through a real PTY
   - resize is delivered
   - delete kills session
   - reconnect cursor replays retained output
   - too-old cursor emits `history_truncated`

### Phase 2: Overlay Terminal Client

1. Add `services/terminal.ts` with typed client messages.
2. Add WebSocket URL creation using existing configured server URL, auth, and
   directory source.
3. If VS Code requires a bridge, extend `HostTransport` with `openSocket` and
   implement the bridge in `vscode-transport.ts`. Otherwise document that
   direct WebSocket is supported by the webview and keep the transport surface
   smaller.
4. Add client tests for URL construction and malformed server events.

### Phase 3: Overlay UI

1. Add xterm dependencies.
2. Build `WorkspaceTerminal.tsx`.
3. Add terminal button in the workspace command dock.
4. Add terminal panel CSS in the workspace surface styles.
5. Wire `FitAddon` to resize observer and send resize events through the
   terminal client.
6. Write output directly to xterm; keep only session metadata in Solid state.
7. Add visual tests:
   - terminal opens from workspace dock
   - prompt/output renders
   - resize preserves layout
   - close kills the PTY and removes the tab

### Phase 4: Host Coverage

1. Tauri desktop: verify direct WebSocket and auth.
2. Browser overlay: verify direct WebSocket against local server.
3. VS Code webview: verify direct WebSocket first. If content security policy
   or auth blocks it, implement `HostTransport.openSocket` as the single
   bridge.

## Acceptance Criteria

- Opening a terminal in Overlay creates one server-owned PTY session for the
  current project directory.
- The terminal renders through xterm and supports interactive input.
- `cols/rows` changes propagate to the PTY after resizing the panel.
- Long output does not freeze the Overlay and does not grow Solid state
  without bound.
- WebSocket reconnect with a valid cursor resumes from retained output.
- Reconnect older than retained output surfaces visible truncation.
- Closing the terminal kills the PTY process tree.
- Reloading the Overlay can list and reconnect current project sessions.
- VS Code webview, Tauri, and browser overlay use the same terminal service
  contract.
- No runtime shell fallback exists in PTY session creation.
- No second terminal implementation exists in Tauri or VS Code extension code.

## Verification Commands

Targeted first:

```powershell
bun test --timeout 120000 packages/opencorvus/test/pty
bun test --timeout 120000 packages/overlay/test/terminal*.test.ts
bun run --cwd packages/overlay build:vite
bun run typecheck
```

Visual verification:

- Open the Overlay in a real browser or Tauri window.
- Open a terminal from the workspace command dock.
- Run:

```powershell
echo OPENCORVUS_TERMINAL
node -e "process.stdout.write(`${process.stdout.columns}x${process.stdout.rows}\n`)"
```

- Resize the terminal panel and rerun the size command.
- Capture a screenshot showing prompt, output, cursor, and panel layout.

## Sources

- xterm.js official documentation: https://xtermjs.org/docs/
- xterm.js addons guide: https://xtermjs.org/docs/guides/using-addons/
- node-pty repository background: https://github.com/microsoft/node-pty
- Current project PTY source: `packages/opencorvus/src/pty/index.ts`
- Current project PTY routes: `packages/opencorvus/src/server/routes/pty.ts`
- Current Overlay host transport: `packages/overlay/src/services/host-transport.ts`
