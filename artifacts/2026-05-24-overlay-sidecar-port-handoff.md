# Overlay Sidecar Port Handoff Plan

Date: 2026-05-24

## Problem

The Tauri overlay embeds and starts the OpenCorvus server. Same-process restart is handled by `restart_server()`, which calls `stop_server()` and then `start_server()`. Cross-process handoff is not handled: when a second overlay process starts while the previous overlay-managed server is still alive, the new process sees a busy port and backs off to another port. That can leave two overlay-managed servers alive.

Desired behavior: a new overlay instance should take ownership of the managed sidecar, close only the previous overlay-owned server, prefer the default port again, and let the frontend resume Server-Sent Events from the persisted sequence on the new URL.

## Independent Review Feedback

An independent review found the original plan was unsafe in two blocking ways:

- `packages/opencorvus/src/cli/cmd/serve.ts` currently kills any process occupying the requested port. Because Tauri probes a port and then later spawns `opencorvus serve --port`, there is a time-of-check/time-of-use race where a non-owned process can bind the port and then be killed by `serve`.
- A plain ownership file with only Process Identifier fields is not enough proof that the recorded process is still an overlay-owned sidecar. PID reuse or a tampered file can cause a forced kill of an unrelated process.

This revision makes those concerns first-class requirements. The handoff feature must not ship until both are fixed.

## Current Call Points

| Area | File | Current behavior | Planned action |
| --- | --- | --- | --- |
| Tauri sidecar process state | `packages/overlay/src-tauri/src/main.rs` | `ServerState` is process-local only. | Add a persisted ownership record and treat it as the cross-process source of truth. |
| Port selection | `packages/overlay/src-tauri/src/main.rs` | `next_server_port()` probes default, then `+1..+32`, then OS random. | Preserve this order, but only after owned-server takeover cleanup. |
| Server bind behavior | `packages/opencorvus/src/cli/cmd/serve.ts` | `serve` kills old process occupying the requested port. | Remove this default behavior or make it explicit opt-in, never used by overlay. |
| Same-process restart | `packages/overlay/src-tauri/src/main.rs` | `restart_server()` stops current child then starts a new one. | Reuse stop/start flow, guarded by owner compare-and-swap. |
| Shutdown request | `packages/overlay/src-tauri/src/main.rs` and `packages/opencorvus/src/server/routes/app.ts` | Tauri sends `POST /shutdown`; caller does not verify response body. | Add overlay owner token validation and require HTTP success plus `{ ok: true }`. |
| Frontend URL sync | `packages/overlay/src/services/connection.ts` | `syncLocalServerUrl()` updates `settingsStore.serverUrl` from `server.info`. | Add explicit managed-server apply path that cannot overwrite external server config. |
| Server-Sent Events reconnect | `packages/overlay/src/services/sse.ts` | Reopens selected task stream from `boardStore.taskSequence`. | Keep this as the single continuation mechanism. |
| Managed sidecar lock precedent | `packages/opencorvus/src/server/sidecar-lock.ts` | VS Code managed sidecar uses workspace-scoped lock. | Add a separate desktop-overlay global lock, not workspace-scoped. |

## Design

### 1. Fix `serve` Port Ownership Contract First

Change `packages/opencorvus/src/cli/cmd/serve.ts` before implementing handoff:

1. `opencorvus serve --port <n>` must fail if the port is occupied.
2. The existing kill-occupying-process behavior must be removed or hidden behind an explicit flag that the overlay never passes.
3. Overlay port backoff remains owned by `packages/overlay/src-tauri/src/main.rs`; the CLI must not kill processes as a side effect of bind failure.

This is a prerequisite. Without it, the overlay cannot truthfully guarantee "do not kill non-owned processes".

### 2. Add Overlay Managed Server Ownership

Create a Rust-side ownership file managed by the Tauri host, under `app_local_data_dir()/managed-server.json` or the existing local data root used by `ensure_embedded_server_path()`.

Shape:

```json
{
  "ownerId": "random-128-bit-id",
  "shutdownTokenHash": "sha256-token",
  "overlayPid": 1234,
  "serverPid": 5678,
  "serverProcessStartedAt": 1779630000000,
  "port": 7878,
  "host": "127.0.0.1",
  "startedAt": 1779630000000,
  "stamp": "embedded-server-build-stamp"
}
```

`ownerId` is the owner fencing value. The raw shutdown token is passed only to the spawned sidecar through an environment variable. The file stores a hash so a copied file alone is not enough to authenticate shutdown.

Ownership is global for the desktop overlay, not workspace-scoped. The desktop overlay serves multiple selected workspaces through request headers/query, so workspace-scoped locking would be the wrong abstraction.

### 3. Add Startup Mutex And Owner Fencing

Add a global startup mutex/file lock around the entire takeover path:

1. Acquire startup lock.
2. Read and strictly validate the ownership file.
3. If the record is malformed, delete it only if no live authenticated server identity matches it.
4. If `serverPid` is dead, delete the record.
5. If `serverPid` is alive, verify server identity before any shutdown or kill:
   - call a loopback identity endpoint with the owner token, or call `/shutdown` with the owner token and require authenticated success;
   - verify PID creation time when the platform can expose it;
   - verify executable path or command line matches the embedded sidecar when practical.
6. If identity is verified, send authenticated `POST /shutdown`.
7. Parse HTTP status and response body; only `{ "ok": true }` counts as graceful shutdown accepted.
8. Wait for process or port release.
9. If still alive, use platform-specific process-tree termination only after identity verification.
10. Delete the ownership file only if it still matches the same `ownerId` and `serverPid`.
11. Start the new server, wait for health readiness, then atomically publish the new ownership record.
12. Release startup lock.

This makes the ownership file the cross-process source of truth. `ServerState` remains only an in-process child-handle cache for the current owner.

### 4. Platform Process-Tree Termination

Forced termination is a last resort after authenticated identity verification.

Unix and macOS:

- Record whether the sidecar was spawned as process-group leader.
- Kill the process group with `kill(-pgid, SIGKILL)` only when the recorded server process still matches the verified process-group leader.

Windows:

- The current unnamed Job Object cannot be reused by a new overlay process.
- Use an explicit verified process-tree kill path, such as `taskkill /T /PID <serverPid>`, or replace the unnamed Job Object with a named/reopenable ownership model.
- The chosen path must be tested for grandchild cleanup.

### 5. Old Overlay Host Behavior

An old overlay process can remain alive after its sidecar is taken over. It must not silently become a second owner.

Rules:

1. Every `ensure_server()`, `start_server()`, `restart_server()`, and `stop_server()` path compares the current ownership file against this process's `ownerId`.
2. If this overlay no longer owns the record, it must not start a sidecar.
3. Tray "Restart" in a non-owner overlay should either reacquire through the startup mutex or surface a lost-ownership state; it must not use stale `ServerState`.
4. `stop_server()` must release ownership only when the file still matches this process's `ownerId` and child PID.

### 6. Frontend Migration

No new Server-Sent Events protocol is needed, but URL application must be explicit.

Add an `applyManagedServerInfo()`-style path in `packages/overlay/src/services/connection.ts`:

1. Apply native server info only when `autoServer` is true and the current URL is managed local, or when the user explicitly triggers managed restart.
2. Never overwrite a user-configured external `serverUrl`.
3. After applying a changed URL, update `api.ts` and trigger the existing stream-close/reopen behavior.
4. Rename or document the current auth/server URL change listener as the connection configuration change hook, because selected-task and task-list streams depend on it for immediate migration.

The continuation source remains `boardStore.taskSequence`; no second sequence source is introduced.

## Implementation Order

1. Remove or opt-in gate `serve.ts` port-kill behavior, with tests proving non-owned port occupants are not killed.
2. Add authenticated overlay sidecar identity/shutdown contract.
3. Add Rust ownership file, startup mutex, compare-and-swap release, and platform process-tree cleanup.
4. Update Tauri start/ensure/restart/stop paths to honor cross-process ownership.
5. Add frontend managed-server apply path and stream restart tests.
6. Run targeted CLI, Rust, and overlay tests.

## Tests

Add CLI tests for `packages/opencorvus/src/cli/cmd/serve.ts`:

- occupied port causes bind failure without killing the occupying process;
- any explicit kill flag, if retained, is not used by overlay startup.

Add Rust tests in `packages/overlay/src-tauri/src/main.rs` for:

- malformed ownership file is ignored and removed only through safe rules;
- dead PID ownership is pruned;
- release refuses to delete a record owned by another `ownerId`;
- concurrent startup lock allows only one owner;
- old owner cannot restart sidecar after losing ownership;
- port selection still prefers default after takeover cleanup.

Add platform/integration tests where practical:

- non-owned process on `7878` is never killed;
- two overlay startups racing produce exactly one owner and no orphan sidecar;
- tampered lock or PID reuse does not trigger forced kill;
- `/shutdown` returning 401, 403, 500, 503, or `{ ok: false }` is not treated as success;
- Windows process-tree cleanup removes grandchildren;
- Unix/macOS process-group cleanup removes grandchildren.

Add overlay TypeScript tests for:

- external `serverUrl` is not overwritten by forced managed-server sync;
- managed server URL change updates API base URL;
- selected-task stream restarts from `boardStore.taskSequence` after URL change;
- task-list stream restarts after managed server migration.

## Non-Goals

- Do not scan arbitrary local ports looking for OpenCorvus servers.
- Do not kill arbitrary processes on `7878`.
- Do not add a second Server-Sent Events resume source.
- Do not make frontend guess ports.
- Do not change `/task/:id/events` protocol.

## Acceptance

- Launching a new desktop overlay while an older overlay-managed server is alive shuts down the older authenticated owned server.
- The new server prefers `127.0.0.1:7878` when the old server releases it.
- If `7878` is occupied by a non-owned process, the overlay backs off to the next available port without killing it.
- Existing selected task view resumes Server-Sent Events from the persisted sequence without full conversation reload.
- A stale, malformed, tampered, or PID-reused ownership file cannot cause an unrelated process to be killed.
- Concurrent overlay startups produce one owner and no orphan sidecar.
- No stale ownership file blocks future launches after normal shutdown or crash recovery.
