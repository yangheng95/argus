# Project Row Surface And Search Alignment

## Recall

### User requirement

- Make the Project row background include the folder/title area and the pin, new-chat, and delete icons.
- Restore a visible row background when the pointer hovers the Project row, including when it is over the action icons.
- Vertically align the workspace search button with the `OpenCorvus 工作区` text.

### Acceptance criteria

- One rounded Project-row surface spans the disclosure button and the complete action rail; no split capsule ends before the actions.
- Hover, keyboard focus within the row, and active-project state paint that same complete surface through existing interaction wash tokens.
- The nested disclosure and glyph-only action buttons stay transparent so they do not recreate competing partial surfaces.
- The workspace search glyph is optically centered with the workspace copy in the real desktop layout.
- Focused source tests, Overlay TypeScript, required spec-health checks, Node-launched browser checks, and manually reviewed scoped screenshots pass.

### Hard constraints

- Keep `ProjectLedgerGroup`, `Button`, and `Icon` as the only component and interaction primitives; add no duplicate project row or search implementation.
- Preserve project action behavior, keyboard focus, accessible labels, and current row geometry.
- Desktop-only scope. Playwright runs through Node, never Bun.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process; visual verification uses isolated test processes.
- Do not create a worktree, reset or overwrite unrelated changes, bypass hooks, or push outside the configured legacy remote.

### Supplied visual evidence

- `codex-clipboard-9c6e3d96-844c-4809-b576-ff94dbe9b044.png`: the current hover/selected capsule stops before the project action icons.
- `codex-clipboard-1a93aa15-57a1-4b4e-9885-51d7c7511b6e.png`: moving across the Project row/action region has no complete hover layer.
- `codex-clipboard-822ba110-26f0-456d-9a60-9be5b0c6ca22.png`: the workspace search glyph sits optically above the `OpenCorvus 工作区` copy.

### Sources read

- `AGENTS.md`, `specs/README.md`, and `specs/records/2026-07/README.md`.
- `specs/current/architecture/99-principles.md`.
- `specs/records/2026-07/2026-07-14-overlay-startup-and-chrome-parity.md`.
- `specs/records/2026-07/2026-07-15-codex-sidebar-search-environment-parity.md`.
- `packages/overlay/src/components/{App,ProjectLedgerGroup}.tsx` and `components/titlebar/TitlebarBrandGuide.tsx`.
- `packages/overlay/src/styles/primitives/button.css` and `styles/surfaces/{sidebar,titlebar}.css`.
- Project-row, titlebar, and browser regressions named below.

### Whole-repository search evidence

Searches covered `ProjectLedgerGroup`, every `project-group-*` selector and data hook, the shared Button hover contract, `workspace-contextbar`, `workspace-command-search`, `TitlebarBrandGuide`, and all source/browser tests that assert those owners.

| Owner / call site                                         | Decision                                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ProjectLedgerGroup.tsx`                                  | Preserve the canonical header grid and all action behavior; no markup or state fork is needed.                                     |
| `sidebar.css` `.project-group-head`                       | Become the one full-width visual surface for hover, focus-within, and active state.                                                |
| `sidebar.css` project toggle and icon actions             | Keep controls transparent in every row-highlight state so the parent surface remains visually continuous.                          |
| `button.css`                                              | Preserve the generic Button primitive; this repair is specific to the composite Project row and must not change unrelated buttons. |
| `App.tsx` workspace context bar                           | Preserve one search action that opens the command palette.                                                                         |
| `titlebar.css` brand/search geometry                      | Correct optical block-axis alignment inside the existing grid without adding a wrapper or second search control.                   |
| `project-delete-button.test.ts` and titlebar source tests | Pin the full-row surface owner and search alignment contract.                                                                      |
| Existing Node browser fixtures                            | Exercise the production Project row and workspace header, measure geometry/colors, and capture scoped screenshots for review.      |

### Independent agent feedback

- None. The user did not request sub-agents; the affected rules are tightly coupled CSS owners in the same Overlay shell.

## Root cause

The Project row is a two-column grid, but hover background is owned by only the disclosure `Button` in the first column. The action rail is a transparent sibling in the second column, so the painted capsule ends before the icons and disappears when the pointer crosses into that sibling. The workspace header uses mathematically centered boxes, but the search glyph's optical center is above the mixed Latin/CJK text center; its current geometry has no optical correction.

## Implementation

1. Move Project-row interaction painting to `.project-group-head` and explicitly keep its child controls transparent.
2. Apply a scale-aware optical alignment adjustment to the existing workspace search button.
3. Update focused regressions, render the production surfaces through isolated Node browser fixtures, inspect screenshots, and run the Overlay/spec verification set.

## Verification

- Focused Bun source tests for Project-row and titlebar contracts.
- `bun run --cwd packages/overlay typecheck`.
- `bun test packages/opencorvus/test/script/{historical-docs-links,document-health,product-docs-single-source}.test.ts`.
- Node-launched Project-row and titlebar browser checks with scoped screenshots and manual visual review.
- `git diff --check`, followed by a second diff review.

## Result

- The canonical `.project-group-head` now owns one rounded hover/focus/active surface across both grid columns. The disclosure toggle and pin/new-chat/delete controls remain transparent, so the layer no longer stops before the action icons or disappears when the pointer enters the action rail.
- The existing workspace search button receives a scale-aware one-pixel optical correction; the production browser fixture measures its block-axis center within one pixel of the mixed Latin/CJK workspace copy.
- PASS: 15 focused Project-row/titlebar/startup source tests and Overlay TypeScript.
- PASS: Node-launched production browser regressions for the Work Ledger Project row and titlebar brand/search surface. The Project test also verifies that the parent background is non-transparent, both child regions are transparent, and the parent bounds contain the complete action rail.
- PASS: dark-theme screenshots were manually reviewed: `.scratch/project-group-full-row-hover.png` shows one continuous hover capsule behind the folder, title, and all three actions; `.scratch/workspace-search-title-alignment.png` shows the search glyph and `OpenCorvus Workspace` copy sharing the same visual centerline.
- PASS: Prettier and `git diff --check` on the task files.
- Concurrent-work note: a separate uncommitted Work Ledger icon/focused-popup task added another July record while this task was running. The document-health suite's tracked-record assertion remains pending until the two records are staged/committed; all other 76 documentation checks passed. No concurrent source change was reset, overwritten, or staged as part of this task's validation.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, stopped, or used as the visual target; all evidence came from isolated Node-started fixtures and the background browser validation session.
