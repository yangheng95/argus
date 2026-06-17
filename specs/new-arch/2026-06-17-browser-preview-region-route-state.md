# Browser Preview Region Route State

Date: 2026-06-17

## Problem

Region comparison runtime capture reused the browser preview evidence runner sidecar, but the sidecar compared each binding route only against the first route for a viewport. A binding sequence such as `/a`, `/b`, `/a` navigates to `/a`, then `/b`, then incorrectly skips the third navigation because the third binding equals the first route, leaving the page on `/b`.

This can bind source regions to the wrong implementation page or persist a failed comparison for a valid locator.

## Recall

- `specs/new-arch/2026-06-15-gui-benchmark-quality-audit.md` moved browser preview region implementation capture into `browser-preview/evidence-runner.ts`.
- `specs/new-arch/2026-06-16-local-module-source-binding.md` keeps `browser_preview_compare_regions` as the consumer once a binding exists; the crop must point at the correct local module.
- Existing dirty worktree edits in `region-comparison.ts` and `region-comparison.test.ts` are unrelated to this route-state fix and must not be included in this commit.

## Callsite Inventory

`rg "firstRoute|binding\\.route|page\\.goto|runBrowserPreviewRegionComparisonCapture|BrowserPreviewRegionBinding" packages/opencorvus/src/browser-preview packages/opencorvus/test/browser-preview -S`

| Area | Finding | Decision |
| --- | --- | --- |
| `src/browser-preview/evidence-runner.ts` sidecar script | Uses `firstRoute` for all route comparisons in the per-viewport binding loop. | Track `currentRoute` after each navigation and compare each binding against that actual current route. |
| `src/browser-preview/region-comparison.ts` | Delegates capture to `runBrowserPreviewRegionComparisonCapture`; no route loop ownership. | Leave unchanged. |
| `test/browser-preview/region-comparison.test.ts` | Existing file has unrelated dirty edits. | Do not edit. |
| `test/browser-preview/evidence-runner.test.ts` | Static contract tests only. | Add a separate browser-side regression test file for `/a -> /b -> /a`. |
| Root `test-preload.ts` | `bun test` from the repo root uses a per-PID temp directory but did not remove a pre-existing directory before setting `OPENCORVUS_HOME`. PID reuse can expose stale database schema and break targeted verification. | Recreate the per-PID temp root at preload startup and cover this with a static tooling test. |

## Acceptance

- A same-viewport binding sequence can navigate away from the first route and then back to it.
- The test must exercise real Playwright sidecar capture through persisted browser preview target state.
- No fallback, compatibility path, gate, or route allowlist is introduced.
