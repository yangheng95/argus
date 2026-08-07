# Work Ledger Tooltip Compact Summary

Status: completed and delivered to legacy remote

## Recall

| Item | Detail |
| --- | --- |
| User request | The supplied Work Ledger hover popup is much too tall because it renders a long task request; make it compact like the popup shown for a short-title task. |
| Acceptance criteria | The existing Kobalte Tooltip remains the only hover surface. Its title remains one-line ellipsized; a Task request remains the canonical description and stays present in the accessible document, but its visible summary is limited to two lines. Task ID, project name, and the complete unlabeled path remain visible. A long multi-section request cannot push the popup beyond the desktop viewport or block row actions. |
| Hard constraints | Reuse `WorkLedger`, `Tooltip`, and the existing Work Ledger response as their current single owners. Do not remove the canonical Task description, add a second summary field/source, synthesize prose, parse Markdown, restore a native `title` tooltip, add a popup primitive, create a worktree, or touch the running OpenCorvus/Overlay. Desktop-only scope. Launch Playwright through Node and visually inspect task-scoped screenshots. Preserve the unrelated local scrollbar/rail/shadow changes. Commit subjects use `dsw-33987` and push to `legacy-remote/work-v0.0.8beta-yr-0717`. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-95553b07-1168-4efb-bfe2-37ab8339036b.png`, inspected at original resolution. The popup is taller than the viewport because the exact Task request contains multiple Markdown sections and has no visual line limit. |
| Sources read | `AGENTS.md`; Browser control skill; current Overlay card architecture; `2026-07-17-task-hover-description-and-borderless-worktree.md`; `2026-07-17-work-ledger-tooltip-identity-path-integration.md`; current `WorkLedger.tsx`, `work-ledger.css`, `work-ledger-consolidation.test.ts`, and `project-ledger-group-browser.test.ts`. |
| Whole-repository search evidence | `WorkLedger.tsx` is the only producer of `work-row-summary-tooltip__description`; it reads the exact Task-only `row.description`. `work-ledger.css` has the only presentation rule and currently uses unrestricted `white-space: pre-wrap`. The focused source and Node browser fixtures are the only direct regression owners. Backend projection, OpenAPI, Software Development Kit, localization, and tooltip composition do not need to change. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Work began from `a7c38dccc` on `work-v0.0.8beta-yr-0717`, synchronized with `legacy-remote`. Concurrent Right Dock planning advanced the same local branch through `17b81e916` and included this record's README index links; this implementation remains a separate exact patch on top. Existing unrelated dirty files remain excluded. |

## Causal chain

1. Task description projection is correct: the tooltip receives the persisted full Task request, including long Markdown context.
2. The component renders that string once, but `.work-row-summary-tooltip__description` has no line limit, so every paragraph contributes to popup geometry.
3. Floating placement cannot make content shorter than the viewport; the oversized card therefore begins outside the visible desktop area and no longer resembles the compact short-request popup.
4. The root presentation repair is a two-line CSS clamp on the existing description node. This preserves the exact canonical text and accessible tooltip ownership while bounding only its visual contribution.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `packages/overlay/src/components/WorkLedger.tsx` | Keep unchanged: the exact Task-only description stays in the one existing Tooltip. |
| `packages/overlay/src/styles/surfaces/work-ledger.css` | Replace unrestricted description flow with the established multi-line clamp recipe: two lines, vertical box orientation, hidden overflow, and wrapping. Preserve the unrelated unstaged scrollbar change. |
| `packages/overlay/test/work-ledger-consolidation.test.ts` | Assert the compact two-line description recipe and unchanged exact-description owner. |
| `packages/overlay/test/browser/project-ledger-group-browser.test.ts` | Give the first Task a genuinely long multi-section request; assert exact DOM text, two-line computed geometry, bounded/in-viewport popup height, existing ID/path facts, pointer transparency, and save a compact screenshot. |
| Backend/API/SDK/i18n | Retain unchanged; this is presentation geometry, not a data-contract change. |

## Implementation and verification plan

1. Add the long-request browser fixture and source/browser assertions, and observe the compact-height assertion fail before the CSS change.
2. Apply the feature-local two-line description clamp without changing tooltip content or data flow.
3. Run the focused Work Ledger suite, Overlay typecheck/internationalization, and the Node-launched desktop browser fixture.
4. Inspect the scoped and full-page screenshots at original resolution, correct any remaining overflow, then run documentation health and exact diff review.
5. Commit only task-owned files and CSS hunks, push to legacy remote, and record the delivery result.

## Verification commands

```powershell
bun test packages/overlay/test/work-ledger-consolidation.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Result

- The exact persisted Task request remains in the one existing Kobalte Tooltip and in its accessible document text; no summary field, Markdown parser, or hover fetch was added.
- The description now reuses the repository's established multi-line clamp recipe with a two-line limit and normal visual whitespace. Long multi-section requests therefore render as a compact excerpt with an ellipsis instead of expanding beyond the viewport.
- The one-line title, time, Task ID, project name, complete unlabeled path, pointer-transparent popup, and row action click path remain unchanged.
- The real long-request fixture produced a `300x214` scoped popup screenshot fully inside the `1180x760` desktop viewport. Both the scoped popup and full-page screenshots were inspected at original resolution.
- No running OpenCorvus/Overlay process was restarted or otherwise touched, and no worktree was created.

## Verification record

| Check | Result |
| --- | --- |
| Focused Work Ledger source suite | Passed: 8 tests, 300 expectations. The new compact-style assertion was observed failing before the CSS repair. |
| Overlay typecheck and internationalization | Passed. |
| Node-launched desktop browser fixture | Passed: 1 real browser test. It uses a long multi-section Task request and proves exact DOM text, two-line clipped geometry, vertical overflow, in-viewport popup bounds, ID/path preservation, tooltip dismissal, and the adjacent Mission pin click path. |
| Visual review | Passed for `.scratch/work-ledger-row-integrated-tooltip-detail.png` (`300x214`) and `.scratch/work-ledger-row-time-tooltip.png` (`1180x760`). The popup now matches short-request density and no longer extends outside the visible desktop. |
| Documentation health | Passed: 81 tests on the isolated rerun. The earlier parallel run was invalidated by a concurrently untracked Right Dock record and system-load timeout; after that record became tracked, the same checks passed without product changes. |
| Diff health | Passed: `git diff --cached --check`; staged files are limited to the feature CSS hunk, the two direct regression owners, and this record. |
| Delivery | Implementation commit `ca19ba619` passed the legacy remote pre-push repository typecheck, route inventory, generated documentation, Overlay internationalization, and secret scan, then pushed to `legacy-remote/work-v0.0.8beta-yr-0717`. |

## Progress

- [x] User evidence, current composition, prior records, and direct call sites inspected.
- [x] Regression assertions added and observed failing.
- [x] Compact description implemented and visually accepted.
- [x] Focused/typecheck/i18n/browser/docs verification passed.
- [x] Exact diff review completed.
- [x] Commit and legacy remote push completed.
