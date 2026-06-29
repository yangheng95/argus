# Browser Preview Target Diagnostics and Selection

Date: 2026-06-14

## Problem

The overlay Preview panel is task-scoped and must use backend `browser_preview_target` / `browser_preview_evidence` artifacts as the single source. Clicking an HTTP link in a message currently opens the Preview panel and refreshes it, but does not save that URL as a preview target. That behavior is correct.

The current failure mode is misleading:

- `resolveBrowserPreviewTarget` filters unreachable saved targets before deciding whether the task has a target, so a task with saved but unreachable targets is reported as `missing`.
- `browser_preview` can persist multiple startup candidates in nondeterministic order, allowing stdout or command-derived URLs to override an explicit URL.
- The overlay panel hides first-frame live snapshot errors behind an evidence placeholder, which makes a failed preview look like no preview exists.

## Constraints

- No iframe, query override, local signal, or click-to-save URL path may be added.
- The backend task artifact remains the only preview target source.
- Ordinary `bash`, session shell output, and generic tool output must not materialize preview targets.
- `browser_preview` is the explicit product tool that may inspect startup output and persist task preview targets.
- No fallback target source is allowed. Diagnostics must expose the true state instead of substituting another source.

## Call Point Audit

| Area                              | File                                                       | Decision                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Target resolver                   | `packages/opencorvus/src/browser-preview/target.ts`        | Change unreachable saved targets from `missing` to `failed`; keep saved candidates visible.                                                            |
| Liveness probe                    | `packages/opencorvus/src/browser-preview/liveness.ts`      | Keep as the single reachability probe source.                                                                                                          |
| Target persistence                | `packages/opencorvus/src/browser-preview/persist.ts`       | Keep schema and write path; do not add alternate persistence source.                                                                                   |
| URL extraction/persistence kernel | `packages/opencorvus/src/browser-preview/extract.ts`       | Change candidate persistence to sequential, source-aware selection for `browser_preview`; keep generic callers from using it for auto target creation. |
| Explicit preview tool             | `packages/opencorvus/src/tool/browser-preview.ts`          | Validate explicit URL before starting the service; choose targets deterministically; return structured candidate diagnostics.                          |
| Generic bash                      | `packages/opencorvus/src/tool/bash.ts`                     | Do not add preview persistence. Existing stale tests must be corrected.                                                                                |
| Session shell                     | `packages/opencorvus/src/session/shell-exec.ts`            | Do not add preview persistence. Existing stale tests must be corrected.                                                                                |
| Preview routes                    | `packages/opencorvus/src/server/routes/browser-preview.ts` | Preserve task-scoped routes; add structured live snapshot/input errors if needed.                                                                      |
| Link click handler                | `packages/overlay/src/main.tsx`                            | Keep click behavior as open/refresh only.                                                                                                              |
| Overlay service                   | `packages/overlay/src/services/browser-preview.ts`         | Keep backend routes; ensure UI gets real diagnostics.                                                                                                  |
| Preview panel                     | `packages/overlay/src/components/BrowserPreviewPanel.tsx`  | Show target loading, unreachable, and first live snapshot failure as distinct states.                                                                  |

## Acceptance Tests

- Backend resolver returns `missing` only when no target artifact exists.
- Backend resolver returns `failed` with saved URL/candidates when all saved targets are unreachable.
- Backend resolver keeps unreachable candidates visible when another candidate is selected.
- `browser_preview` validates explicit URL before starting a process.
- `browser_preview` does not let stdout or command-derived URLs override an explicit URL.
- Command-derived URLs are diagnostics unless selected by the deterministic rule.
- Ordinary `bash` and `SessionShell` output do not create `browser_preview_target`.
- Overlay click on `data-browser-preview-url` opens/refreshes Preview but does not save URL.
- Overlay stage shows loading while target is loading and shows live snapshot failure on first-frame failure.
