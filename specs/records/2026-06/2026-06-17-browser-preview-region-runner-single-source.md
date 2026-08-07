# Browser Preview Region Runner Single Source - 2026-06-17

## Acronyms

- API: Application Programming Interface, the server/tool contract that starts region comparison.
- GUI: Graphical User Interface, the visible browser preview and overlay surfaces.
- ID: Identifier, a persisted task, target, evidence, or artifact key.
- URL: Uniform Resource Locator, the browser preview target address.

## Problem

The 2026-06-15 GUI quality audit records that browser preview region comparison
must use the browser evidence runner as the single owner for Node/Playwright
runtime capture. Current code still has a second implementation in
`browser-preview/region-comparison.ts`: it accepts a direct `url`, creates its
own runtime output directory, launches a Node sidecar, and embeds a duplicate
Playwright script.

That preserves two sources for target URL, output directory ownership, and
sidecar behavior beside `browser-preview/evidence-runner.ts`.

## Evidence Sweep

Command:

```powershell
rg -n "runImplementationCapture|REGION_COMPARISON_SCRIPT|runBrowserPreviewRegionComparisonCapture|BrowserPreviewRegionComparisonInput|url:" packages/opencorvus/src/browser-preview packages/opencorvus/test/browser-preview packages/opencorvus/src/server/routes/browser-preview.ts packages/opencorvus/src/tool/region-comparison-tool.ts -g "*.ts"
```

Findings:

| Surface                       | Evidence                                                                                                                               | Decision                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Product function input        | `BrowserPreviewRegionComparisonInput` contains `url: string`.                                                                          | Remove direct URL input; `taskID/targetID` are the product authority.               |
| Server route                  | `/task/:taskID/browser-preview/compare` looks up target then passes `url: target.url`.                                                 | Keep target existence check if useful for 404, but do not pass URL into comparison. |
| Tool route                    | `region comparison tool` looks up target then passes `url: target.url`.                                                       | Keep missing-target error, but do not pass URL into comparison.                     |
| Region implementation capture | `region-comparison.ts` owns `runImplementationCapture` and `REGION_COMPARISON_SCRIPT`.                                                 | Delete them and call `runBrowserPreviewRegionComparisonCapture`.                    |
| Evidence runner               | `evidence-runner.ts` already exposes `runBrowserPreviewRegionComparisonCapture` and resolves target URL / output directory internally. | Use this runner as the single runtime capture source.                               |

## Fix

1. Import `runBrowserPreviewRegionComparisonCapture` from
   `browser-preview/evidence-runner.ts`.
2. Remove `url` from `BrowserPreviewRegionComparisonInput`.
3. Replace `runImplementationCapture(...)` with
   `runBrowserPreviewRegionComparisonCapture({ projectRoot, taskID, targetID,
viewportIDs, bindings, includeFullpageOverview, signal })`.
4. Delete duplicate sidecar imports, binding types, `runImplementationCapture`,
   and `REGION_COMPARISON_SCRIPT` from `region-comparison.ts`.
5. Update server route, tool execution, and tests so comparison calls do not pass
   direct URL.
6. Add source-level regression assertions that `region-comparison.ts` no longer
   contains the duplicate sidecar/script and imports the runner.

## Acceptance

- `compareBrowserPreviewRegions` derives runtime capture from `taskID/targetID`
  through the evidence runner.
- `region-comparison.ts` has no `runBrowserNodeSidecar`,
  `resolveBrowserNodeSidecarRuntime`, `BrowserRuntime`,
  `runImplementationCapture`, or `REGION_COMPARISON_SCRIPT`.
- Server and tool callers do not pass URL into `compareBrowserPreviewRegions`.
- Existing region comparison behavior still persists side-by-side evidence.
- Targeted browser-preview region comparison tests pass.
- Typecheck remains clean for the touched package.
