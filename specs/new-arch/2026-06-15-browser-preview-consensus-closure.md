# Browser Preview Consensus Closure

Date: 2026-06-15
Status: independent-agent consensus record

> 2026-06-17 follow-up: the manual URL branch was retired, not implemented.
> Current browser-preview route tests reject direct URL request bodies, and the
> strict request-schema note keeps task-scoped preview target/evidence as the
> only source.

## Acronyms

- UI: User Interface, the visible overlay toolbar and preview panel.
- URL: Uniform Resource Locator, the HTTP(S) address loaded by the backend browser preview sidecar.
- MCP: Model Context Protocol, the external tool protocol used by browser/tool integrations.
- E2E: End-to-End, a test that covers the real user-visible chain across backend and overlay.
- PNG: Portable Network Graphics, the screenshot image format returned by preview evidence/live routes.
- SDK: Software Development Kit, the generated client contract under `packages/sdk`.

## Consensus

The current browser preview mechanism is not a coherent user trigger. The right
toolbar Browser activity only opens a workbench panel. It does not create or
select a preview target. The panel can render only after the backend has a
task-scoped `browser_preview_target` artifact.

The long-term invariant is:

- Preview target and evidence are owned by backend task artifacts:
  `browser_preview_target` and `browser_preview_evidence`.
- The overlay never uses iframe, query parameter, local signal, package metadata,
  clicked message URL, or command-derived guess as a preview source.
- Ordinary `bash`, session shell, generic tool output, and MCP textual output do
  not create preview targets.
- The explicit `browser_preview` tool is the only automation path that may start
  a long-lived preview service and persist a target from its explicit URL or its
  own startup output.
- Operator-entered URL was unresolved in this consensus record. It was later
  resolved by formally retiring the 2026-06-11 manual URL spec and keeping
  route tests that reject direct URL bodies.

## Independent Findings

Four read-only agents inspected disjoint surfaces.

| Agent scope            | Consensus finding                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend trigger chain | `RIGHT_ACTIVITIES` registers `browser`; clicking it toggles `centerWorkbenchPanels`. `BrowserPreviewPanel` is mounted at startup, loads target when `taskID` and directory exist, and only starts live/capture when the resolved target is ready. Message HTTP links open/refresh the panel but do not save the clicked URL. |
| Backend target chain   | Production target writes flow through `persistBrowserPreviewTarget`, `promoteBrowserPreviewTarget`, and explicit `BrowserPreviewTool`. Ordinary bash/session/MCP output currently does not write target. `browser_preview` scans `startup.metadata.output` only after background bash returns.                               |
| Spec history           | 2026-06-10/11 automatic stream materialization was superseded by 2026-06-12 explicit tool and 2026-06-14 diagnostics. At the time of this record, the manual URL input spec was not explicitly superseded even though implementation/tests contradicted it.                                                                  |
| Tests and gaps         | Tests lock individual pieces but no E2E covers `browser_preview` tool -> target artifact -> `task.updated` -> overlay toolbar open -> live PNG visible. Existing browser tests mock the backend target and PNG instead of proving real target creation.                                                                      |

## Root Causes

### 1. Trigger vocabulary is misleading

The toolbar is a view toggle. It is not a preview target creation trigger. When
no saved target exists, opening Browser can only show a missing state.

Relevant call points:

| Surface                                                   | Current behavior                                                |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/overlay/src/main.tsx` `RIGHT_ACTIVITIES`        | Registers `browser` as a right toolbar activity.                |
| `packages/overlay/src/components/SideActivityToolbar.tsx` | Button click calls `onSelect(activity.id)`.                     |
| `packages/overlay/src/main.tsx` `selectRightActivity`     | Toggles `centerWorkbenchPanels`; does not persist target.       |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx` | Resolves target from backend route; does not infer URL locally. |

### 2. Real dev-server startup can miss the persistence window

`browser_preview` starts a background bash command and then scans
`startup.metadata.output`. Background bash waits only the readiness window before
returning. If a real dev server prints the URL after that window, the tool sees
no URL and persists no target. If the URL is printed before the app is actually
reachable, the one reachability probe may fail and no retry is attached to the
long-lived process output.

This explains a real-world path where a service is running but the toolbar never
shows a preview: the task never receives a `browser_preview_target`.

Relevant call points:

| Surface                                               | Current behavior                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/opencorvus/src/tool/browser-preview.ts`     | Scans only the `startup.metadata.output` returned by background bash.    |
| `packages/opencorvus/src/tool/bash.ts`                | Background command returns after readiness wait while process continues. |
| `packages/opencorvus/src/browser-preview/liveness.ts` | Reachability probing is bounded and not tied to later stream activity.   |

### 3. Manual URL is a contradictory contract

The manual URL input plan requires the operator to submit a URL and have it
persisted as a task-scoped target. Current route, overlay service, tests, and
SDK contract instead require `targetID` and reject arbitrary URL bodies.

This is not a harmless missing feature. It leaves no reliable operator path to
repair a missed target from the toolbar without asking an agent to rerun
`browser_preview`.

Relevant conflict:

| Source                                                           | Claim                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `specs/new-arch/2026-06-11-browser-preview-manual-url-input.md`  | `PUT /task/:taskID/browser-preview/target` should accept exactly one of `targetID` or `url`. |
| `packages/opencorvus/src/server/routes/browser-preview.ts`       | Current validator accepts only `{ targetID }`.                                               |
| `packages/opencorvus/test/server/browser-preview-routes.test.ts` | Current test expects `{ url }` to be rejected.                                               |
| `packages/overlay/test/browser-preview-panel.test.ts`            | Current source test expects no `url: input.url`.                                             |

### 4. Right toolbar state still has a residual second source

The 2026-06-14 right-toolbar record says stale `selectedRightActivity` was
removed and active state derives from open panels. Current code and tests still
keep `selectedRightActivity`. The visible active state is mostly derived through
`isRightActivityOpen`, so this is not the primary preview blank root, but it is a
remaining double source and must be removed in the cleanup pass.

### 5. Tests do not cover the complete observable chain

Existing tests prove isolated contracts:

- Backend resolver reads task artifacts.
- Ordinary shell/tool output does not create preview targets.
- `browser_preview` can persist from immediate printed URL or explicit URL.
- Overlay can render a mocked target and PNG.
- Toolbar can open a panel.

They do not prove the user-visible chain:

`browser_preview(command)` -> persisted target -> task update -> overlay refresh
-> right toolbar opens -> live screenshot is nonblank.

## Decisions

1. Keep task-scoped backend artifact as the single source for preview.
2. Keep the explicit `browser_preview` tool as the only automated startup owner.
3. Do not reintroduce ordinary bash/session/MCP output materialization.
4. Do not use iframe, query override, local signal, clicked link, package metadata,
   or command-derived URL as preview source.
5. Repair `browser_preview` startup capture so real long-running servers do not
   lose late or briefly-unreachable URLs.
6. Resolve manual URL as an explicit backend artifact write or retire the
   2026-06-11 spec. This record originally preferred implementation; the
   2026-06-17 follow-up chose retirement to keep the strict backend artifact
   contract.
7. Remove residual `selectedRightActivity` after the preview behavior is pinned
   by tests, so toolbar active state has one source.

## Repair Plan

### Backend

- Refactor `browser_preview` target creation around a single explicit startup
  observer that can inspect output during the background readiness window and
  continue until a real activity-based startup deadline is reached.
- The observer must persist only through `persistBrowserPreviewTarget`.
- Explicit `url` remains deterministic owner: when provided and reachable, it is
  persisted and printed URLs are diagnostics.
- Command-derived URL remains diagnostic unless the manual URL contract is used
  explicitly.
- Add tests for delayed stdout URL, output before reachability, and no ordinary
  bash/session/MCP materialization.

### Manual URL Contract

Resolved on 2026-06-17 by choosing the retire branch and keeping code, tests,
SDK, and docs aligned:

- Retire: mark the 2026-06-11 manual URL spec superseded and keep current tests
  rejecting URL bodies.

### Frontend

- Keep `BrowserPreviewPanel` reading only `GET /task/:taskID/browser-preview`.
- Add a compact URL submission control only if the manual URL contract is
  implemented; it must call the backend target route and then refresh from the
  resolved target.
- Show explicit missing/failed/live-error states for toolbar open with no target,
  unreachable target, and live snapshot failure.
- Remove `selectedRightActivity`; derive right toolbar active state from
  `centerWorkbenchPanels` and primary workflow state only.

### Tests

Required coverage:

- `browser_preview(command)` with delayed printed reachable URL persists target.
- `browser_preview(command, url)` keeps explicit URL ahead of printed URLs.
- `browser_preview(command only)` with command-derived URL only persists nothing
  and returns visible diagnostics.
- Ordinary bash, session shell, generic tool output, and MCP textual output with
  localhost URLs persist nothing.
- Target route manual URL behavior matches the chosen contract.
- Overlay service and SDK/OpenAPI match the chosen target schema.
- Right toolbar click with no target shows missing state.
- Right toolbar click with ready target renders nonblank live PNG.
- Message HTTP link opens/refreshes Preview and does not persist the clicked URL.
- First live snapshot failure renders `browser-preview-live-error`.
- Candidate selection sends `targetID` and reloads live snapshot.
- Node-driven Playwright E2E opens the real overlay preview region and verifies
  a nonblank PNG for the ready path.

## Acceptance

This closure is accepted only when:

- The contradictory manual URL state is resolved in code, tests, SDK/OpenAPI, and
  specs.
- `browser_preview` cannot miss a normal dev server URL solely because it printed
  after the initial background readiness window.
- The right toolbar Preview panel has a deterministic visible result for missing,
  failed, ready, and live-error states.
- The full real chain is covered by at least one Node-driven E2E, not just mocked
  backend tests.
- The final review checks the rendered preview screenshot, not only typecheck or
  unit tests.
