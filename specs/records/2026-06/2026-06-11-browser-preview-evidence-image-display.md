# Browser Preview Evidence Image Display

Date: 2026-06-11
Status: Implementation plan

## Acronyms

- PNG: Portable Network Graphics, the screenshot image format written by the Playwright sidecar.
- URL: Uniform Resource Locator, the address of the saved backend preview target.
- CSP: Content Security Policy, the browser/webview policy that blocks frame-based preview in VS Code.

## Evidence

The preview target is now discovered, but `BrowserPreviewPanel` does not render a page image. When `targetUrl()` exists, the current UI shows `browser-preview-evidence-missing` with a capture prompt and the URL. When evidence exists, the panel renders summary, diagnostics, and `capture.path` text only. The backend capture pipeline writes PNG screenshots to `capture.path`, but no HTTP route exposes those bytes to the overlay.

## Call Points

| Symbol / file                                                                                    | Current behavior                                                                | Decision                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `findReadableBrowserPreviewEvidenceByID` in `packages/opencorvus/src/browser-preview/persist.ts` | Validates persisted evidence and artifact readability.                          | Reuse it for evidence metadata and add an exported helper that returns the readable capture artifact path. |
| `BrowserPreviewRoutes` in `packages/opencorvus/src/server/routes/browser-preview.ts`             | Returns target JSON, evidence JSON, and capture JSON.                           | Add a task-scoped evidence PNG endpoint backed by persisted evidence only.                                 |
| `loadTaskBrowserPreviewEvidence` in `packages/overlay/src/services/browser-preview.ts`           | Loads evidence JSON through `apiJson`.                                          | Add a binary HostTransport loader for the evidence PNG and convert it to an object URL in the component.   |
| `BrowserPreviewPanel` in `packages/overlay/src/components/BrowserPreviewPanel.tsx`               | Shows empty state after target resolution and text-only evidence after capture. | Auto-capture a saved target once per target/viewport set and render the current viewport screenshot image. |
| `packages/overlay/test/browser/browser-preview-evidence.test.ts`                                 | Asserts text evidence only.                                                     | Require screenshot image rendering and binary image route use.                                             |

## Design

The UI remains evidence-backed and does not embed a live iframe. The saved task preview target remains the single source for capture, and the displayed image is the Playwright sidecar PNG persisted as browser preview evidence. Binary loading goes through `HostTransport` so directory context and authorization use the same path as JSON APIs.

## Tests

- Server route returns PNG bytes only for readable persisted browser preview evidence.
- Overlay service requests the task-scoped evidence PNG route as binary with directory context.
- Browser panel auto-captures a ready target and renders the current viewport PNG image.
