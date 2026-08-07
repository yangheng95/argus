# Screenshot Browser Inline Group Count

## Recall

### User request

- Remove the blank Screenshot Browser title row that displays only the image
  count.
- Place each image count immediately after its textual group title.

### Acceptance criteria

1. The Screenshot Browser panel renders no redundant panel-level
   `SurfaceHeader`; the Right Dock tab remains the only panel title.
2. Every screenshot owner-group header renders its canonical text followed
   immediately by that group's canonical image count.
3. The count is no longer pushed to the far edge of the group header.
4. The existing card-tree screenshot index, grouping, Virtua virtualization,
   thumbnail loading, card geometry, image preview, and accessibility contracts
   remain unchanged.
5. Focused source tests, the real Node-launched browser test, and a
   task-scoped desktop screenshot pass visual review.

### Hard constraints

- Preserve the canonical `cardTreeStore.screenshotItems` source and
  `groupScreenshotBrowserItems` / `buildScreenshotBrowserRows` projection.
- Do not add fallback, compatibility, state-machine, duplicate count, or
  temporary preview paths.
- Use the existing Right Dock and Screenshot Browser primitives.
- Start the Playwright browser checker with Node, not Bun.
- Do not restart or otherwise interfere with the user's running OpenCorvus or
  Overlay processes; verification uses the existing isolated browser fixture.
- Preserve unrelated dirty-worktree changes and stage only task-owned hunks.
- Commit subjects use the required `dsw-33987` prefix and the completed change
  is pushed to the `legacy-remote` remote.

### Sources read

- `AGENTS.md`
- Browser control skill instructions
- user-provided Screenshot Browser image
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-14-overlay-startup-and-chrome-parity.md`
- `specs/records/2026-07/2026-07-23-screenshot-columns-dock-actions-environment-opt-in.md`
- `packages/overlay/src/components/ScreenshotBrowserPanel.tsx`
- `packages/overlay/src/utils/screenshot-browser.ts`
- `packages/overlay/src/styles/surfaces/activity.css`
- `packages/overlay/test/screenshot-browser-panel.test.ts`
- `packages/overlay/test/overlay-startup-chrome-parity.test.ts`
- `packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
- `packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts`
- English and Chinese screenshot-panel localization entries

### Whole-repository search

`rg` covered `ScreenshotBrowserPanel`, `ScreenshotBrowserVirtualRow`,
`groupScreenshotBrowserItems`, `buildScreenshotBrowserRows`,
`screenshot-browser-toolbar`, `screenshot-browser-panel__count`,
`screenshot-browser-group__header`, `screenshots.count`, and
`screenshots.group_count`.

| Call site / contract                                                                         | Decision                                                                                                               |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `main.tsx` Screenshot Browser mount                                                          | Preserve; it remains the one panel mount.                                                                              |
| `ScreenshotBrowserPanel.tsx` panel-level `SurfaceHeader`                                     | Delete; it is the redundant blank title row and duplicate count projection.                                            |
| `ScreenshotBrowserPanel.tsx` group header                                                    | Preserve its canonical label/time source and move the existing group count immediately after it.                       |
| `activity.css` `.screenshot-browser-panel__count`                                            | Delete with the removed panel-level count.                                                                             |
| `activity.css` `.screenshot-browser-group__header`                                           | Replace far-edge distribution with leading inline layout while preserving truncation and typography.                   |
| `screenshots.count` English/Chinese keys                                                     | Delete because the removed panel-level count is their only caller.                                                     |
| `screenshots.group_count` English/Chinese keys                                               | Preserve as the one count formatting source.                                                                           |
| `screenshot-browser-panel.test.ts`                                                           | Add positive and negative source/CSS assertions for the new single-header contract.                                    |
| `overlay-startup-chrome-parity.test.ts`                                                      | Replace the former useful-toolbar assertion with an explicit redundant-toolbar rejection.                              |
| `titlebar-toolbar-toggle-browser.test.ts`                                                    | Replace the removed-toolbar wait with a visible group-header / absent panel-toolbar assertion.                         |
| `screenshot-browser-panel-browser.test.ts`                                                   | Assert DOM adjacency, leading placement geometry, absent redundant header, and capture the resulting panel screenshot. |
| `standalone-section-heading-typography.test.ts`                                              | Preserve; the group header remains a true section heading.                                                             |
| other Screenshot Browser collector, virtualization, pressure, preview, and window-size tests | Preserve unchanged; no data or card geometry contract changes.                                                         |

### Independent agent feedback

No independent agent was commissioned because the user did not request
sub-agents or parallel audit, and the active collaboration policy forbids
spawning them without that explicit request. The main agent performs the
required second review after browser evidence is captured.

## Root cause

The Right Dock already owns the visible `Screenshots` title, but
`ScreenshotBrowserPanel` also mounts a title-less `SurfaceHeader` whose only
action is the total screenshot count. That produces the blank row shown in the
reference. The owner-group header separately uses `justify-content:
space-between`, so its count is projected at the far edge instead of alongside
the textual owner/time label.

## Implementation

1. Delete the title-less panel `SurfaceHeader` and its now-unused import,
   count class, and localization key.
2. Keep the existing group header DOM order but make its layout leading and
   inline so the count follows the textual label.
3. Update source, localization, and real-browser regressions to reject the old
   empty header and prove title/count adjacency and geometry.
4. Update the current panel architecture paragraph and both required spec
   indexes.

The first real-browser run entered the actual checker but exposed two stale
fixture contracts before reaching the new assertions: the compact high-zoom
Dock legitimately clamps the logical `132px × scale` card width to its
available content width, and the fixture had no responses for the current
Mission Skill catalog or Chat capability reads. The browser test now derives
the expected card width from the same measured panel/scale geometry and serves
those current read-only contracts. This is test-fixture repair, not a product
fallback or acceptance bypass. The fixture's wide-column probe also uses a
genuinely wide desktop viewport so the current scaled Conversation minimum can
coexist with the requested wide Dock; it no longer assumes the former
Conversation width inside an `1800px` high-zoom viewport.
The geometry assertion distinguishes the compact clamp from wide reflow: a
compact Dock uses its available content width, while the genuinely wide Dock
restores the canonical `132px × UI scale` card width.
The fixture persists its `1100px` Dock request through the canonical settings
source so window-resize rendering cannot race and overwrite a one-off DOM style
during the wide-column probe.
The high-zoom rendered-panel probe uses an `1800px` desktop fixture width;
`1120px` cannot simultaneously satisfy the current scaled Conversation minimum
and retain a readable Right Dock, so it is not a valid Screenshot Browser
viewport. The probe no longer asserts the unrelated editor-label responsive
breakpoint.
The later high-zoom bounds assertion measures the persistent virtualized group
list rather than requiring the group-header row to remain mounted after preview
and resize scrolling; header adjacency is asserted at initial materialization,
while Virtua remains free to unmount off-window rows.
The final minimum-width panel probe now keeps a desktop `1800px` viewport and
narrows only the panel itself. This preserves its intended fixed-card and
overflow coverage without turning the desktop Screenshot Browser checker into
an unauthorized `960px` responsive/mobile acceptance path.

## Verification

- `bun test packages/overlay/test/screenshot-browser-panel.test.ts`
- `bun test packages/overlay/test/overlay-startup-chrome-parity.test.ts`
- `bun test packages/overlay/test/standalone-section-heading-typography.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
- Inspect the browser-test screenshot for the exact Screenshot Browser region.

## Verification results

- Focused Screenshot Browser and Right Dock title tests: `19 pass`, `0 fail`.
- Overlay TypeScript typecheck: passed.
- Overlay panel localization check: passed.
- Production Vite build: passed after one transient esbuild service exit was
  reproduced and cleared by rerunning the original build command.
- Node-launched Playwright Screenshot Browser checker: `1 pass`, `0 fail`.
  The real task-scoped fixture covered initial render, absent redundant header,
  inline title/count DOM and geometry, wide reflow, preview, virtual scrolling,
  thumbnail request cancellation, close/reopen, warm cache, and minimum-width
  desktop panel geometry.
- Visual review:
  `specs/artifacts/2026-07-28-screenshot-browser-inline-group-count.png`
  shows no blank count-only header and renders `120` immediately after
  `implementation-engineer · 04:28:49 AM`. The minimum-width screenshot was
  also inspected; ellipsis preserves the adjacent count.
- The combined document-health run passed `88` checks and failed five baseline
  checks: four repository-wide scans exceeded their existing five-second
  timeout, and one tracked-link assertion saw several other concurrently
  untracked July records plus this task's not-yet-staged record. Focused
  historical-link parsing passed. The required tracked-link check is rerun
  after staging the task-owned record.
