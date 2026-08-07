# Work Ledger Hover, Pin, And Row Parity

Status: implemented and visually accepted; delivery commit and push pending

## Recall

| Item | Detail |
| --- | --- |
| User request | Correct the Work Ledger pin icon and pin-click result; remove visible row timestamps and expose time through a Codex-style hover popup; eliminate the two-tone Project hover background; and render Task, Mission, Chat, and Mission-owned Task rows with the same row height and text size instead of using height or background to communicate parent/child hierarchy. |
| Acceptance criteria | Every Work Ledger pin surface uses the canonical Lucide pin at the requested right-leaning orientation and a Mission/Chat pin click persists, reloads, reorders, and exposes the pinned state. No Task/Mission/Chat row renders a trailing timestamp; hovering/focusing its main label opens one Kobalte tooltip containing title, relative time, exact time, and project context. A Project row has one hover/selected wash owner with no nested darker rectangle. Top-level and Mission-owned rows have equal computed height, title size, line height, and navigation-row background semantics. Focused tests, Overlay typecheck/build, Node-started real-browser checks, scoped screenshots, and manual visual review pass. |
| Hard constraints | Keep `Icon`, `Button`, `Tooltip`, `ProjectLedgerGroup`, and the Work Ledger service/routes as the single mature primitive and behavior owners. Do not restore the retired public `pin-tilted` alias, add a handwritten icon, duplicate timestamp renderer, add a second selection/hover source, add mobile/tablet scope, create a worktree, or operate the user's running OpenCorvus/Overlay. Playwright runs through Node against the existing isolated fixture. Commit subjects start with `dsw-33987` and delivery pushes to `legacy-remote/work-v0.0.8beta-yr-0717`. |
| Sources read | `AGENTS.md`; Browser control skill; all five supplied crops; `specs/current/architecture/12-overlay-card-system.md`; Work Ledger pin/unpin, icon/popup, selection, density, pin optical-size, and primitive-convergence records from 2026-07-12 through 2026-07-17; current `WorkLedger.tsx`, `ProjectLedgerGroup.tsx`, `LedgerRowMainButton.tsx`, `ui/{Button,Icon,Tooltip}.tsx`, `ui/Icon.lucide.ts`, `time.ts`, `navigation-row.css`, `icon.css`, `button.css`, `sidebar.css`, `work-ledger.css`, Work Ledger services/routes, and focused source/browser tests. |
| Whole-repository search evidence | The canonical `pin` entry in `ui/Icon.lucide.ts` is the only production Lucide pin name; three Work Ledger call-site families consume it: Project menu, Mission/Chat row action, and pinned Project leading icon. The 2026-07-17 icon convergence removed the prior right-leaning class together with the retired `pin-tilted` alias. `relativeTime`/`detailStamp` in `utils/time.ts` are the one timestamp formatting source; `WorkLedger.tsx` is the only row-tail timestamp renderer. `ProjectLedgerGroup.tsx` applies `oc-navigation-row` to both `.project-group-head` and its nested toggle; `navigation-row.css` therefore paints two hover layers. `work-ledger.css` sets every `.work-row` to `--sidebar-work-row-height` but overrides `.work-row-child .work-row` to the shorter `--sidebar-nested-row-height`. The existing browser fixture is the one real Project/Mission/Task/Chat geometry and screenshot owner; backend route coverage already proves Session persistence and ordering. |
| Baseline evidence | `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts` rebuilt the current Overlay and failed before the old assertion because the toggle now renders `oc-button oc-navigation-row`, proving the unreviewed nested feedback source. `.scratch/project-ledger-groups-compact-no-divider.png` shows trailing dates consuming the title lane and the current row density. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Clean `work-v0.0.8beta-yr-0717` at `c9ac4aa3c`, pushed to `legacy-remote` before implementation. |

## Causal chain

1. **Observable:** the pin is vertical, timestamps crowd every row, Project hover can show a darker inner rectangle, and Mission-owned Tasks are shorter than their parent/sibling rows.
2. **Direct triggers:** icon convergence removed the pin's transform; `WorkLedgerRowView` renders a trailing `small`; the Project head and toggle both opt into `oc-navigation-row`; the child-row selector replaces the shared row height.
3. **Deep cause:** the convergence changed semantic aliases and primitive adoption without preserving three visual invariants at the canonical owners, while the browser fixture retained an assertion for the pre-convergence toggle class and therefore did not complete after the change.
4. **Root repair:** keep one canonical `pin` name and attach its orientation inside the icon primitive; move time presentation from row geometry into one `Tooltip` composition using the existing formatters; keep the Project head as the only feedback container; and delete the child-only height override so hierarchy is expressed only by disclosure/indentation.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `ui/Icon.lucide.ts` and `styles/primitives/icon.css` | Keep the single public `pin` identity, add one canonical class to its registry record, and own the right-leaning transform in the icon primitive stylesheet. Do not recreate `pin-tilted`. |
| Project menu, Mission/Chat pin action, pinned Project row | Keep existing `<Icon name="pin">` call sites and behavior so all inherit the same canonical orientation. |
| `WorkLedgerRowView` timestamp | Delete the visible `.work-row-stamp`; reuse `relativeTime` and `detailStamp` inside one Kobalte hover/focus tooltip attached to the existing main row button. Preserve status dots/spinners and row actions. |
| Tooltip copy | Show the task title and relative time first, then exact time and project label/directory with the existing Lucide folder icon. Use shared tooltip chrome; feature CSS owns internal grid only. |
| Retired native-title copy | Delete the now-unreferenced `task.reorder_button_title` entries from both locale catalogs; the row no longer exposes an ancestor native title that could compete with the canonical tooltip. `check:i18n` remains the dead-key verifier. |
| `ProjectLedgerGroup` | Remove `oc-navigation-row` from the nested toggle. `.project-group-head` remains the only hover/selected feedback owner and continues to contain the real Button and action rail. |
| Mission child list | Preserve the established disclosure and left indentation; delete only the shorter child-row height override. No child-specific background or typography rule is introduced. |
| Pin click behavior | Extend the existing browser fixture with a mutable Session pin endpoint and assert request body, refreshed `data-pinned`, canonical icon transform, and pinned-first order. Backend persistence logic remains unchanged. |
| Focused source/browser tests | Update stale Project toggle class expectations, assert the absence of row-tail timestamps and nested navigation feedback, compare root/child computed geometry, open the real hover tooltip, and save scoped Project hover, tooltip, equal-row, and pin-result screenshots. |

## Verification plan

1. Add focused failing source/browser assertions before changing production owners.
2. Implement the canonical icon orientation, tooltip composition, single Project feedback owner, and equal row geometry.
3. Run focused unit tests, Overlay typecheck/i18n/build, and the Node browser fixture.
4. Inspect every new scoped desktop screenshot at original resolution and iterate until the four supplied defects are absent.
5. Run spec health, whitespace checks, and a second exact-diff/call-site review; commit with the required prefix and push the current branch to legacy remote.

## Progress

- [x] Supplied references, prior decisions, whole-repository call sites, and baseline browser failure inspected.
- [x] Regression tests updated.
- [x] Production implementation complete.
- [x] Real browser and screenshot acceptance complete.
- [x] Second exact-diff and call-site review complete; commit and legacy remote push remain delivery metadata outside this pre-commit record.

## Codex review feedback

- The first browser pass exposed the stale nested Project toggle class expectation; the production defect was the nested `oc-navigation-row`, not the parent Project surface. The implementation removes the nested owner and the browser assertion now checks a transparent inner Button against one non-transparent parent hover wash.
- The first tooltip screenshot used an old fixture timestamp, so `relativeTime` legitimately returned the same absolute value as `detailStamp`. The fixture now uses current timestamps and the tooltip omits the exact-time row only when both formatters return the same string; the reviewed screenshot shows `1m ago` plus one distinct exact timestamp.
- The shared titlebar browser fixture initially failed because it still required an untransformed 14-pixel pin. Historical optical-size evidence proves that `rotate(45deg) scale(1)` and the resulting approximately `14 * sqrt(2)` transformed box are intentional. The test now verifies the transformed optical footprint instead of shrinking the canonical pin.
- A full Overlay unit sweep reached an unrelated concurrent message-flow style assertion failure in `chat-bubble-role-distinction.test.ts`. No Work Ledger owner participates in that failure. The task-scoped 38-test suite, typecheck, translations, build, both real browser fixtures, and documentation health all pass.

## Verification record

- `bun test packages/overlay/test/focused-popup-surface.test.ts packages/overlay/test/navigation-row-primitive.test.ts packages/overlay/test/overlay-left-rail-density.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/flat-redesign-icon-coverage.test.ts`: passed, 38 tests and 494 expectations.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed with catalog hash `8086d1b8b04d6219`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts`: passed, 2 browser tests.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts`: production build passed and the unified Work Ledger browser test passed.
- Visual review at original resolution passed for `.scratch/work-ledger-project-single-hover-surface.png`, `.scratch/work-ledger-row-time-tooltip.png`, `.scratch/work-ledger-equal-parent-child-rows.png`, and `.scratch/work-ledger-pin-click-result.png`.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`: passed, 81 tests and 1282 expectations.
- `git diff --check` and cached diff whitespace checks passed.
