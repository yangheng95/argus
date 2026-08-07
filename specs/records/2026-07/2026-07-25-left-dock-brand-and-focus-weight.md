# Left Dock Brand And Focus Weight

## Recall

### User requirement

- Replace the visible `OpenCorvus Workspace` identity with `OpenCorvus`.
- Move the brand to the right so its wordmark aligns with the `New chat` / `New mission` icon column.
- Keep Project names at normal weight.
- Render only the currently focused Chat or Mission title in strong weight; all other left-Dock record titles remain normal.

### Acceptance

- The canonical brand component renders one visible and accessible `OpenCorvus` wordmark with no `Workspace` label.
- The wordmark and primary navigation icons share the same rendered inline start at desktop scale.
- Every `.project-group-name` computes to `--ui-font-weight-body`.
- Every Work Ledger title computes to `--ui-font-weight-body`, except an active Mission or Chat, which computes to `--ui-font-weight-strong`.
- Existing selection identity, row geometry, truncation, icons, hover/focus feedback, actions, and navigation behavior remain unchanged.
- Focused source tests, Overlay typecheck, real Vite rendering, Node-launched Playwright geometry, and inspected task-scoped screenshots pass.

### Hard constraints

- Preserve all concurrent worktree changes and stage only task-owned hunks.
- Keep `TitlebarBrand`, `ProjectLedgerGroup`, and `WorkLedger` as the single production owners; add no alternate label, row, selection state, fallback, or gate.
- Derive brand alignment from the primary navigation icon geometry instead of a selector-local pixel nudge.
- Desktop-only scope. Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus / Overlay process.
- Launch Playwright through Node, never Bun.
- Commit subjects start with `dsw-33987` and push the current main branch to `myhexin`.

### Sources read

- User-supplied screenshot `codex-clipboard-39d3812c-db5a-4a46-9675-a97b03b187b3.png`.
- `specs/records/2026-07/2026-07-25-titlebar-brand-wordmark-scale.md`.
- `specs/records/2026-07/2026-07-25-left-dock-direct-launch-and-alignment.md`.
- `specs/records/2026-07/2026-07-18-project-name-normal-font-weight.md`.
- `packages/overlay/src/components/titlebar/TitlebarBrand.tsx`.
- `packages/overlay/src/components/{App,WorkLedger,ProjectLedgerGroup,LedgerRowMainButton}.tsx`.
- `packages/overlay/src/styles/tokens/design-language.css`.
- `packages/overlay/src/styles/surfaces/{titlebar,sidebar,work-ledger}.css`.
- Focused titlebar, Work Ledger, architecture, density, and Node browser tests.

### Whole-repository grep

| Owner / call site                                     | Finding and disposition                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TitlebarBrand.tsx`                                   | Sole production brand markup. Remove the localized suffix and keep one accessible `OpenCorvus` identity.                                                                                                                                                      |
| `brand.workspace_label` catalogs                      | No other production consumer. Delete both dead locale entries instead of retaining an unused compatibility label.                                                                                                                                             |
| `.titlebar-brand-identity__label`                     | One production selector plus titlebar/source/browser assertions. Delete the retired selector and update every assertion.                                                                                                                                      |
| `.workspace-contextbar`                               | Sole brand-row geometry owner. Consume the shared primary-navigation icon inset for its inline start; preserve the trailing action centerline.                                                                                                                |
| `.sidebar-codex-static-nav` / `.sidebar-codex-action` | Current primary-icon geometry is split across body, section, and control insets. Project these values through shared tokens so the brand and menu cannot drift.                                                                                               |
| `.project-group-name`                                 | Sole production Project-name selector already consumes `--ui-font-weight-body`; preserve it and strengthen rendered coverage.                                                                                                                                 |
| `WorkLedger.tsx` row title                            | Sole production record-title markup uses `<strong>` for every row, making every Mission, Chat, and Task bold independently of focus. Replace it with a neutral `.work-row-title` span.                                                                        |
| Work Ledger `data-active` / `selected()`              | Existing canonical selected Chat/Mission/Task identity. Reuse it only as the CSS projection source; add no new focus state.                                                                                                                                   |
| `work-ledger.css`                                     | Replace `strong` selectors with `.work-row-title`, assign body weight by default, and assign strong weight only to active Mission/Chat rows.                                                                                                                  |
| Browser selectors                                     | `hover-action-geometry` and `titlebar-toolbar-toggle-browser` query the retired `strong` element; update them to the canonical title class. Extend the compact Dock fixture with rendered weight and brand-icon alignment assertions plus scoped screenshots. |
| Static guards/tests                                   | Update titlebar, brand strip, architecture guard, Work Ledger, and density contracts to reject retired label/strong-title sources and require the new single-source rules.                                                                                    |

### Independent-agent feedback

- None. The user did not request sub-agents, and the affected brand/typography surface is one tightly coupled owner chain.

## Cause chain

The `Workspace` suffix is real production markup and is therefore present in both the visual and accessible brand. The brand row starts from an independent 14px inset, while the `New chat` icon begins after the shared body, navigation-section, and control insets; those two independent geometries cannot stay aligned. Separately, selection is already projected truthfully through `data-active`, but the title itself is always a semantic `<strong>`, so inactive rows remain bold. The project name is not a second defect in current source: its canonical selector already uses body weight. The repair removes the retired suffix, unifies brand/icon geometry, and lets the existing selected-row state be the only source of strong Chat/Mission emphasis.

## Implementation

1. Introduce shared primary-navigation geometry tokens and consume the icon-axis inset from the navigation rows and workspace brand start.
2. Reduce `TitlebarBrand` to one accessible wordmark and delete the now-unused locale/style/test label path.
3. Replace Work Ledger's unconditional `strong` title element with `.work-row-title`; set body weight at rest and strong weight only for active Mission/Chat rows.
4. Extend source and Node browser tests for brand copy, icon-axis geometry, Project/body weight, inactive record/body weight, and active Mission/Chat strong weight.
5. Run focused tests, Overlay typecheck/build, Node Playwright Vite acceptance, inspect screenshots, run documentation health, review the scoped diff, commit task-owned hunks, and push to `myhexin/v0.0.18beta`.

## Progress

- [x] Inspect the screenshot, prior records, canonical owners, tests, dirty-worktree overlap, and remote baseline.
- [x] Record Recall, cause chain, complete call-site disposition, and verification plan.
- [x] Implement source and regression coverage.
- [x] Complete Vite/browser visual acceptance and second review.
- [x] Commit and push task-owned changes.

## User correction after first Vite review

- The first implementation aligned `OpenCorvus` with the navigation text. The real Vite screenshot made the excessive inset visible: the wordmark measured at x=52 while the `New chat` icon column began near x=28.
- The user clarified that the brand must align with the `New chat` icon, not its text. This replaces the earlier text-column interpretation; the source token, browser oracle, screenshot review, and descriptions above now use the icon axis.

## Verification

- Focused source coverage: 28 tests and 604 assertions passed; the final narrowed rerun passed 11 tests and 131 assertions.
- Node-launched compact Dock browser acceptance passed in light and dark themes. The inspected light screenshot is `.scratch/left-dock-navigation-row-height-light.png`.
- Real Vite rendering measured the `OpenCorvus` wordmark and `New chat` icon at x=26 (`brandIconDelta=0`), with no Workspace suffix.
- Real Vite interaction verified selected Chat and Mission titles at weight 600, inactive Mission/Chat/Task titles at weight 400, and Project names at weight 400.
- Overlay TypeScript typecheck and i18n catalog checks passed.
- Overlay Vite production build passed.
- Historical-doc links passed 21/21 and product-doc checks passed 8/8. Document health passed 90 checks and reported one tracked-record failure caused by two unrelated concurrently added, still-untracked July records referenced by the shared index.
- `git diff --check` passed after the scoped second review.
