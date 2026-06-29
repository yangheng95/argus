# Browser Preview Materializer Retry And Port Discovery

Date: 2026-06-11
Status: Implementation plan

## Acronyms

- URL: Uniform Resource Locator, the browser address printed by local dev servers.
- TTL: Time To Live, the duration a cached liveness result remains usable.
- MCP: Model Context Protocol, the browser/tool protocol surface used by agents.

## Evidence

G3 started a dev server twice. Port 3456 printed `http://localhost:3456/world-economy` but was not reachable by a later shell probe. Port 3457 was reachable by `curl`, but the command output did not include a URL, so no `browser_preview_target` artifact was written. The task preview route returned `No browser preview target saved for this task.`

## Call Points

| Symbol / file                                                                                           | Current behavior                               | Decision                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `createBrowserPreviewProcessOutputMaterializer` in `packages/opencorvus/src/browser-preview/extract.ts` | Adds URL to `seen` before reachability probe.  | Mark URLs persisted only after successful artifact write; allow retry after failed probe while deduplicating in-flight probes. |
| `persistBrowserPreviewTargetFromProcessOutput` in `packages/opencorvus/src/browser-preview/extract.ts`  | Scans completed output only.                   | Keep as output-only for generic tools.                                                                                         |
| `BashTool` in `packages/opencorvus/src/tool/bash.ts`                                                    | Passes only task ID to streaming materializer. | Pass the actual shell command so the materializer can derive dev-server port candidates.                                       |
| `SessionShell.shell` in `packages/opencorvus/src/session/shell-exec.ts`                                 | Passes only task ID to streaming materializer. | Pass the executed command for the same materializer path.                                                                      |
| `resolveBrowserPreviewTarget` in `packages/opencorvus/src/browser-preview/target.ts`                    | Resolves only persisted task artifacts.        | Keep unchanged; no package metadata, query override, or overlay-side fallback.                                                 |

## Design

The materializer owns candidate discovery and still writes only task-scoped artifacts. It extracts candidates from output chunks and, for mature frontend dev commands, from explicit `--host` / `--port` or `--port=...` command arguments. Command-derived candidates still pass the existing reachability probe before `persistBrowserPreviewTarget`.

This is not a preview fallback. Resolver and overlay continue to use only persisted `browser_preview_target` artifacts.

## Tests

- Streaming materializer retries the same URL after an initial failed probe.
- Streaming materializer derives a candidate from a frontend dev command with `--port` and no URL output.
- Streaming materializer does not derive a target from a non-frontend command with `--port`.
- BashTool passes command-derived port candidates through the materializer.
- SessionShell passes command-derived port candidates through the materializer.
