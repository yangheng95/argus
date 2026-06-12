# TUI Removal Plan - 2026-06-10

## Goal

Remove the remaining Terminal User Interface (TUI) feature surface and OpenTUI dependencies without breaking OpenCorvus core or the overlay desktop workflows.

## Dependency Findings

| Surface              | Current references                                                                                                   | Decision                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| CLI entry            | `packages/opencorvus/src/index.ts` imports `TuiThreadCommand`; `packages/opencorvus/src/cli/cmd/tui/**` owns the app | Delete TUI command and source tree. Bare `opencorvus` should no longer start a TUI.                    |
| HTTP API             | `packages/opencorvus/src/server/routes/app.ts` mounts `/tui`; `routes/tui.ts` exposes runtime/control/action routes  | Delete `/tui` route and generated SDK/OpenAPI entries.                                                 |
| TUI runtime          | `packages/opencorvus/src/tui/{index,command,runtime}.ts` spawns/controls a TUI subprocess                            | Delete.                                                                                                |
| PTY host             | `packages/opencorvus/src/tui/host.ts` is a generic pseudo terminal host with TUI naming and default TUI spawning     | Move to a PTY-owned host and remove implicit TUI spawn. Preserve explicit-command PTY sessions.        |
| Overlay              | Overlay uses `/terminal/*` system terminal routes, not `/tui` or `/pty`                                              | Keep overlay terminal behavior unchanged. Remove obsolete TUI event allowlist entries.                 |
| MCP auth notice      | `packages/opencorvus/src/mcp/index.ts` publishes `TuiEvent.ToastShow`                                                | Remove TUI event dependency and keep server logging / explicit MCP auth errors as the source of truth. |
| Config flags         | `OPENCORVUS_TUI_CONFIG`, `OPENCORVUS_TUI_CONTROL_TIMEOUT_MS`, `config/tui.ts`, `config/tui-schema.ts`                | Delete TUI config readers and flag tests.                                                              |
| Build                | `script/build*.ts` imports OpenTUI Solid plugin, bundles parser worker and TUI worker                                | Build only the launcher entrypoint; remove OpenTUI build plugin and defines.                           |
| Plugin package       | `@opencorvus-ai/plugin/tui` exports OpenTUI plugin types                                                             | Delete TUI export and OpenTUI package dependencies.                                                    |
| Docs / generated SDK | README, CONTRIBUTING, product docs, OpenAPI, SDK generated types mention `/tui`                                      | Update docs and regenerate API/SDK from source.                                                        |

## Safety Checks

- Preserve `/terminal/profiles` and `/terminal/open`; overlay terminal buttons depend on these routes.
- Preserve `/pty/*` route shape for explicit command sessions; remove only the TUI default command behavior and TUI labels.
- Do not touch unrelated dirty overlay/backend changes.
- Regenerate SDK/OpenAPI only after source routes are removed, preserving already-dirty generated changes from current source.

## Tests To Update

- Replace TUI-positive tests with removal guards:
  - root CLI no longer imports `TuiThreadCommand`
  - `/tui/*` returns 404
  - package manifests and build scripts do not mention OpenTUI packages or TUI workers
  - PTY create requires an explicit command and keeps explicit-command sessions functional
  - overlay event policy no longer lists `tui.*`
- Delete obsolete `test/tui/**`, `test/cli/tui/**`, `test/config/tui.test.ts`, and TUI server route tests.
