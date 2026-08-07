# Streaming Conversation DOM Identity Repair

## Recall

### User request

- The first repair did not eliminate the trailing header flicker.
- The time, model metadata, and message-action region still flickers whenever live data is rendered.
- Continue adjusting until the live Conversation surface remains visually stable.

### Acceptance

- While a selected Chat continues receiving live events, an existing Conversation row and its trailing action region retain the same Document Object Model (DOM) identity when the projected item IDs have not changed.
- Streaming text, Tool results, status, usage, and metadata continue to update from the canonical card-tree store.
- New, removed, or reordered Conversation items still update the virtual list.
- A real desktop page is exercised and screenshotted after the change; the target region is reviewed manually.

### Hard constraints

- `tree-writer.ts` remains the single card-tree writer and `cardTreeStore` remains the single rendered source.
- Do not add a second streaming flag, status fallback, gate, compatibility path, or timer-owned rendering state.
- Do not add, modify, update, or run User Interface (UI) automation tests. UI acceptance uses the real page and an interactive Browser inspection only.
- Use Node, not Bun, for Browser/Playwright interaction.
- Preserve unrelated shared-worktree changes and stage only this repair.

### Read material

- `AGENTS.md` repository rules supplied in the task context.
- `specs/current/architecture/07-panel-reactivity.md`.
- `packages/overlay/src/components/Conversation.tsx`.
- `packages/overlay/src/store/card-tree.ts`.
- `packages/overlay/src/services/tree-writer.ts`.
- Virtua `0.49.3` Solid implementation resolved from the installed workspace dependency.
- The Browser skill instructions for real in-app page inspection.

### Search and runtime evidence

- Code/document search for `publishedCardTreeVersion`, `visibleVersion`, `Virtualizer`, `data={order()}`, and ordered-list equality found one Conversation projection path: every visible publication rebuilds `items`, then allocates a fresh `order` array for Virtua.
- `treeEpoch` changes only on whole-tree replacement; it is not the high-frequency trigger.
- The installed Virtua Solid adapter derives its mounted item set from the reactive `data` input.
- On the real selected running Chat, the latest Agent card remained `data-status="completed"`; therefore the prior CSS selector for a `running` card cannot represent the live Conversation lifecycle.
- During a six-second live sample, the target card text changed zero times while the same card ID's row and trailing-action DOM nodes were each replaced 53 times. This proves the visible flicker is a remount problem rather than a changing timestamp or opacity animation.
- No independent Agent feedback exists because the user did not request delegation and the active collaboration policy prohibits unsolicited sub-agents.

## Root cause

`VirtualizedConversationCards` correctly recomputes projected items after each atomic visible card-tree publication, but it also publishes newly allocated item objects and an ID-order array on every publication. Live events therefore invalidate both the virtual list input and each mounted item's structural input even when projection structure is unchanged. The inner card rows are repeatedly reconstructed while the outer virtual row and underlying card proxy content remain the same, which makes the always-mounted time/model/menu chrome visibly flash.

The previous repair targeted hover opacity from `CardNode.status`. That status is message-local and can already be `completed` while its owning Chat is still running, so it neither identifies the live rendering interval nor prevents the structural remount.

## Plan

1. Give the projected Conversation items structural equality in their Solid memo. Equal card kind/IDs and ordered sub-agent Session IDs retain the previous item objects and list; an actual insertion, removal, reorder, kind change, or sub-agent grid membership change still publishes a new projection.
2. Keep the item projection subscribed to `publishedCardTreeVersion`; mounted card content continues reading the current card/store proxy directly without a second source.
3. Document the stable virtual-list identity contract in current panel reactivity architecture.
4. Run TypeScript typecheck, the Vite production build, i18n/document health checks, and the required historical-doc links test without running UI tests.
5. Reopen the real streaming Chat, repeat DOM-identity sampling, capture the changed Conversation region, and manually review the screenshot. Commit and push the scoped repair to `myhexin`.

## Verification

- Baseline real-page sample: the same completed card ID and unchanged 2,352-character body remounted its inner row and action region 53 times in six seconds while its Chat remained active.
- After the full structural-item equality repair: a ten-second sample of the same selected Chat recorded zero virtual-item replacements, zero inner-row replacements, and zero action-region replacements.
- The in-app desktop page was scrolled to the exact Agent header and captured at 1280 x 720. Manual review confirmed the title row remains aligned and the previous running-only action override no longer alters the resting layout.
- `bun run typecheck`: passed for all scoped packages.
- `bun run build:vite` from `packages/overlay`: passed; Vite transformed 7,061 modules and completed the production build in 1 minute 39 seconds.
- `bun run check:i18n` from `packages/overlay`: passed.
- `bun run docs:check`: passed with 311 operations across 24 groups.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 2 passed, 0 failed.
- No UI automation test was added, changed, or run.
