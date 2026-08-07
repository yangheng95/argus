# Task title usage tooltip

## Recall

### User request

- Move the token usage currently shown persistently at the right side of the conversation header into a tooltip revealed by hovering the task name.

### Acceptance criteria

- The conversation header no longer reserves a persistent token-usage lane.
- Hovering or keyboard-focusing the task name reveals the same whole-session token and cost aggregate.
- Empty usage does not produce an empty tooltip.
- The task title keeps its existing double-click diagnostic-copy behavior.
- A real Vite Overlay page proves the tooltip value, placement, and non-overlap in a visible screenshot.

### Hard constraints

- Preserve every unrelated tracked, staged, unstaged, and untracked change in the shared worktree.
- Reuse the existing Kobalte Tooltip primitive and `cardTreeStore.usageAggregate`; do not create a second usage source or handwritten popup.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus or Overlay.
- Launch Playwright through Node, never Bun.
- Keep the single desktop titlebar and existing task/session title projection unchanged.

### Read material

- `AGENTS.md`.
- `specs/records/2026-07/2026-07-25-openmirror-report-unclosed-ui-repair.md`.
- `packages/overlay/src/components/ui/Tooltip.tsx`.
- `packages/overlay/src/components/App.tsx`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/store/card-tree.ts`.
- `packages/overlay/src/utils/format-usage.ts`.
- `packages/overlay/src/styles/primitives/tooltip.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- The supplied header screenshot.

### Full-repository search

| Contract / call surface                          | Result and disposition                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chatUsage` / `.chat-usage`                      | One production element in `App.tsx`, one imperative writer in `main.tsx`, one surface recipe, and focused source/browser assertions. Remove the persistent lane and move the value into the title-owned Tooltip.                                                                                           |
| `formatUsageStrip(cardTreeStore.usageAggregate)` | One UI projection in `main.tsx`; formatter and aggregate tests remain canonical. Move the projection into the Solid title component without changing aggregation semantics.                                                                                                                                |
| `chatViewTitle`                                  | One rendered title in `App.tsx`; `main.tsx` owns title text, double-click diagnostics, and selected-source projection. Preserve its ID and text ownership so all browser consumers remain valid.                                                                                                           |
| `chat.usage_tooltip` / `chat.usage_aria`         | One English/Chinese description pair. Retire the long native-tooltip description and reuse the concise accessible label inside the structured tooltip.                                                                                                                                                     |
| `.oc-tooltip` / `Tooltip`                        | One canonical Kobalte wrapper and primitive style. Reuse them unchanged; add only title-specific internal layout.                                                                                                                                                                                          |
| Browser usage-header assertions                  | `message-card-chronological-turns-browser.test.ts` proves aggregate rendering and header geometry; replace its visible-chip assertions with hover/focus Tooltip acceptance and screenshot evidence. `titlebar-toolbar-toggle-browser.test.ts` records geometry only and must follow the new title trigger. |
| Source ownership assertions                      | `acceptance-panel-mount.test.ts`, `composer-file-loader-right-dock.test.ts`, and `overlay-architecture-guards.test.ts` currently pin the persistent lane. Update them to pin title-owned Tooltip and the absence of the retired lane.                                                                      |

### Independent agent feedback

- None. The user did not request sub-agents or delegated review, so the primary agent owns implementation and secondary review.

## Causal analysis

The aggregate itself is already correct and incrementally maintained. The visual noise comes from projecting it as a second, permanently visible header lane. The task name is the semantic owner the user identified, and the project already has one accessible Kobalte Tooltip primitive. Therefore the root repair is a presentation-ownership move: keep the aggregate and formatter unchanged, render the Tooltip at the title, and delete the old lane rather than keeping two surfaces.

The title is also an imperative integration point for selected-task text and diagnostic copy. Replacing its ID or moving text ownership would create another title projection. The Tooltip trigger must therefore remain the same `#chatViewTitle` element so existing title updates, tests, and double-click behavior continue through one source.

## Implementation

1. Add a title-owned Kobalte Tooltip in `App.tsx`, driven directly by the canonical usage aggregate and formatter.
2. Keep `#chatViewTitle` as the trigger, disable the Tooltip when the formatted aggregate is empty, and expose the aggregate through hover and keyboard focus.
3. Remove the persistent `chatUsage` header-meta element, its imperative writer, retired native debug title, and obsolete lane styling.
4. Update focused source tests and the real browser usage-header scenario.
5. Inspect the real Vite screenshot, run focused tests plus documentation health, review the exact task diff, then commit only task-owned files and push `v0.0.19beta` to `myhexin`.

## Validation

- `bun run --cwd packages/overlay typecheck`
  - Pass.
- `bun test packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/format-usage.test.ts`
  - `28 pass / 0 fail`.
- `bun test packages/overlay/test/composer-file-loader-right-dock.test.ts -t "message panel header"`
  - `1 pass / 0 fail`.
- `bun test packages/overlay/test/overlay-architecture-guards.test.ts -t "conversation header"`
  - `1 pass / 0 fail`.
- `bun run --cwd packages/overlay check:i18n`
  - Pass.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/card-header-metadata-tooltip-browser.test.ts`
  - `1 pass / 0 fail`.
  - The Node-launched real Vite Overlay proves the persistent header actions contain no usage copy, hovering the task title reveals `Session usage estimate 13k tok · $0.042`, the Tooltip clears the title, fits the viewport, and remains keyboard-focusable.
- `.scratch/task-title-usage-tooltip.png`
  - Inspected at full resolution. The compact tooltip sits directly below the task name, keeps the right-side action lane clear, and does not overlap conversation content at the header edge.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `22 pass / 0 fail`.

The complete legacy `message-card-chronological-turns-browser.test.ts` also reached and passed the new title-usage assertions and wrote `.scratch/message-card-chronological-turns-browser/usage-header.png`, but subsequently encountered unrelated concurrent fixture drift in the delegated-context control. The dedicated production-path browser acceptance above is the authoritative clean pass for this change.

## Outcome

- Whole-session token and cost usage is no longer permanently visible in the conversation-header action lane.
- Hovering or keyboard-focusing the task title reveals the canonical aggregate through the shared Kobalte Tooltip.
- Empty usage disables the Tooltip, while the existing task-title text projection and double-click diagnostic copy remain on the same `#chatViewTitle` element.
