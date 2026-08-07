# Project Pin Optical Size Repair

## Recall

- User request: the angled project-row pushpin looks visually smaller than the adjacent new-chat and delete icons in the supplied screenshot.
- Acceptance criteria: preserve the existing Lucide pushpin identity and 18-pixel action button; increase the shared angled pin's optical footprint so the project-row pin reads at the same visual weight as its adjacent icons; keep pin/unpin behavior and accessible labels unchanged; add a regression assertion and inspect a real desktop screenshot.
- Hard constraints: use the existing `Icon` and `Button` primitives; keep `pin-tilted` as the single angled-pin source; do not hand-draw another icon, add a feature-specific fallback, restart/refresh the running OpenCorvus or Overlay, or stage unrelated dirty work; run Playwright through Node; commit subject starts with `dsw-33987` and push the current branch to the legacy remote.
- Sources read: `AGENTS.md`; the supplied `codex-clipboard-421eacb9-1ddd-490f-8a08-d16777020ef1.png`; `2026-07-13-project-pin-unpin-and-icon-repair.md`; `2026-07-15-work-ledger-icons-and-popup-surface-unification.md`; `2026-07-15-borderless-small-icon-actions.md`; `Icon.tsx`; `ProjectLedgerGroup.tsx`; `WorkLedger.tsx`; `base.css`; `sidebar.css`; `focused-popup-surface.test.ts`; `work-ledger-consolidation.test.ts`; and the command-palette browser fixture.
- Whole-repository search evidence: `Icon.tsx` defines the only `pin-tilted` registry entry; `base.css` defines its only transform; call sites are the project-group pin action, Mission/Chat row pin action, and pinned-project leading icon; project-group action sizing is centralized in `sidebar.css`; source assertions live in `focused-popup-surface.test.ts` and `work-ledger-consolidation.test.ts`; the command-palette fixture is the existing real-browser project-action geometry and screenshot benchmark.
- Independent agent feedback: none; the user did not request sub-agents.

## Diagnosis and design

The three action buttons share the same layout size, but the semantic angled-pin class rotates the Lucide icon and then scales the entire SVG to `0.7071`. The existing browser assertion therefore validates a similarly sized transformed bounding box while missing that the pin's internal strokes were reduced. The screenshot confirms the resulting optical mismatch.

Keep the shared Lucide registry and rotation, but replace the footprint-preserving scale with one optical scale owned by `icon-pin-tilted`. At the project action's current rendered icon size, the transformed pin box should occupy the 18-pixel button without changing button layout, spacing, behavior, or the adjacent plus/delete glyphs.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `Icon.tsx` | Keep the single Lucide `pin-tilted` identity unchanged. |
| `base.css` | Replace the under-sized shared transform scale; no feature-local override. |
| `ProjectLedgerGroup.tsx` | Keep the current semantic icon call and action behavior. |
| `WorkLedger.tsx` | Keep both current semantic icon calls so they inherit the same optical correction. |
| `focused-popup-surface.test.ts` | Assert the corrected shared transform and removal of the old scale. |
| `command-palette.test.ts` | Update the real rendered geometry assertion to distinguish the optically enlarged pin from the unchanged adjacent glyph boxes. |
| Spec indexes | Index this repair in the July record and root spec catalog. |

## Verification plan

1. Run the focused source tests and the Node command-palette browser fixture.
2. Inspect `.scratch/overlay-sidebar-project-actions.png` at desktop size; compare the pin against the adjacent plus and trash glyphs and verify the action rail remains aligned.
3. Run Overlay typecheck, the historical-doc links test, `git diff --check`, and a final diff review.
4. Commit only this task's hunks and push the current branch to legacy remote.

## Progress

- [x] Recall, prior decisions, complete call-site search, baseline browser fixture, and baseline screenshot review.
- [x] Shared optical-size repair and regression assertions.
- [x] Focused tests and real screenshot review.
- [ ] Second review, task-only commit, and legacy remote push.

## Verification record

- `bun test packages/overlay/test/focused-popup-surface.test.ts packages/overlay/test/project-delete-button.test.ts`: passed, 6 tests and 131 expectations.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/command-palette.test.ts`: passed twice after the implementation. The first post-change screenshot was contaminated by a transient Chromium black compositing capture; no browser-runner process remained, and an immediate isolated rerun produced a clean screenshot and passed in 19.4 seconds.
- Visual review: `.scratch/overlay-sidebar-project-actions.png` is clean on rerun; the angled pin, plus, and trash glyphs have comparable optical weight, remain centered, and preserve the existing action spacing.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: passed, 21 tests.
- `document-health.test.ts`: 73/74 passed. Its tracked-record assertion also reports four unrelated user-owned July records that are linked but still untracked; this task's new record will become tracked in the task-only commit.
- `git diff --check`: passed; final call-site and task-hunk review found no feature-local pin override or behavior change.
