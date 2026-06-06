# Codex external executor native model fix - 2026-06-07

## Evidence

- Local `codex --version` reports `codex-cli 0.133.0`.
- `codex app-server --listen stdio://` accepts `initialize`, `thread/start`, and `turn/start` through JSON-RPC when launched through the Windows npm `.cmd` shim via `cmd.exe /c`.
- The same app-server warns when OpenCorvus sends `gpt-5-codex`: `Unknown model gpt-5-codex is used. This will use fallback model metadata.`
- Current overlay external model picker builds model IDs as `<provider>/<model>`, then writes that string to `/executor/{executorID}/model`.

## Call Points

| Area | File | Decision |
| --- | --- | --- |
| Executor env model source | `packages/opencorvus/src/executor/runtime-env.ts` | Reject provider/model refs for Codex too; external CLI executors consume native model names. |
| Executor model route | `packages/opencorvus/src/server/routes/executor.ts` | Keep route; validation remains centralized in `setModelOverride`. |
| Codex bootstrap | `packages/opencorvus/src/executor/bootstrap.ts` | Keep using `OPENCORVUS_EXECUTOR_CODEX_MODEL`; fixed by env validation and overlay value shape. |
| Overlay picker source | `packages/overlay/src/components/ExecutorSelector.tsx` | Internal OpenCorvus picker keeps provider/model refs; external picker emits native model IDs only. |
| Overlay service | `packages/overlay/src/services/executor.ts` | Keep API boundary; value shape is produced by the picker. |
| Tests | `packages/opencorvus/test/executor/runtime-env.test.ts`, `packages/overlay/test/executor-selector-dualbar.test.ts` | Add regressions for Codex native model validation and external picker native model IDs. |

## Implementation

The single source is executor kind:

- OpenCorvus internal model selection uses OpenCorvus provider/model references.
- External executors (`codex`, `claude-code`) use native CLI model strings.

No fallback or compatibility translation is added. Invalid provider/model refs fail at the setter boundary.
