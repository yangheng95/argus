# Overlay Worktree Shortcuts, Chat Chrome, File Rows, And Button System

## Recall

| Item | Detail |
| --- | --- |
| User request | Add Requirements, Architecture, and Goals entries below Worktree with useful list metadata; restore conversation backgrounds; combine conversation-head controls into one hover toolbar; make Explorer follow the supplied Codex file-tree reference and make Review reuse the same file-row component without a secondary title; replace the visible `Completed` status word with a status dot; normalize every Overlay button through the Codex-style shared button system. |
| Acceptance criteria | The environment popover exposes three task-scope shortcuts immediately after Worktree and opens the canonical Right Dock panels; each shortcut projects count/state from `boardStore.board`. Agent conversation turns again have a quiet theme-backed surface. Model/token/usage/control/copy actions form one toolbar that appears on hover or focus without layout shift. Explorer and Review render their file identity through one shared file-row visual primitive; Review has no content-level title. Agent identity renders one accessible status dot and no visible lifecycle word. Production JSX contains no literal button owner outside `ui/Button`; specialized Kobalte controls continue to render through mature primitives. Focused tests, TypeScript, i18n, real Node-launched browser interaction, scoped screenshots, and manual visual review pass. |
| Hard constraints | Desktop-only. Keep `boardStore.board`, Right Dock panel state, `FileExplorerPanel`, `FileChangesView`, Kobalte Listbox/ContextMenu/Popover, and `ui/Button` as the only data/interaction owners. No fallback, duplicate panel state, copied file-tree implementation, synthetic message, hard-coded status text, temporary iframe, or user-process restart/refresh. Playwright is launched with Node. Preserve concurrent Work Ledger/Worktree refinement and do not stage its files unless this task also edits a non-overlapping region intentionally. |
| Supplied evidence | Image 1 shows compact Requirements/Architecture/Goals rows; image 2 shows model and token metadata that should become one hover-revealed group; image 3 shows a dense Codex file tree; image 4 shows the redundant `Completed` word beside the status dot; image 5 shows the rounded neutral Codex control language. |
| Sources read | `AGENTS.md`; Browser skill; `specs/current/architecture/{07-panel,12-overlay-card-system,99-principles}.md`; July records for file copy, Right Dock ownership/startup chrome, Codex environment parity, and message transcript visual language; the concurrent `2026-07-16-work-ledger-density-worktree-visual-refinement.md`; current `App`, `main`, `TaskDirBar`, `RightDock`, `Board`, `ChatBubble`, `CardHeaderChrome`, `FileExplorerPanel`, `FileChangesPanel`, `FileChangesView`, `Button`, styles, locales, and focused tests. |
| Whole-repository grep | Enumerated every `ProjectRuntimeStatusPanel` / `ProjectRuntimeToolbarActions` mount, Right Dock open/select callback, `CardHeaderChrome` call site, `chat-bubble__status` renderer/style/test, Explorer row renderer/style/test, Review `FileChangesView` row renderer/style/test, all `variant=` Button consumers, every literal `<button>` production call site, and the generated HTML button surfaces in `dom-utils.ts` / `markdown.ts`. |
| Independent agent feedback | None. The user did not request sub-agents and the active collaboration contract forbids unrequested delegation. |
| Git baseline | `HEAD` and `origin/work-v0.0.6beta-yr-0716` were equal (`0 0`). The pre-change push reached the real typecheck successfully, then the route-inventory hook reported the already-generated nullable archive schema; the checker cleaned that transient difference. Concurrent edits then appeared in Work Ledger/Worktree files and are treated as foreign work to preserve. |

## Root Cause

The requested inconsistencies map to four ownership gaps rather than six isolated CSS defects. Task-scope panels are canonical Right Dock tools but the environment surface has no typed navigation callback or compact board projection. Agent bubbles were deliberately flattened to transparent surfaces in `1ce5df726`, while their status text and metadata/actions still occupy separate visible fragments. Explorer and Review each own separate row markup and styling, so visual convergence cannot remain stable. Finally, the shared `Button` exists but a small set of production components still render literal buttons and the outline variant remains visually transparent, leaving the project without one enforceable control contract.

## Call-Site Disposition

| Owner / call site | Decision |
| --- | --- |
| `main.tsx -> App -> ProjectRuntimeToolbarActions` | Thread one typed `onOpenRightPanel` callback to the existing `openRightActivity`; do not create an event bus or second panel store. |
| `TaskDirBar.ProjectRuntimeStatusPanel` | Add a task-scope list after the Worktree section. Read Requirements, Architect, and Goals summaries directly from `boardStore.board`; rows call the threaded callback. Preserve concurrent Worktree visual edits. |
| `ChatBubbleIdentity` / `chat-bubble__status` | Remove visible localized status text and keep an accessible title/label plus the existing tone-driven dot. |
| `ChatBubbleActions` / `CardHeaderChrome` | Keep the existing action capabilities and one CardHeaderChrome owner; make the outer hover-actions container the single grouped toolbar. |
| `chat-bubble.css` | Restore a quiet token-derived Agent surface with padding/radius and no heavy four-sided frame; retain user-message ownership. |
| `FileExplorerPanel` and `FileChangesView` | Extract one shared file-row visual primitive with icon/name/path/trailing slots. Explorer keeps ContextMenu/tree/selection/drag ownership; Review keeps Kobalte Listbox/diff ownership. |
| `FileChangesPanel` / `FileChangesView.showHeading` | Keep the Right Dock tab as the sole title; no secondary Review heading is mounted. |
| `ui/Button` / `button.css` | Make the neutral outline control use the Codex-like filled/bordered surface and preserve ghost/solid semantic variants. Convert remaining literal component buttons to this primitive; generated Markdown/image/path buttons receive the same `oc-button` data contract where JSX cannot be used. |
| Focused tests | Add negative coverage for visible status words and literal component buttons, typed scope-shortcut wiring/metadata, shared file-row ownership, Review title absence, and button variant styling. Extend existing Node browser fixtures for task-scope navigation, Agent hover/background/status, and Explorer/Review row parity. |

## Implementation Plan

1. Finish the shared button contract and eliminate literal component button owners.
2. Add typed environment-to-Right-Dock task-scope shortcuts with live board summaries.
3. Restore the Agent surface, status-dot-only identity, and one hover/focus action toolbar.
4. Extract the shared file-row visual primitive and adopt it in Explorer and Review without changing either data/interaction owner.
5. Update focused unit/browser regressions, run typecheck/i18n/build, capture and inspect desktop screenshots, correct visible mismatches, run a second diff review, then selectively commit and push without absorbing concurrent files.

## Verification Plan

- Focused Overlay source tests for app/runtime wiring, chat bubbles, file Explorer/Review ownership, and Button coverage.
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- Node-launched Playwright tests for environment shortcuts, Agent message chrome, and Explorer/Review rows.
- `bun run --cwd packages/overlay build`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Scoped screenshot inspection with Browser tooling and `view_image`, followed by `git diff --check` and a second source/diff review.

## Progress

- [x] Recalled architecture/history and enumerated call sites.
- [x] Implemented shared primitives and all six requested surfaces.
- [x] Focused and browser validation passed for the task-scope shortcuts, Agent message surface/toolbar/status point, Explorer, and Review.
- [x] Screenshot review and visual correction completed. The shared file-row auxiliary text was raised from `text-muted` to `text-soft` after the real Review hover sample measured 4.44:1; the rerun passed the 4.5:1 contrast contract.
- [x] Second review and task-only selective commit preparation completed.

## Visual Evidence

| Surface | Evidence |
| --- | --- |
| Worktree task-scope shortcuts | `.scratch/task-dirbar-runtime-status-panel-merged.png` shows Requirements `1/2`, Architecture `3`, and Goals `1/2` directly below the compact Worktree list. The browser test clicks Goals and verifies the canonical `#centerWorkbenchGoals` panel is active. |
| Agent message rest / hover | `packages/overlay/.scratch/overlay-codex-conversation-default.png` and `overlay-codex-conversation-hover.png` show the restored quiet card surface, status point without `Completed`, and one surfaced hover toolbar. Keyboard focus follows the same reveal path. |
| Explorer | `packages/overlay/.scratch/file-explorer-dark-row-density.png` and `file-explorer-row-focus-visible.png` show the shared 32px tree rows, depth geometry, selected/focus states, and search-only toolbar. |
| Review | `packages/overlay/.scratch/file-changes-light-contrast.png` shows the same file identity row component under the actions-only Review surface, with no duplicate content title. |

## Verification Evidence

- PASS: focused Button, ChatBubble, Explorer/Review, and runtime wiring source tests (32 tests / 847 assertions in the final combined focused run).
- PASS: repository typecheck and Overlay i18n validation after the concurrent Settings/Search commit was integrated.
- Shared-worktree note: historical-link and product-doc checks pass; the standalone document-health run is 77/78 because two failed concurrent tasks left untracked record links in the live monthly README. This task's alternate index excludes those links, and the push-hook run uses the task-only index state.
- PASS: `bun run typecheck` and `bun run build:vite` in `packages/overlay`.
- PASS: Node-launched `chat-bubble-disclosure-button-browser.test.ts` (default, hover, keyboard, expanded, light, and dark paths).
- PASS: Node-launched first `task-dirbar-keyboard.test.ts` scenario plus the remaining 14 existing Worktree scenarios in the full run; the only stale rest-state background expectation was updated for the shared surfaced Button contract.
- PASS: Node-launched primary `file-explorer-accessibility.test.ts` scenario after replacing the retired right-activity-toolbar navigation with the real Right Dock Tab path.
- PASS: Node-launched `toolbar-diff-navigation.test.ts`, including Review row hover contrast, keyboard expansion, filters, and active Review-tab return to the canonical Diff view.

## Follow-up: peer section titles, data-owned visibility, and Worktree path cards

### Recall

| Item | Detail |
| --- | --- |
| User request | Make Requirements, Architecture, and Goals peer titles at the same hierarchy as Worktree; hide each of the four titles when its backing list has no entries; render Worktree list data in the supplied compact bordered path-card form. |
| Acceptance criteria | Worktree, Requirements, Architecture, and Goals use one peer section-title rhythm. A section is absent when its canonical data projection has no entries, so no `No worktrees` or `—` placeholder remains. A visible Worktree is a single rounded bordered row with the existing worktree glyph and a project-relative path such as `opencorvus/w/Y8H7JeUe`, while open, per-item delete, refresh, and delete-all behavior remain available. Requirements and Goals retain passed/total summaries; Architecture retains its contract count; all three continue opening the canonical Right Dock panels. Focused tests, TypeScript, Node-launched browser behavior, task-scoped screenshots, manual visual review, and documentation health pass. |
| Hard constraints | Keep `boardStore.board`, `loadProjectWorktrees`, Kobalte Popover, shared `Button`/`Icon`, and the existing Right Dock callback as the only data and interaction owners. Do not add fallback data, duplicate panel state, fake preview data in production, mobile/tablet scope, or restart/refresh the user's running OpenCorvus/overlay. Playwright is launched with Node. Preserve unrelated dirty files and stage only this task's files. |
| Supplied evidence | Image 1 shows the current unconditional Worktree empty state and icon-led task-scope rows. Image 2 defines the desired Worktree item: one pale rounded border, a branch/worktree glyph, and a slash-delimited path label. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/current/architecture/07-panel.md`; this record; `2026-07-16-work-ledger-density-worktree-visual-refinement.md`; `TaskDirBar.tsx`; `services/worktree.ts`; `conversation.css`; `task-cwd-row-layout.test.ts`; `task-dirbar-keyboard.test.ts`; and the supplied screenshots at their original resolution. |
| Whole-repository grep | `ProjectRuntimeStatusPanel` is the only live UI/data owner. `project-worktree-*` styles are owned by `conversation.css`; `loadProjectWorktrees` and delete functions are owned by `services/worktree.ts`; the source regression is `task-cwd-row-layout.test.ts`; the real interaction/screenshot regression is `browser/task-dirbar-keyboard.test.ts`; `popup-contrast-matrix.test.ts` has a static styling sample but does not own production markup. No sibling production renderer exists. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Current branch `work-v0.0.6beta-yr-0716` starts at pushed commit `f4425c836`. Five unrelated pre-existing modified files are preserved and excluded from this task. `TaskDirBar.tsx`, `conversation.css`, the focused tests, and this record were clean before this follow-up. |

### Root cause and call-site disposition

The runtime panel models Worktree as a section but models the three task-scope projections as unconditional icon-led shortcut rows. Empty projections are converted into presentation strings (`No worktrees` and `—`) instead of controlling section presence, so all four headings survive without data and do not share a hierarchy. Worktree items expose only the backend `name`, even though the canonical `directory` already contains the stable project/worktree path needed by the supplied visual.

| Call site | Decision |
| --- | --- |
| `TaskDirBar.taskScopeShortcuts` | Return only projections backed by actual Requirements, Architecture contract, or Goal data; retain canonical summaries and Right Dock IDs. |
| `TaskDirBar.ProjectRuntimeStatusPanel` Worktree section | Render the entire section only when `visibleWorktrees` is non-empty; remove the empty placeholder. Keep header actions inside the conditional section. |
| `TaskDirBar.ProjectRuntimeStatusPanel` task-scope navigation | Give each visible shortcut the same peer section-title class and vertical rhythm as Worktree, without a leading icon; keep the summary as trailing metadata and retain shared `Button` semantics. |
| Worktree item label | Render the canonical `ProjectWorktreeInfo.branch` value, which already has the supplied `opencorvus/w/<id>` form; do not derive another path or add a second data source. Keep the absolute directory in `title` and open/delete operations. |
| `conversation.css` | Replace transparent Worktree rows with the supplied quiet bordered card geometry; unify the four section title styles and remove obsolete empty-state/icon-grid rules. |
| `task-cwd-row-layout.test.ts` | Assert conditional section ownership, absence of empty placeholders and task-scope icons, peer title classes, and relative-path projection. |
| `browser/task-dirbar-keyboard.test.ts` | Extend the existing real runtime fixture with visible/empty data assertions, path-card computed geometry, keyboard navigation, canonical Right Dock opening, and refreshed scoped screenshots. |
| `popup-contrast-matrix.test.ts` | Keep as a static contrast fixture unless focused execution shows its class contract is stale; it is not production evidence. |

### Implementation and verification plan

1. Add projection helpers and conditional peer sections without changing service or Right Dock ownership.
2. Restyle the Worktree row to the reference geometry and update source/browser regression expectations.
3. Run focused Bun tests, Overlay TypeScript and i18n checks, then launch the existing browser suite with Node.
4. Inspect the task-scoped runtime screenshots at normal and constrained desktop widths, correct discrepancies, rerun, and complete a second code/diff review.
5. Run spec/document health checks, commit only task-owned files with the `dsw-33987` prefix, and push the current branch to `legacy-remote`.

### Follow-up result

- `ProjectRuntimeStatusPanel` now renders one shared resource-section hierarchy. Worktree, Requirements, Architecture, and Goals use the same left edge, color, 14px size, and 400 weight; the browser geometry assertion checks all four computed title styles.
- Each section is data-owned. Worktree disappears with an empty non-primary worktree list, Requirements and Goals disappear with empty arrays, and Architecture disappears with zero contracts. The previous `No worktrees` and `—` production placeholders are removed together with the obsolete task-scope leading icons.
- Worktree cards render the canonical backend branch (`opencorvus/w/<id>` or `opencorvus/s/<id>`) beside the existing worktree glyph in a 1px bordered, 8px-radius inset row. Open, refresh, per-row delete, and bulk-delete ownership remains unchanged.
- The first browser review caught two visual defects and they were corrected before acceptance: task-scope labels inherited Button's 600 weight because an undefined font-weight token was used, and the resource wrapper duplicated the existing Sources separator. The final implementation uses `--ui-font-weight-body` and one divider owner.

### Follow-up verification evidence

| Evidence | Result |
| --- | --- |
| Focused source regression | `bun test packages/overlay/test/task-cwd-row-layout.test.ts`: 7 pass, 0 fail, 140 assertions. |
| Overlay contracts | `bun run --cwd packages/overlay typecheck` and `bun run --cwd packages/overlay check:i18n`: pass. |
| Real browser lifecycle | `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts`: 15 pass, 0 fail, including task switching, stale loads, delete confirmation/completion, partial bulk failures, and board-reload failures. |
| Visible resource screenshot | `.scratch/task-dirbar-runtime-status-panel-merged.png`: manually reviewed after the final rerun; branch cards and four peer titles match the requested hierarchy without the earlier notification obstruction or duplicate divider. |
| Empty resource screenshot | `.scratch/task-dirbar-runtime-status-empty-resources.png`: manually reviewed after switching through the real task selection/load path; none of the four titles, Worktree actions, `No worktrees`, or `—` placeholders is present. |
| Documentation health | Historical links 21/21, document health 53/53, and product docs single-source 4/4 pass. |
| Final review | `git diff --check` passes; the full-repository grep leaves `project-worktree-empty` only in the pre-existing static popup contrast sample, not production JSX/CSS. |
