# Browser Preview Process URL Extraction

Date: 2026-06-07
Status: Implementation note

## Acronyms

- URL: Uniform Resource Locator, the absolute browser address used by the iframe and Playwright.
- UI: User Interface, the overlay controls and preview pane.
- PID: Process Identifier, the operating-system identifier returned for a background process.

## Problem

The right-side browser preview reads only task-scoped `browser_preview_target` artifacts. That is the correct single source, but the current system only creates those artifacts through manual input. A user entering `localhost:5173` gets a 400 because URL normalization only accepts explicit `http(s)` strings.

The missing behavior is not a UI-side port guess. The backend should materialize a preview target artifact when a task-owned background process prints a local HTTP preview URL.

## Call Points

| Symbol / route                             | Existing behavior                                             | Change                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `normalizeBrowserPreviewUrl`               | Accepts only explicit `http(s)` URLs.                         | Also normalize loopback `host:port/path` text to `http://host:port/path`.                                      |
| `PUT /task/:taskID/browser-preview/target` | Persists a normalized explicit URL or returns 400.            | Reuses the broader normalizer, so `localhost:5173` persists as `http://localhost:5173/`.                       |
| `resolveBrowserPreviewTarget`              | Reads the latest task `browser_preview_target` artifact only. | Keep unchanged as the preview panel's single source.                                                           |
| `BashTool` background branch               | Returns PID and captured stdout/stderr metadata.              | Extract a local HTTP URL from the captured output and persist `browser_preview_target` for `ctx.extra.taskID`. |
| `BrowserPreviewPanel`                      | Loads target through HostTransport-backed service.            | Keep unchanged.                                                                                                |

## Decision

URL extraction happens at the tool output write boundary, not in overlay UI and not in the target resolver. This keeps the backend artifact as the only preview source while making process-start evidence automatically visible.

The extractor is intentionally URL-parser based: it tokenizes HTTP URLs from output, validates them with `URL`, and only accepts loopback hosts for automatic materialization. It does not choose package managers, roots, or ports.

## Tests

- Unit coverage for `localhost:5173` normalization.
- Unit coverage for extracting a Vite-style local URL from terminal output.
- Bash tool coverage that a background process output creates a task `browser_preview_target` artifact.
