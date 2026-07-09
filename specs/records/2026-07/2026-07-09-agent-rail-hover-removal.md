# Agent Rail Hover Removal

## Recall

User request:

- Remove the agent rail hover behavior because the hover detail card overlaps the conversation content.
- The screenshot shows the custom rail hover panel with `Agent`, `Status`, and `Summary` covering the message pane.
- Follow-up: change the rail into thin lines that stretch in a stepped range around the mouse, like the supplied reference image.

Acceptance criteria:

- Hovering an agent rail tick must not render the custom `.conversation-agent-rail-tooltip` surface.
- Rail locate buttons must not expose a native `title` tooltip.
- Rail tick thickness must stay uniform across statuses and hover/focus.
- Status may use color or opacity, but must not change tick width.
- Mouse proximity may change tick width in a stepped range around the hovered row: the hovered row is longest, immediate neighbors are shorter, and second neighbors are shorter again.
- Click-to-locate behavior, accessible button labels, left-rail geometry, adjacent same-agent stacking, and source ownership must remain unchanged.
- Tests must lock the removed hover behavior so it is not reintroduced by the previous 2026-07-08 left-rail contract.

Hard constraints:

- No fallback, compatibility branch, gate, alternate rail source, or rendered-card text scan.
- Preserve unrelated dirty worktree changes.
- Do not restart, refresh, kill, or otherwise interfere with the user's running OpenCorvus / overlay process.
- Browser verification must use an isolated fixture and Playwright through Node on Windows, not Bun.
- Frontend change requires screenshot review of the real rendered fixture.

Sources read before implementation:

- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-08-conversation-agent-history-left-rail.md`
- `specs/records/2026-07/2026-07-08-message-pane-rail-header-scrollbar-repair.md`
- `packages/overlay/src/components/ConversationAgentRail.tsx`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- `packages/overlay/test/conversation-agent-rail.test.ts`
- `packages/overlay/test/conversation-rendering-i18n.test.ts`
- `packages/overlay/test/overlay-architecture-guards.test.ts`
- `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- User-provided screenshot `C:/Users/chuan/AppData/Local/Temp/codex-clipboard-6d56ab5c-46e3-4d62-bca8-d951488f4642.png`
- User-provided stepped-line reference `C:/Users/chuan/AppData/Local/Temp/codex-clipboard-1d621daf-fdc7-40f1-8339-8bed3f56eab0.png`

Whole-repository search evidence:

- `rg -n "agent_rail|conversation-agent-rail|ConversationAgentRail|rail tooltip|Agent rail|agent rail" specs packages/overlay/test packages/overlay/src -S` found the 2026-07-08 left-rail record, component, i18n keys, CSS tooltip classes, and browser/unit tests that still require tooltip rendering.
- `rg -n "Tooltip|conversation-agent-rail-tooltip|tooltip summary|hover tooltip|Kobalte Tooltip|title=\{tooltipLabel|agent_rail.detail.summary|compactLabel\(" packages/overlay/test packages/overlay/src specs/records/2026-07 -S` proved the hover surface is only owned by `ConversationAgentRail.tsx` and the rail-specific CSS/tests; `CardHeaderChrome` and `SidebarVersionLabel` use separate tooltip surfaces and are out of scope.
- `rg -n "title=|data-tooltip|Tooltip|hover|onMouseEnter|onPointerEnter|popover|Popper|Radix|agent" packages/overlay/src -S` confirmed the custom rail panel is Kobalte Tooltip plus native `title`, not a backend or data-source issue.

Independent agent feedback:

- None requested. The defect is local to the overlay agent rail hover presentation, and the existing specs/tests provide the historical contract that must now be reversed.

## Diagnosis

The overlapping panel is not caused by rail geometry or locate behavior. `ConversationAgentRail` wraps each locate button in `Tooltip.Root` and renders `.conversation-agent-rail-tooltip` through a portal. The button also sets `title={tooltipLabel()}`, creating a second hover affordance. The 2026-07-08 left-rail spec intentionally added this hover summary, and current unit/browser tests still require it.

The visible thick/thin rail issue comes from geometry changes, not a meaningful business signal. `running` changes tick width from `20px` to `25px`, keyboard focus changes it to `28px`, and stronger color makes active ticks read heavier. The status source is real (`record().status`), but thickness/width is not a useful status language after the hover card was removed.

The new stepped-line request changes the mouse interaction contract but not the status contract. Width changes should be driven only by local pointer/focus proximity in the rail, not by `record().status`, and they must not introduce a floating detail surface.

The correct repair is to remove the hover detail surface at the rail component boundary while preserving the single workflow record source and click target materialization path.

## Plan

1. Remove the rail-specific Kobalte Tooltip wrapper, portal content, native `title`, tooltip summary helper, and unused tooltip i18n key.
2. Keep `Button`, `aria-label`, status labels, attempt text, record grouping, and locate-on-click behavior.
3. Delete `.conversation-agent-rail-tooltip*` CSS rules and update guard tests to assert their absence.
4. Normalize status geometry by removing status width changes; keep status color/opacity only.
5. Add stepped proximity width rules for hovered/focused rows and their first/second neighbors while preserving fixed tick thickness.
6. Update browser fixture to hover a rail button and assert no custom tooltip, no `title`, stepped proximity width, and uniform tick thickness across statuses.
7. Run focused unit tests, i18n check, isolated Node browser test, docs link test, `git diff --check`, and review generated screenshots.

## Validation Targets

- `bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/conversation-rendering-i18n.test.ts packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/agent-workflow-css-guards.test.ts`
- `bun run --cwd packages/overlay check:i18n`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-hover-removal-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
