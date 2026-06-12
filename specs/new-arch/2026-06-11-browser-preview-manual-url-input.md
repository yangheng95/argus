# Browser Preview Manual URL Input

Date: 2026-06-11
Status: Implementation plan

## Acronyms

- URL: Uniform Resource Locator, the absolute browser address loaded by the backend Playwright preview.
- UI: User Interface, the overlay controls used by the operator.
- SDK: Software Development Kit, the generated client and OpenAPI contract under `packages/sdk`.

## Requirement

The overlay browser preview must let an operator type a preview URL manually. It must accept explicit `http://` / `https://` URLs, scheme-less loopback URLs such as `localhost:5173`, and external HTTP(S) links. The typed value must become a task-scoped backend preview target artifact before the panel renders, captures, or sends live input.

## Call Point Sweep

| Symbol / route | Call points | Action |
| --- | --- | --- |
| `normalizeBrowserPreviewUrl` | `browser-preview/target.ts`, `browser-preview/extract.ts`, `dev-server-command.ts`, `browser-preview/target.test.ts` | Reuse unchanged. It already accepts explicit HTTP(S) URLs and scheme-less loopback host-port text. |
| `persistBrowserPreviewTarget` | extraction, shell/tool materialization, route tests, verification tests | Reuse for manual input so the target artifact remains the single source. |
| `PUT /task/:taskID/browser-preview/target` | overlay service, backend route tests, SDK/OpenAPI route contract | Accept exactly one of `targetID` or `url`; `targetID` promotes an existing artifact, `url` normalizes and persists a task artifact. |
| `selectTaskBrowserPreviewTarget` | `BrowserPreviewPanel.tsx`, overlay service tests, browser E2E fixture | Keep for targetID selection and extend input shape to include URL submit. |
| `BrowserPreviewPanel` | mounted from `main.tsx`, source tests, browser E2E fixture | Add a compact URL form in the command surface; submit calls the backend target route, then refreshes the resolved target. |
| live/capture routes | service tests and browser E2E fixture | Keep targetID-only. Manual URLs must not be passed to live/capture bodies. |

## Design

The manual input is not a local frame override. Submitting the field calls the same task route that promotes dropdown candidates. The backend validates and normalizes the URL, persists or promotes the matching `browser_preview_target` artifact, and returns the normal `BrowserPreviewTarget` response. The panel refreshes from `GET /task/:taskID/browser-preview`, so the selected URL, candidates, live snapshot, and evidence capture all continue to use persisted target IDs.

Invalid URLs return a failed `BrowserPreviewTarget` with status 400. This is validation at the data boundary, not a flow gate.

## Tests

- Backend route test for manual `localhost:5173` input becoming `http://localhost:5173/`.
- Backend route test for external HTTPS input.
- Backend route test that invalid non-HTTP(S) input is rejected.
- Overlay service test that URL submit sends `{ url }` and does not put URLs in live/capture bodies.
- Overlay panel source test that the URL form exists while iframe/query/local overrides remain absent.
