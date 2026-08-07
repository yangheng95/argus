# Browser Preview Start Service Tool

> Superseded in part by `2026-06-12-explicit-browser-preview-agent-tool.md`: the `browser_preview` tool remains, but generic `bash`, generic tool output, user shell output, and browser MCP output no longer auto-materialize preview targets. Preview target inference from process output is owned only by the explicit `browser_preview` tool.

## Problem

Assistant sessions can start frontend development servers with `bash`, and existing streaming output materialization can persist task-scoped `browser_preview_target` artifacts. The missing surface is a direct assistant tool whose intent is explicit: start a long-lived preview service and open the overlay preview through the existing task artifact source.

## Grep Evidence

| Surface                                                    | Evidence                                                                                                       | Decision                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/tool/bash.ts`                     | `BashTool` supports `background: true` and returns startup output / process metadata.                          | Reuse it for process lifecycle and permission parsing, without automatic preview target side effects. |
| `packages/opencorvus/src/browser-preview/extract.ts`       | `extractBrowserPreviewUrlsFromText` and `persistBrowserPreviewUrls` normalize/probe/persist task preview URLs. | Keep as the explicit `browser_preview` tool's persistence kernel.                                     |
| `packages/opencorvus/src/browser-preview/persist.ts`       | `persistBrowserPreviewTarget` emits `task.updated`.                                                            | Reuse for explicit URL inputs so overlay refresh remains event-driven.                                |
| `packages/opencorvus/src/browser-preview/target.ts`        | `resolveBrowserPreviewTarget` reads only task artifacts.                                                       | Keep unchanged; no package metadata or overlay override source.                                       |
| `packages/opencorvus/src/server/routes/browser-preview.ts` | Task routes read/select/capture/live-snapshot persisted targets.                                               | No route change needed.                                                                               |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx`  | `onReady` fires when a ready target resolves.                                                                  | Existing overlay behavior opens the browser preview when the artifact appears.                        |
| `packages/overlay/src/main.tsx`                            | `onReady={() => openRightActivity("browser")}`.                                                                | No frontend state hook needed.                                                                        |
| `packages/opencorvus/src/tool/registry.ts`                 | Tool list registers assistant tools.                                                                           | Add the new tool there.                                                                               |

## Design

Add `browser_preview` with one action: start a service for the current task preview.

Inputs:

- `command`: frontend development server command.
- `workdir`: optional work directory resolved by `bash`.
- `url`: optional explicit preview URL, normalized and persisted only after reachability succeeds.
- `timeout`: readiness wait for the startup call.
- `leaseTimeout`: long-lived process lease.

Execution:

1. Require `ctx.extra.taskID`; without a task ID there is no authoritative preview target sink.
2. Call `BashTool` with `background: true`, preserving existing permission checks, shell environment, process supervision, and streaming materialization.
3. If `url` is supplied, normalize it, wait for reachability, then call `persistBrowserPreviewTarget`.
4. Resolve the current task preview target and return structured JSON with process PID, target ID/URL/status, diagnostics, and a note that overlay opens from `browser_preview_target`.

## Tests

- Unit test that the tool is registered.
- Tool test with a mocked background process that prints a reachable URL and persists a task preview target.
- Tool test with an explicit URL and no printed URL to prove the URL path uses the same persisted target source.

## Non-Goals

- No overlay-side iframe/query/local signal override.
- No second target source.
- No package metadata inference in target resolution.
