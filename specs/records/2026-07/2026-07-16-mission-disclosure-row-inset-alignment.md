# Mission Disclosure Row Inset Alignment

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User request                     | The supplied Projects screenshot shows that a Mission with five child Tasks starts farther left than Missions without child Tasks; determine whether the row is crossing the shared alignment boundary and repair it.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Acceptance criteria              | Mission entity icons keep the same left inset with and without child Tasks; the child-count disclosure remains immediately after the Mission icon; the row stays within the Projects list bounds; title, status, timestamp, disclosure behavior, and nested Task hierarchy remain unchanged; focused source tests and a visible Node-launched browser screenshot pass.                                                                                                                                                                                                                                                                                       |
| Hard constraints                 | Reuse `WorkLedgerRowView`, the shared `Button`/`Icon` primitives, and the existing `task-row-mini` inset; do not add a second renderer, compatibility path, mobile/tablet scope, fake preview source, or running OpenCorvus/Overlay restart; launch Playwright with Node and preserve unrelated dirty-worktree files.                                                                                                                                                                                                                                                                                                                                        |
| Sources read                     | `AGENTS.md`; Browser control skill; `specs/README.md`; `specs/current/architecture/07-panel.md`; `2026-07-15-workspace-search-mission-disclosure-and-launcher-copy.md`; `2026-07-16-work-ledger-density-worktree-visual-refinement.md`; `WorkLedger.tsx`; `sidebar.css`; `work-ledger.css`; `work-ledger-consolidation.test.ts`; `left-dock-compact-browser.test.ts`; and the supplied 371 x 346 screenshot.                                                                                                                                                                                                                                                 |
| Whole-repository search evidence | `rg` enumerated every `mission-task-disclosure`, `data-has-task-disclosure`, `.work-row`, `.task-row-mini`, `grid-template-columns`, and `padding-inline-start` owner. `WorkLedgerRowView` is the only live disclosure renderer. `sidebar.css` owns the canonical `9px` nested-row start inset. The conditional rule in `work-ledger.css` is the only rule that resets that inset to zero. Focused source coverage is in `work-ledger-consolidation.test.ts`; real headed geometry and screenshot coverage is in `left-dock-compact-browser.test.ts`, while `titlebar-toolbar-toggle-browser.test.ts` retains the complete application interaction coverage. |
| Independent agent feedback       | None. The user did not request sub-agents, and the current collaboration policy forbids unrequested delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Git baseline                     | Current branch and legacy remote were synchronized at `bc187516b`. The pre-task push hook passed typecheck, route, documentation, i18n, and secret checks. Unrelated edits in `project-ledger-group-browser.test.ts` and `2026-07-16-overlay-bundled-open-font-family.md` remain user-owned and untouched.                                                                                                                                                                                                                                                                                                                                                          |

## Root cause

The Mission disclosure layout correctly inserts a dedicated grid column between
the Mission glyph and title, but its conditional CSS also sets
`padding-inline-start: 0`. That overrides the canonical `9px` start inset from
`.task-row-mini` only when child Tasks exist. The count is therefore not merely
occupying its intentional inline column: the complete Mission row, including
its entity glyph, shifts left across the shared Projects-row boundary. Mission
rows without children retain the canonical inset, which makes the defect appear
only when the disclosure mounts.

## Call-site disposition and implementation plan

| Surface                                                    | Decision                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkLedgerRowView`                                        | Keep the existing icon, disclosure, body, and right-rail DOM order and all behavior unchanged.                                                                                                             |
| `.task-row-mini` in `sidebar.css`                          | Keep the canonical `9px` nested-row inset as the single source.                                                                                                                                            |
| `.work-row[data-has-task-disclosure]` in `work-ledger.css` | Remove only the zero-inset override; retain the disclosure grid columns and hover action-rail projection.                                                                                                  |
| `work-ledger-consolidation.test.ts`                        | Assert that the disclosure specialization does not override `padding-inline-start`.                                                                                                                        |
| `left-dock-compact-browser.test.ts`                        | Add sibling Missions with and without child Tasks, compare both Mission glyph left edges and row bounds at UI scale 1.5, and capture the complete Projects region in its existing headed Node browser run. |

1. Add focused failing source and browser geometry assertions for the shared
   Mission glyph inset and in-bounds row geometry.
2. Delete the conditional zero-inset override so the existing sidebar primitive
   owns both row variants.
3. Run focused unit, Overlay typecheck/i18n, and visible Node browser acceptance;
   inspect the task-scoped screenshot and correct any remaining visual defect.
4. Run spec health, formatting, diff review, commit with the `dsw-33987`
   prefix, push the current branch to legacy remote, and re-check the pushed state.

## Verification

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- Visible Node-launched `left-dock-compact-browser.test.ts` with fresh
  Mission-with-children and Mission-without-children geometry plus screenshot.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `git diff --check` and a second diff/screenshot review.

The first visible browser run also proved that this existing density fixture
still asserted superseded 48px/45px scaled navigation/work-row heights while
the canonical sidebar tokens now define 30px/26px, or 45px/39px at the
fixture's 1.5 scale. The fixture will be corrected to those existing token
values and both new Mission rows will participate in its ordered non-overlap
check; no production density token changes are part of this repair.

## Result

- Removed the disclosure-only `padding-inline-start: 0`; the canonical
  `.task-row-mini` inset now owns both Mission row variants.
- The focused source regression passed 8/8. Overlay TypeScript passed, and the
  complete titlebar/Work Ledger browser regression passed 2/2 after rebuilding
  the production Overlay bundle.
- The visible Node-launched desktop fixture passed after replacing its stale
  density expectations with the current token values. The task-scoped narrow
  screenshot was manually reviewed at a 350px Projects width: Missions with
  and without child Tasks both place their entity glyph at 59.071px, both rows
  end at 344.000px inside the project surface, count/disclosure remains after
  the entity glyph, titles ellipsize, and the nested Task remains distinct.
- Historical-link checks passed 21/21, product documentation checks passed
  4/4, `git diff --check` passed, and the exact visual evidence is
  `.scratch/mission-disclosure-inset-alignment.png`.
