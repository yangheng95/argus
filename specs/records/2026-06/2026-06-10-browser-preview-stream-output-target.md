# Browser Preview Stream Output Target

Date: 2026-06-10
Status: Implementation plan

## Acronyms

- URL: Uniform Resource Locator, the browser address printed by local dev servers.
- UI: User Interface, the overlay surface that renders preview evidence.
- SSE: Server-Sent Events, the task event stream that tells the overlay to refresh.

## Requirement

When a frontend dev server prints its local URL while a long-running shell command is still active, the task preview target must be persisted immediately. The overlay preview panel must continue to use the task-scoped backend `browser_preview_target` artifact as the only URL source.

## Call Points

| Symbol / file                                  | Current behavior                                                    | Change                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `extractBrowserPreviewUrlsFromText`            | Extracts normalized loopback URLs from a completed text blob.       | Reuse unchanged for both completed and streaming output.                                                        |
| `persistBrowserPreviewTargetFromProcessOutput` | Called from `Tool.define` after a tool result is available.         | Keep as the completed-output entrypoint and share its persistence kernel with streaming output.                 |
| `Tool.define`                                  | Scans successful tool results after `execute()` returns.            | Keep for non-streaming tools. It cannot be the only path for long-lived dev servers.                            |
| `BashTool` stdout/stderr append                | Updates tool metadata while background commands continue.           | Feed each output chunk into a task-scoped browser-preview materializer before the command returns or continues. |
| `SessionShell.shell` stdout/stderr append      | Updates the shell tool part metadata until process exit.            | Feed chunks into the same task-scoped materializer, deriving the task from the owning session.                  |
| `persistBrowserPreviewTarget`                  | Emits `task.updated` after target upsert.                           | Keep unchanged so existing SSE refresh opens the preview from the persisted artifact.                           |
| `BrowserPreviewPanel`                          | Loads targets from backend using `boardUpdatedAt` / manual refresh. | Keep unchanged; this fix makes backend events happen at the correct time.                                       |

## Design

Add a small browser-preview process-output materializer in `browser-preview/extract.ts`. It keeps a short tail so URLs split across chunks still parse, records URLs already seen by this process, probes reachability through the existing liveness function, and persists reachable targets through `persistBrowserPreviewTarget`.

The helper is not a UI source. It only writes the same task artifact that the existing backend route already resolves.

## Tests

- Unit: materializer persists a reachable preview URL from streaming output after the shell tool has returned.
- Unit: materializer deduplicates repeated chunks and does not grow duplicate target artifacts.
- Existing route and panel tests continue to assert that the overlay reads backend task targets only.
