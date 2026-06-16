# Browser Preview Live Target Boundary Fix

Date: 2026-06-15
Status: Implementation plan

## Acronyms

- API: Application Programming Interface, the backend route contract consumed by the overlay.
- ID: Identifier, the task or artifact key used to resolve persisted records.
- PNG: Portable Network Graphics, the binary image format returned by live preview snapshots.
- UI: User Interface, the visible overlay preview panel.

## Problem

The browser preview live panel can submit `POST /task/:taskID/browser-preview/live/snapshot` with the current task ID and a stale preview target ID retained from a previous `createResource` value. The backend correctly rejects the request because preview targets are task-scoped artifacts. The overlay then displays the JSON error response as a byte-indexed object because live snapshot requests expect a binary PNG response.

## Call Point Sweep

| Surface | Evidence | Action |
| --- | --- | --- |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx` `currentTarget` | Reads `target()` without proving `target.taskID` still matches `props.taskID()` while a new resource request is loading. | Return no target when the resolved target belongs to another task; live snapshot must not mix task and target IDs. |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx` `renderedEvidence` | Reads the last verification result as long as `verification()` and `verificationRequest()` exist, without proving the request still matches the current task and selected target. | Render verification evidence only when `request.taskID` and `request.targetID` match the current panel scope; clear stale verification requests after task or target changes. |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx` `loadLiveFrame` | Shows `String(error)` and keeps the previous live image after a target-not-found failure. | Decode the service error and refresh task target state after a live target miss; do not invent a replacement target. |
| `packages/overlay/src/services/browser-preview.ts` binary helpers | Throw `ApiError` with a raw `Uint8Array` body for failed PNG endpoints. | Decode JSON or text error bodies before constructing `ApiError`. |
| `packages/overlay/src/main.tsx` `TaskList.onSelectTask` | Re-clicking the already selected task reset the center workbench to workflow before `selectTask()` could take its idempotent no-op path. | Route task row selection through a helper that only resets the workbench when the selected task ID changes. |
| `packages/overlay/test/browser-preview-service.test.ts` | Covers happy-path binary live preview requests. | Add failure coverage for decoded JSON error bodies. |
| `packages/overlay/test/browser-preview-panel.test.ts` | Source contract already guards task-scoped backend paths. | Add source assertions for task-ID target binding and live target refresh after miss. |
| Codex review feedback, 2026-06-15 | `rg "resolveBrowserPreviewTarget|assessBrowserPreviewTargets|promoteBrowserPreviewTarget|findRecentBrowserPreviewTargets|selected" packages/opencorvus/src/browser-preview packages/opencorvus/test/browser-preview packages/opencorvus/test/orchestrator packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-service.test.ts` found `resolveBrowserPreviewTarget()` selecting the first reachable candidate instead of the persisted selected target. | The selected target artifact is the single authority. Reachability can mark that target `failed`; it must not silently switch to another reachable saved candidate. |

## Acceptance

- The overlay never combines a current task ID with a browser preview target resolved for another task.
- The overlay never displays verification evidence captured for a different task or preview target.
- The backend never replaces the selected browser preview target with another saved candidate solely because the selected target is unreachable.
- Live snapshot and live input failures with JSON error bodies render the backend message, not a byte-indexed object.
- A target-not-found live failure triggers a backend target re-resolve through the existing task-scoped route.
- Clicking the already selected task row does not close an automatically opened Preview panel.
- No URL guessing, iframe fallback, direct fetch, or non-task preview source is introduced.
