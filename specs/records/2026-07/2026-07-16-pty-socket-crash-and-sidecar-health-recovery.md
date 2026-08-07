# PTY Socket Crash And Sidecar Health Recovery

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement                 | Opening a previous conversation reports `source: work-ledger.select-task` and `TypeError: Failed to fetch`; identify and repair the actual failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Acceptance criteria              | The exact observed backend crash no longer terminates OpenCorvus; a Windows Pseudo Terminal (PTY) input/exit race remains owned by the terminal lifecycle; a packaged Bun executable uses the bundled Node PTY bridge; the Overlay detects a backend loss even when it previously considered the connection online; a managed sidecar replacement reloads server-backed projections; focused backend and Overlay regressions, typechecks, docs health, and a second review pass.                                                                                                                                       |
| Hard constraints                 | Do not restart, refresh, close, or kill the user's running OpenCorvus/Overlay; do not treat the visible fetch failure or entity title as the root cause; preserve unrelated dirty Expert Squad and Overlay message changes; no fallback process runner, retry gate, state machine, compatibility branch, or raw `fetch` bypass; keep PTY process/buffer ownership in `PtyHost` and connection ownership in the existing monitor; Windows Playwright, if needed, runs through Node.                                                                                                                                     |
| Sources read                     | `AGENTS.md`; `specs/current/architecture/{07-panel,99-principles}.md`; `2026-07-15-right-dock-embedded-terminal.md`; `2026-07-05-overlay-build-card-sse-teardown-verification.md`; `2026-06-23-uncaught-exception-root-repair.md`; live Tauri sidecar log; durable OpenCorvus process log; `packages/opencorvus/src/{pty/host,util/process-error-logging,browser/runtime/node-sidecar}.ts`; packaged `@lydell/node-pty-win32-x64` source; Overlay task selection, API transport, connection monitor, initialization, and monitor tests.                                                                                |
| Whole-repository search evidence | `work-ledger.select-task` has one UI owner in `main.tsx`; `selectTask()` has one task-switch/hydrate owner in `services/task.ts`; requests converge on `HostTransport.request` and Tauri `fetch`; `/pty/:ptyID/input` converges on `Pty.input` -> `PtyHost.inputPty` -> `HostProcess.write`; the packaged crash stack ends at that exact write; `hostProcess()` is the only selector between `directPtyProcess` and `nodeBridgePtyProcess`; `startConnectionMonitor()` and `makeMonitorTick()` are the only periodic connection owners; all current monitor tests are in `packages/overlay/test/monitor-tick.test.ts`. |
| Independent agent feedback       | None. The user did not request sub-agents, and the active collaboration constraint forbids unsolicited delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Evidence And Causal Chain

The visible `Failed to fetch` is downstream evidence, not the cause:

1. The Tauri process `opencorvus-overlay.exe` remained alive, but port `7878`
   had no listener and `GET /global/health` could not connect.
2. Its current sidecar log records `error: Socket is closed` at `18:46:54`.
3. The durable OpenCorvus log identifies the exact request and stack:
   `POST /pty/<id>/input` completed `200`, then `@lydell/node-pty` emitted
   `ERR_SOCKET_CLOSED` from `windowsTerminal.js`, through
   `PtyHost.inputPty`, and the process-level logger reported an uncaught
   exception.
4. The packaged executable is Bun-compiled but named `opencorvus.exe`.
   `hostProcess()` identifies Bun only by an executable basename equal to
   `bun`, so packaged Windows runs select `directPtyProcess()` instead of the
   already-bundled Node bridge. The bridge was therefore absent from the
   observed stack even though its packaged runtime exists.
5. `@lydell/node-pty` closes the terminal on its socket `error` and throws the
   error when no external listener owns it. Neither the direct process adapter
   nor the bridge registers that error event.
6. After the fatal exit, `makeMonitorTick()` skips every tick while
   `appStore.connected` remains true. The next task selection therefore reaches
   a dead port and exposes only the browser's raw `TypeError`.

The dependency is already on the package's current `latest` tag
(`1.2.0-beta.12`). A newer `beta` tag exists, but its wrapper release only
tracks an upstream beta and is not evidence that this lifecycle race is fixed.
The repair belongs at OpenCorvus's existing process and connection ownership
boundaries.

## Call-Site Disposition

| Surface                                         | Disposition                                                                                                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PtyHost.hostProcess()`                         | Replace executable-name inference with the actual Bun runtime signal on Windows so source and compiled Bun use the Node bridge. Keep direct PTY execution for a real Node host.                                       |
| `directPtyProcess()`                            | Register the PTY runtime `error` event immediately and project it through the existing host-process error owner instead of allowing a process-level throw.                                                            |
| `NODE_BRIDGE_SCRIPT` / `nodeBridgePtyProcess()` | Register the same PTY `error` event in the Node child, serialize it over the existing bridge protocol, and let the existing exit event settle the session. No second bridge or process runner.                        |
| `spawnPrepared()`                               | Observe terminal-local errors through the session owner and keep them visible in terminal output/log evidence without treating them as server-fatal.                                                                  |
| `makeMonitorTick()`                             | Probe on visible ticks even when currently online; fire the existing reconnect/reload callback only after offline recovery or when the managed-server identity changes. Preserve the in-flight and generation guards. |
| `startConnectionMonitor()`                      | Supply the existing sidecar PID as managed-server identity; external/browser servers continue to use connectivity only.                                                                                               |
| Tests                                           | Extend PTY route/source coverage for packaged Bun routing and owned runtime errors; update monitor tests for online probes, stable identity, replacement identity, failure, overlap, and stale-generation behavior.   |

## Implementation And Verification Plan

1. Land this Recall and complete call-site inventory before production edits.
2. Correct the PTY host selection and error ownership, then run the focused PTY
   route suite including a real Windows Node bridge path.
3. Correct the connection monitor's online probe and managed-sidecar identity
   recovery semantics, then run the monitor and initialization regressions.
4. Run OpenCorvus and Overlay typechecks, route/docs health, historical-doc
   links, and `git diff --check`.
5. Use an isolated process to reproduce terminal create/input/exit without
   touching the user's running Overlay, inspect the resulting logs, and verify
   the server health endpoint remains available.
6. Perform a second diff/root-cause review, commit only this task's files with
   the required `dsw-33987` prefix, and push the current branch to `myhexin`.

## Progress

- [x] Live process, port, Tauri sidecar, durable application log, packaged
      dependency source, selection request chain, PTY input chain, runtime
      selection, and connection monitor inspected.
- [x] PTY lifecycle repair and regression coverage.
- [x] Online sidecar-loss detection and replacement reload coverage.
- [x] Focused and package-level verification.
- [x] Second review complete; selective git-cc delivery prepared.

## Implementation

- `PtyHost` now selects the existing Node bridge from the actual Bun runtime
  signal, so both `bun.exe` source runs and compiled `opencorvus.exe` package
  runs use the same Windows PTY isolation boundary.
- Both the direct Node host and the bridge child register the concrete
  `@lydell/node-pty` EventEmitter `error` immediately after spawn. Errors are
  projected through `HostProcess.onError`, recorded in the durable PTY log and
  terminal buffer, while the library's existing exit callback owns terminal
  settlement.
- The visible connection monitor now probes online connections as well as
  offline ones. Stable online probes do not reload data; an offline recovery or
  changed Tauri sidecar process ID invokes the existing `onReconnect` data-load
  owner.
- Periodic probes reuse `checkConnection({ background: true })`, which keeps an
  existing online badge stable while the request is pending but still marks a
  failed probe offline. This was added after second review found that reusing
  the foreground presentation unchanged would flash `connecting` every ten
  seconds.

## Verification

| Command / evidence                                                                                                                 | Result                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live process and port inspection                                                                                                   | `opencorvus-overlay.exe` alive; no listener on `127.0.0.1:7878`; health request refused; running process was not modified.                             |
| Tauri sidecar log                                                                                                                  | Exact fatal `Socket is closed` at the current overlay launch.                                                                                          |
| Durable OpenCorvus log                                                                                                             | Exact `POST /pty/<id>/input` -> `@lydell/node-pty` `ERR_SOCKET_CLOSED` -> `PtyHost.inputPty` -> uncaught exception chain.                              |
| `bun test packages/opencorvus/test/server/pty-routes.test.ts --timeout 60000`                                                      | 10 passed, 70 assertions; includes real Windows Bun-to-Node bridge PTY create/input/output/exit and project isolation.                                 |
| `bun run --cwd packages/opencorvus typecheck`                                                                                      | Passed.                                                                                                                                                |
| `bun test packages/overlay/test/monitor-tick.test.ts packages/overlay/test/connection-startup-diagnostics.test.ts --timeout 60000` | 15 passed, 38 assertions; includes stable online probe, sidecar identity replacement, background badge stability, and failed-probe offline transition. |
| `bun run --cwd packages/overlay typecheck`                                                                                         | Passed.                                                                                                                                                |
| Extended PTY/process-error/monitor/connection/SSE suite                                                                            | 47 passed, 189 assertions before the background-presentation follow-up; follow-up focused suite passed separately.                                     |
| Historical links, document health, product docs single source                                                                      | 78 passed, 1,216 assertions after tracking this Recall.                                                                                                |
| `bun run api:routes-check`                                                                                                         | Passed across 30 route files.                                                                                                                          |
| `bun run docs:check`                                                                                                               | Passed with 261 operations in 24 groups.                                                                                                               |

## Second Review

- Confirmed the raw `Failed to fetch` occurs after the process has already
  exited and is not a task-record, directory-namespace, or response-schema
  error.
- Confirmed executable-name inference was the reason the packaged product
  bypassed the bridge; adding only an error catch in `selectTask()` would have
  hidden the consequence and left the server-fatal defect intact.
- Confirmed error ownership is installed before bridge readiness is published
  and before `spawnPrepared()` can accept input, closing the observed race
  window.
- Confirmed the monitor preserves existing in-flight and lifecycle-generation
  guards and does not fire data reloads for stable online probes.
- Found and repaired online-badge flicker before final acceptance by separating
  foreground connection presentation from periodic background presentation at
  the existing single connection-check owner.
