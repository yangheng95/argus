# Work Ledger Tooltip Identity And Path Integration

Status: completed and delivered to legacy remote

## Recall

| Item | Detail |
| --- | --- |
| User request | Integrate the previously separate hover information into the current Work Ledger hover popup; keep the popup title to one line with an ellipsis when it overflows; visibly show the Task ID and path; and show the path directly without a `Code path` field label. |
| Acceptance criteria | Hovering the Task row main action opens exactly one Kobalte Tooltip. It contains the single-line ellipsized title, existing time and Task request, visible Task ID, project name, and complete unlabeled path. The directory is no longer hidden in a native `title` tooltip. A real desktop browser assertion proves the content, computed title overflow contract, absence of native title attributes in the custom popup, full path wrapping, and a visually reviewed screenshot. |
| Hard constraints | Preserve `Tooltip`, `LedgerRowMainButton`, `Icon`, and Work Ledger response rows as the single mature owners. Do not add another popup, fetch-on-hover source, native-title fallback, custom overlay primitive, mobile/tablet scope, worktree, or running OpenCorvus/Overlay restart. Playwright must run through Node in the isolated existing fixture. Preserve all unrelated local left-rail scrollbar/width/shadow changes. Commit subjects use `dsw-33987` and delivery pushes to `legacy-remote/work-v0.0.8beta-yr-0717`. |
| Sources read | `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-17-work-ledger-hover-pin-row-parity.md`; `2026-07-17-task-hover-description-and-borderless-worktree.md`; current `WorkLedger.tsx`, `work-ledger.ts`, `work-ledger.css`, locale catalogs, `ui/Tooltip.tsx`, Work Ledger source tests, and `project-ledger-group-browser.test.ts`. |
| Whole-repository search evidence | `WorkLedger.tsx` is the only producer of `work-row-summary-tooltip`; the tooltip has exactly two direct test owners: `work-ledger-consolidation.test.ts` and `project-ledger-group-browser.test.ts`. `rowDirectory` is already the canonical path projection and the Task row `id` already crosses the Work Ledger response. The tooltip currently renders title/time/description/project name but hides `rowDirectory(row())` in the project element's native `title` attribute. No existing Work Ledger Task-ID or code-path locale keys exist. No backend, schema, route, or SDK change is required. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Work began from `eda14ccbe` on `work-v0.0.8beta-yr-0717`, already pushed to `legacy-remote`. Concurrent work advanced the same branch through `4c5cbaef1`; this change is integrated on top without rewriting or staging those owners' remaining files. The pre-existing unstaged scrollbar/rail/shadow changes remain preserved. |

## Causal chain

1. The supplied white rectangle is browser-native tooltip chrome, while the current Work Ledger summary is a Kobalte tooltip.
2. The native rectangle is directly triggered by `title={rowDirectory(row())}` inside the custom tooltip; the path is therefore projected through a second presentation source instead of being visible in the canonical card.
3. The Task ID already exists on the canonical row, but the tooltip never renders it. The title already has the correct CSS ellipsis primitives, but the browser test does not prove the one-line overflow behavior with a genuinely long title.
4. Kobalte's `DismissableLayer` assigns `pointer-events: auto` inline to tooltip content, while its Popper positioner is a separate hit-test surface. A wide read-only popup can therefore cover adjacent row actions unless both feature-owned layers are explicitly noninteractive.
5. The root repair is to delete the native `title` source, compose visible identity/path rows inside the existing Tooltip, make this read-only popup and its positioner pointer-transparent, and lock the rendered geometry, content, and action click path in the existing browser fixture.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `packages/overlay/src/components/WorkLedger.tsx` | Keep the one existing `Tooltip.Root`; show Task ID only for Task rows; render project name plus the full unlabeled directory as visible content; remove the directory `title` attribute. |
| `packages/overlay/src/styles/surfaces/work-ledger.css` | Keep the headline's `nowrap`/ellipsis contract; add feature-local identity/path layout and wrapping rules; override Kobalte's inline pointer behavior only for this read-only summary and its Popper positioner. Preserve the unrelated unstaged `scrollbar-gutter` removal. |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json` | Add only the Task ID label. The path is self-describing and intentionally has no field label. |
| `packages/overlay/test/work-ledger-consolidation.test.ts` | Assert one Tooltip owner, visible identity/path nodes, the removed native directory title, locale labels, and title/path CSS contracts. |
| `packages/overlay/test/browser/project-ledger-group-browser.test.ts` | Use a long Task title and path; assert exact ID/path/project/description, one-line ellipsis computed styles and real overflow, no tooltip descendant `title`, full path visibility/wrapping, pointer-transparent content/positioner descendants, a still-clickable row action, and save the scoped popup screenshot. |
| Backend Work Ledger projection and API | Retain unchanged: `id` and `directory` already cross the canonical row contract. |

## Implementation and verification plan

1. Extend the focused source/browser assertions to describe the visible identity/path composition and removal of the native tooltip source.
2. Implement the composition in the existing Tooltip and add only the required local styles and locale labels.
3. Run focused Work Ledger tests, Overlay typecheck/i18n, the Node-launched project-ledger browser fixture, and inspect the scoped desktop screenshot at original resolution.
4. Run documentation health, exact diff review, and whitespace checks; update this record with results, commit all task-owned files without unrelated local changes, and push the current branch to legacy remote.

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

- The existing Work Ledger Kobalte Tooltip is now the only Task hover-information surface. Its prior directory `title` attribute was deleted, so the browser-native white tooltip cannot compete with the canonical popup.
- The popup keeps title, relative/exact time, and Task request, then visibly adds Task ID, project name, and the complete canonical row directory without an unnecessary path label.
- Long titles remain one line with real overflow and CSS ellipsis. Task ID and the unlabeled path use the bundled monospaced family and `overflow-wrap: anywhere`, so neither value is silently clipped.
- The read-only summary and its Kobalte Popper positioner are pointer-transparent, so a popup that geometrically crosses the row action rail cannot block pin or other row actions.
- No backend projection or second hover fetch was introduced because `WorkLedgerTaskRow.id` and `.directory` were already the canonical data source.

## Verification record

| Check | Result |
| --- | --- |
| Focused Work Ledger source suite | Passed: 8 tests, 299 expectations. |
| Overlay internationalization check | Passed; `Task ID`/`任务 ID` resolves from the locale catalogs and no path-label key remains. |
| Overlay typecheck | Passed. |
| Node-launched desktop browser fixture | Passed: 1 real browser test after a fresh Vite build. It asserts exact title/description/Task ID/project/path, zero native `title` descendants, real title overflow with one-line ellipsis styles, wrapped full path, pointer-transparent tooltip/positioner surfaces, tooltip dismissal, and the real Mission pin action click path. |
| Visual review | Passed at original resolution for `.scratch/work-ledger-row-integrated-tooltip-detail.png` and `.scratch/work-ledger-row-time-tooltip.png`; the information hierarchy is readable and the popup does not cover the row action rail. |
| Documentation and diff health | Passed: 81 documentation tests, `git diff --cached --check`, and exact staged-file review. |
| Delivery | Implementation commit `9f469c13b` is synchronized with `legacy-remote/work-v0.0.8beta-yr-0717`. The pre-push repository typecheck, route inventory, generated documentation, Overlay internationalization, and secret scan all passed; a post-race fetch proved local and remote commit equality. |

## Progress

- [x] User reference, existing popup owner, prior records, and whole-repository call sites inspected.
- [x] Regression assertions added and observed failing before the production change.
- [x] Single Tooltip composition, locale labels, and feature-local wrapping styles implemented.
- [x] Focused source, i18n, typecheck, real-browser, screenshot, and manual visual acceptance completed.
- [x] Documentation health and exact diff review.
- [x] Commit and legacy remote push.

## Pointer-event acceptance correction

The original pointer-transparent acceptance was a false green and is superseded. Kobalte's inline
`pointer-events: auto` made the Content win over a transparent Popper positioner; replacing it with `inert` would
remove the tooltip from the accessibility tree. More importantly, both approaches hid the actual geometry error:
the Trigger's main button shrinks when the action rail appears, so a `right-start` popup anchored to that button
overlaps the adjacent actions.

The correction keeps the existing Kobalte Tooltip fully interactive and accessible. Its Trigger remains the row
main button, while Kobalte's public `getAnchorRect` receives the complete row rectangle from the row keyboard
helper's existing ref. No second ref, dependency patch, pointer-event override, inert subtree or placement offset
formula is introduced. The real desktop browser replay proves zero horizontal intersection with the row,
Content hover persistence, `role=tooltip` plus the exact `aria-describedby` relation, keyboard focus transfer into
the action rail, real pin persistence/reorder, and visually reviewed non-overlapping screenshots. This correction
was committed as `22225bc296`, merged with the concurrent sidecar lease-GC delivery, and pushed to legacy remote as
`6ad7cd65eb`; it must not be attributed to the earlier `9f469c13b` delivery.
