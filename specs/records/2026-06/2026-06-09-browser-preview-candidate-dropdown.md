# Browser Preview Candidate Dropdown

Date: 2026-06-09
Status: Implementation plan

## Acronyms

- URL: Uniform Resource Locator, the absolute browser address used by the iframe and Playwright.
- UI: User Interface, the overlay controls and preview pane.
- PID: Process Identifier, the operating-system identifier returned for a background process.
- TTL: Time To Live, the short-lived cache window for reachability probes.

## Requirement

The toolbar preview surface must discover local development URLs printed by tools, show them as preview candidates, switch between them with a dropdown, and remove candidates from the visible list when the local frontend server dies. The preview iframe still uses the task-scoped browser preview target artifact as its source; the overlay must not keep a separate URL registry.

## Call Points

| Symbol / route                                 | Existing behavior                                                        | Change                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `extractBrowserPreviewUrlFromText`             | Returns the first explicit loopback `http(s)` URL.                       | Replace with multi-URL extraction that also accepts scheme-less loopback text such as `localhost:5173`.                                    |
| `persistBrowserPreviewTargetFromProcessOutput` | Persists one reachable target from process output.                       | Persist every distinct local candidate found in tool output when called from the tool wrapper; route resolution owns visibility filtering. |
| `persistBrowserPreviewTarget`                  | Inserts a new `browser_preview_target` artifact for every save.          | Reuse an existing artifact for the same task URL by bumping `time_updated`, so repeated tool output does not grow unbounded.               |
| `Tool.define`                                  | Wraps successful tool results before truncation and message persistence. | Extract preview candidates from every successful tool output for the active task without a reachability wait.                              |
| `findLatestBrowserPreviewTarget`               | Reads one newest artifact.                                               | Resolve the newest reachable candidate after pruning unreachable candidates from the response.                                             |
| `GET /task/:taskID/browser-preview`            | Returns one target object.                                               | Return the selected target plus a `candidates` array from the same artifacts.                                                              |
| `PUT /task/:taskID/browser-preview/target`     | Saves explicit URL as latest target.                                     | Continue to promote the selected URL by reusing/bumping the same artifact.                                                                 |
| `BrowserPreviewPanel`                          | URL text box loads one target.                                           | Add a backend-backed candidate dropdown, and poll while active so dead local servers disappear.                                            |

## Design

The backend remains the single source. Each candidate is a `browser_preview_target` artifact keyed by task and normalized URL. `Tool.define` scans each successful tool output once and upserts extracted candidates without waiting for network reachability, so ordinary tools do not pay a multi-second dead-port penalty. The route builds the visible candidate list by probing recent distinct loopback targets with a small concurrency cap and a short TTL cache. Unreachable candidates are not returned to the UI, which satisfies automatic removal without overlay-local URL state.

Selection is promotion, not a separate active row: choosing a candidate calls the existing `PUT /target` route with its URL. That bumps the matching artifact's update time and makes it the selected target on the next resolve.

## Tests

- Unit: extractor returns all loopback URLs, including scheme-less local dev URLs, without external URLs.
- Unit: duplicate target saves reuse the same artifact and promote by `time_updated`.
- Route: `GET /browser-preview` returns reachable candidates and omits dead ones.
- Tool: generic tool output and background shell output containing local URLs persist preview candidates.
- Overlay service/panel: service type exposes candidates; panel uses a native select backed by `loadTaskBrowserPreviewTarget` and `saveTaskBrowserPreviewTarget`.
