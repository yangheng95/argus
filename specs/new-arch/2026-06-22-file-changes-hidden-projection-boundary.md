# File Changes Hidden Projection Boundary

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.

## Task Definition

Continue the screenshot toolbar jank audit by removing hidden file-changes
projection work from the screenshot panel open path.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, test every change, visually verify UI changes, and commit/push each round. |
| `2026-06-22-screenshot-browser-open-jank.md` | Screenshot panel rendering, thumbnail loading, and resize measurement are already bounded; do not add a second screenshot source. |
| `2026-06-22-screenshot-browser-top-level-index.md` | Screenshot toolbar open must not re-read `cardTreeStore.order/cards` from the screenshot panel. |
| `2026-06-19-deep-performance-investigation.md` | Always-mounted hidden panels must not prefetch or materialize broad resources. |
| `2026-06-19-overlay-diff-poll-pressure.md` | File changes request keys should depend on narrow diff group revisions, not broad board/card state. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| File changes mount | `main.tsx` always renders `FileChangesPanel` into `#solidFileChangesMount`. | Keep the mount owner, but pass a real active accessor from center workbench file/diff visibility. |
| File changes body | `FileChangesPanel` always renders `ChangesPanel` in the changes `TabPanel`. | Pass the active accessor through; do not add a second file changes owner. |
| Changes projection | `ChangesPanel.agentGroups` reads `cardTreeStore.order` and `cardTreeStore.cards`. | Return an empty inactive projection before touching card tree. |
| Diff resource key | `ChangesPanel.requestKey` includes `changeGroupsRevisionKey(agentGroups())`. | Return `false` while inactive so `createResource` does not resolve current change groups. |
| Visible behavior | File changes/diff panel still needs the same merged groups and row click diff resolution when opened. | Preserve the existing source and merge logic when active. |
| Tests | `agent-file-changes.test.ts` and `acceptance-panel-mount.test.ts` pin the current mount owner and projection source. | Extend them to require the hidden active boundary and main active wiring. |

## Root Cause

Screenshot-specific work is now bounded, but opening screenshots still happens
inside a shell where hidden always-mounted panels can react to card-tree
updates. `ChangesPanel` is one high-confidence path: its agent-file projection
reads every top-level card and builds a diff request key even when the
file/diff center workbench panels are closed. That broad hidden projection can
run during the same operator action that opens screenshots.

## Fix Plan

1. Add an `active: () => boolean` prop to `FileChangesPanel`.
2. Pass `active` from `main.tsx` as `isCenterWorkbenchPanelOpen("file") ||
   isCenterWorkbenchPanelOpen("diff")`.
3. Add an optional `active` prop to `ChangesPanel` that defaults to active for
   direct test/component callers.
4. In `ChangesPanel`, return empty projections and a false resource key before
   reading `cardTreeStore` while inactive.
5. Add static tests proving the hidden panel has an active boundary and that
   `main.tsx` wires file/diff visibility into it.
6. Rerun focused unit tests, overlay typecheck, screenshot browser benchmark,
   and visual screenshot review.

## Acceptance

- Opening screenshots does not cause hidden `ChangesPanel` to read
  `cardTreeStore.order` or `cardTreeStore.cards`.
- Visible file changes behavior keeps the same `collectAgentFileChangeGroupsFromNodes`,
  `mergeChangeGroups`, and diff row click path.
- `FileChangesPanel` remains the single mounted file changes owner.
- No fallback diff data, second file changes store, local iframe, or duplicate
  screenshot toolbar source is introduced.
- Focused tests, typecheck, browser screenshot-panel test, visual review,
  self-review, commit, and push all pass.

## Verification Plan

- `bun test packages/overlay/test/agent-file-changes.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/workspace-editor.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`

## Verification

- `bun test packages/overlay/test/agent-file-changes.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/workspace-editor.test.ts --timeout 30000`
  - `agent-file-changes` and `acceptance-panel-mount` passed before
    `workspace-editor` hit an unrelated shared-process card-tree stats cache
    error.
- `bun test packages/overlay/test/workspace-editor.test.ts --timeout 30000`
  - Passed standalone: 7 tests, 30 assertions.
- `bun run --cwd packages/overlay typecheck`
  - Passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
  - Passed; runner rebuilt overlay `dist-vite` with existing Vite warnings.

## Visual Review

- `.scratch/screenshot-browser-panel-browser-high-zoom.png`: high-scale screenshot panel opens with the screenshots toolbar selected, count visible, and thumbnails in the panel.
- `.scratch/screenshot-browser-panel-browser-narrow.png`: narrow shell keeps the bottom toolbar and selected screenshots activity visible while the panel remains readable.
- `.scratch/screenshot-browser-panel-browser-narrow-panel.png`: crop shows the screenshot title/count and card text inside bounds.

## Self Review

- `FileChangesPanel` remains the single mounted file changes owner, but now receives an `active` accessor from the center workbench file/diff panel state.
- `ChangesPanel` returns empty inactive projections and a false resource key before reading `cardTreeStore.order` or `cardTreeStore.cards`.
- Visible file changes behavior still uses `collectAgentFileChangeGroupsFromNodes`, `mergeChangeGroups`, `resolveCurrentChangeGroups`, and `resolveDiff`; no second diff source was introduced.
- Remaining high-confidence pressure sources are `Board` stage projections, `ConversationAgentRail` workflow projection, and the usage strip aggregation; those need their own benchmark/fix rounds.
