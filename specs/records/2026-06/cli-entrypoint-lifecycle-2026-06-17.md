# CLI Entrypoint Lifecycle, 2026-06-17

## Problem

The compiled `opencorvus serve` test instance on port 7878 exited after running for a while. Its stderr ended with:

```text
error: Pending response rejected since connection got disposed
```

The service did not log the controlled `serve` shutdown message. That means the shutdown escaped the command-owned lifecycle.

## Evidence

| Surface                   | Evidence                                                                                                                                                               | Decision                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Full CLI entrypoint       | `packages/opencorvus/src/index.ts` calls `await cli.parse()` and then unconditionally calls `process.exit()` in `finally`.                                             | Remove the top-level unconditional exit. Command handlers own lifecycle and explicit shutdown.             |
| Overlay server entrypoint | `packages/opencorvus/src/overlay-server.ts` has the same `await cli.parse()` plus unconditional `process.exit()` pattern.                                              | Apply the same lifecycle rule to the overlay entrypoint.                                                   |
| Binary wrapper            | `packages/opencorvus/src/runtime/binary-launcher.ts` reports import-level failures with `process.exit(1)`.                                                             | Keep this wrapper failure path; it handles entrypoint import failure, not normal command lifecycle.        |
| Long-running commands     | `packages/opencorvus/src/cli/cmd/serve.ts` and `packages/opencorvus/src/cli/cmd/sidecar.ts` already keep their process alive and perform explicit controlled shutdown. | Do not add scheduler/state monitoring or restart logic.                                                    |
| Agent debug fatal paths   | `packages/opencorvus/src/agent/runner.ts` and `packages/opencorvus/src/orchestrator/agent.ts` contained `process.exit(99)` for `INFORMATION MISSING`.                  | Replace with non-retryable `AgentRunError` so only the current run/wake fails and the sidecar stays alive. |

## Fix

Use `parseAsync()` for async yargs handlers and let the process lifecycle be owned by the selected command. Finite commands exit naturally when their handles close. Long-running commands keep the event loop alive until their own shutdown path runs.

Do not add fallback, command-name gates, watchdog restarts, or status-machine logic. If a finite command leaves stray handles, that command must fix its own resource cleanup instead of relying on a global kill in the entrypoint.

## Verification

- Add source-level tests that reject top-level `finally { process.exit() }` in both entrypoints.
- Add source-level tests that require `parseAsync()` in both entrypoints.
- Run the focused lifecycle test.
- Run typecheck.
- Rebuild the OpenCorvus binary before any new 7878 test run.
