# Header Runtime Dropdown And Agent Rail Visual Alignment

## Recall

| Item | Detail |
| --- | --- |
| User request | Remove the selected-looking state from the sliders-style runtime/environment button while its popover is collapsed; make the conversation Agent Rail use very short Codex-style lines and correct the current line placement. |
| Acceptance criteria | The collapsed `project-runtime-status-dropdown` has a transparent quiet rest state while retaining hover/focus and an unmistakable expanded state; Agent Rail ticks are approximately 8px at rest and only slightly longer for the active/proximity record; ticks are centered in the existing left rail slot instead of starting at its outer edge; locate, tooltip, keyboard focus, long-history scrolling, transcript centering, and composer alignment remain intact; real desktop screenshots are generated and personally reviewed. |
| Hard constraints | Reuse `ProjectRuntimeStatusPanel`, `ConversationAgentRail`, shared `Button`, Kobalte Popover/Tooltip, and the existing conversation grid; do not add a second rail, fallback, fake preview, state gate, responsive/mobile scope, or alternate activity source; use the Node-launched browser fixture and do not refresh/restart the user's running Overlay. Preserve the already-dirty related Work Ledger/Worktree visual work in the current worktree. |
| Supplied evidence | The first screenshot shows a collapsed sliders-style toolbar control still carrying a selected fill. The second Codex crop shows a quiet vertical rail whose lines are roughly 8–10px wide and centered around x=23 in a substantially wider gutter. The current generated `left-rail.png` shows 16px rest lines, a 32px active line, and all lines starting at the left edge of the 46px rail slot. |
| Sources read | `AGENTS.md`; Browser skill; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-10-overlay-codex-strict-parity-remediation.md`; `specs/records/2026-07/2026-07-16-work-ledger-density-worktree-visual-refinement.md`; `TaskDirBar.tsx`; `ConversationAgentRail.tsx`; `App.tsx`; `conversation.css`; shared `Button`; focused rail/runtime source and Node browser tests; current generated header, runtime-popover, and rail screenshots. |
| Whole-repository search | `rg` covered all `project-runtime-status-dropdown`, `data-toolbar-compact`, `data-expanded`, `conversation-agent-rail*`, rail geometry variables, component mounts, source tests, browser fixtures, and historical Agent Rail records. `ProjectRuntimeStatusPanel` has one Popover trigger/style owner. `ConversationAgentRail` is the only rail renderer, `App.tsx` has one mount before the message scroll shell, and `conversation.css` owns the single centered rail/message/mirror grid. |
| Independent agent feedback | None. The user did not request sub-agents; this is one coupled Overlay visual surface and the main agent owns screenshot inspection and second review. |

## Root cause

The collapsed runtime Popover trigger is not expanded semantically (`aria-expanded="false"`, no `data-expanded`) but its base compact-toolbar chrome sets `--oc-button-bg: var(--subtle-2)`, so visual state and interaction state disagree. The Agent Rail grid is structurally centered with a mirrored right spacer, but the visible marker is left-anchored inside its slot through a 36px button, `justify-content: flex-start`, and a 3px margin. Its 16/22/27/32px width ladder further turns a navigation hint into a dominant decoration.

## Implementation plan

1. Make the runtime Popover trigger rest background transparent and keep the existing hover/focus/`data-expanded` rule as the only selected-looking state.
2. Keep the existing 46px rail slot and symmetric conversation grid, but center each hit target and marker within that slot; reduce the tick ladder to an 8px rest mark with only subtle near/active growth.
3. Update source-contract and Node browser geometry assertions to prove transparent collapsed runtime chrome, visible expanded chrome, centered short ticks, and preserved transcript/composer axes.
4. Generate task-scoped desktop screenshots for the collapsed/expanded runtime dropdown and Agent Rail, inspect them directly, correct any visual drift, then rerun focused tests, typecheck, i18n, docs health, and diff review.
5. Commit with the `dsw-33987` prefix and push the current branch to the configured legacy remote after the combined in-scope visual work passes review.

## Verification

- `bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/owner-surface-consistency.test.ts`
- Node-launched `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` and the focused runtime-layout case in `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`.
- Overlay TypeScript and i18n checks.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`.
- Fresh screenshot inspection, `git diff --check`, and a second final diff review.

## Visual review result

The first review pass exposed that the red-boxed sliders glyph is the runtime/environment Popover trigger, not the adjacent Right Dock toggle. The unrelated toggle experiment was removed before acceptance. In the corrected light screenshot, the collapsed runtime trigger has no filled layer and reads as a quiet icon between Open in and the Right Dock control; the expanded screenshot adds the existing subtle selected wash while the real environment panel is visible. The regenerated 46px Agent Rail crop places 8px resting marks at the slot center with approximately 19px of space on either side; the active mark is 10px, matching the supplied Codex crop without dominating the transcript.
