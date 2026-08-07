# Review Codex Reference Parity

Status: implemented, visually verified, and ready for delivery

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Adjust the project Review surface to the supplied Codex review screenshot; exact one-to-one copying is explicitly allowed. |
| Acceptance criteria | At the same normalized desktop Dock width, the Review header, rounded tab, leading Files icon, Review label, tab-close action, add action, Dock-close action, and left-aligned `No file changes for this task` state match the reference geometry and quiet light-theme treatment. Preserve Review data, file-diff behavior, add/close/selection/overflow interaction, keyboard semantics, and the one canonical Right Dock tab implementation. A real built desktop fixture must be captured and personally compared with the supplied screenshot after implementation. |
| Hard constraints | Desktop-only scope. Keep the shared Solid/Kobalte `Tabs`, `TabList`, `Tab`, `Button`, and `Icon` primitives; do not introduce a parallel Review header, local state, iframe, query override, fallback, or handwritten substitute control. Use Node for Playwright fixtures. Do not restart or disturb the user's running OpenCorvus/Overlay. Commit subjects start with `dsw-33987` and push to `legacy-remote`. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-fd70a875-5d7b-4068-82eb-19060e19c55d.png`, inspected at its original 725x1222 resolution. The reference was also normalized to the current 360px fixture width at `.scratch/codex-review-reference-360.png`. |
| Quantitative baseline | The supplied reference capsule occupies physical x=16..222 and y=11..66; normalized to the current fixture it is about 104x28px at x=8/y=6. Its empty copy begins around x=7/y=50 and has a roughly 157x11px ink box. The current built fixture `.scratch/right-dock-review-changes-only.png` renders a 118x32px capsule at x=8/y=8 and a roughly 179x12px empty-copy ink box beginning at x=7/y=60. Palette ownership is already aligned: both use white canvas and `rgb(240 240 240)` capsule material. |
| Sources read | Repository `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/99-principles.md`; `2026-07-14-right-dock-header-height-and-seam.md`; `2026-07-17-right-dock-codex-capsule-tabs.md`; `2026-07-18-work-ledger-hover-and-right-dock-visible-multi-tabs.md`; current `RightDock.tsx`, `FileChangesPanel.tsx`, `ChangesPanel.tsx`, `FileChangesView.tsx`, shared Tabs/Button/Icon primitives, design-language tokens, `header.css`, `workspace.css`, `activity.css`, `changes.css`, `empty-state.css`, and focused source/browser tests. |
| Whole-repository grep | `RightDock.tsx` is the only Right Dock tab/add/close DOM and state owner. `workspace.css` is the only `.right-dock-tabs`, shell, tab, close, add, overflow, and body geometry owner. `--ui-panel-header-height` is the intentional single height source shared by `.chat-header.oc-surface-header` in `header.css` and `.right-dock-tabs`; `design-density-tokens.test.ts`, `workspace-surface-continuity.test.ts`, and the titlebar browser fixture protect that continuity. `main.tsx` mounts the one `FileChangesPanel` for the `diff` TabPanel. `FileChangesView.tsx` is the sole `files.none` producer. `activity.css` owns the already-correct 6px Review body inset. `empty-state.css` owns the generic 14px `.empty-hint`; `changes.css` is the feature-local Review list/empty-state owner. `en-US.json` and `zh-CN.json` already contain the correct single strings. Direct regression owners are `right-dock-panel-ownership.test.ts`, `review-changes-empty-dock-browser.test.ts`, and `terminal-reference-visual-browser.test.ts`; the existing `titlebar-toolbar-toggle-browser.test.ts` covers shared header continuity plus adjacent add/close/selection/overflow behavior. No backend, route, schema, SDK, database, or locale change is required. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation. |
| Git baseline | Branch `work-v0.0.9beta-yr-0718` started this task clean at `d6289d1c2`, equal to `legacy-remote/work-v0.0.9beta-yr-0718`; the baseline push and repository hooks passed before this record was written. |

## Causal chain

1. **Observable mismatch:** Review has the right information architecture and palette, but the current tab is wider/taller, the toolbar is taller, its glyphs are larger, and the empty-state line starts about ten pixels too low at the normalized comparison width.
2. **Direct trigger:** the shared Chat/Right-Dock header token is 48px and the Dock projects 32px control/icon-button density. The reference instead uses a 40px workspace header with a 28px control row. The Review tab also uses 14px control text and standard 14px icons, while the reference ink geometry aligns with the existing 12px small-font and compact-icon tokens.
3. **Root design cause:** a previous correction correctly made Chat and Right Dock share one height, then later work converged tab structure/material and multi-tab overflow, but the shared header and Dock control density remained larger than the supplied Codex reference. Review data and state are not involved. The correct repair changes the shared token; a Dock-only height override would violate the existing seam decision and create a second source.
4. **Why earlier work did not finish parity:** the existing browser fixture asserts only title ownership and empty text; the terminal fixture allows any tab width from 112px to 240px and fixes height at 32px. Those assertions preserve behavior but cannot detect the measured Codex density mismatch.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `packages/overlay/src/components/RightDock.tsx` | Keep the canonical Tabs/Button/state structure. Project existing compact Icon sizing for the tab-leading icon and the global add/Dock-close glyphs; tab close already uses the compact icon. |
| `packages/overlay/src/styles/tokens/design-language.css` | Change the single shared panel-header token from 48px to the measured 40px Codex desktop height. Do not add a second Review/Dock header token. |
| `packages/overlay/src/styles/surfaces/header.css` | Keep Chat bound to the shared panel-header token, preserving one row height and a continuous Chat/Dock top edge. |
| `packages/overlay/src/styles/surfaces/workspace.css` | Keep Dock bound to the same shared header token. Derive one local 28px Dock-control height from that header minus its two existing 6px block insets, and project it to tabs/icon Buttons. Keep x=8 header inset, 8px radius, `rgb(240 240 240)` material, content-sized bounded tabs, overflow calculation, and panel body ownership. Use the existing 6px gap, 12px leading inset, compact label token, and close-reservation expression instead of a second component. |
| `packages/overlay/src/styles/surfaces/changes.css` | Project the existing 12px small-font token only onto Review empty hints so the supplied empty-state copy matches without changing generic empty states elsewhere. |
| `activity.css`, `empty-state.css`, `FileChangesPanel.tsx`, `ChangesPanel.tsx`, `FileChangesView.tsx`, locales | Keep unchanged; they already own the correct 6px content inset, empty-state role/color/line-height, single Review view, data resolution, and copy. |
| `right-dock-panel-ownership.test.ts` | Replace the stale 48/32/14 geometry contract with the derived compact Dock recipe and compact Icon projection, while continuing to assert primitive/state ownership and absence of a secondary implementation. |
| `review-changes-empty-dock-browser.test.ts` | Add reference-derived computed geometry and typography assertions plus the task-scoped screenshot. |
| `terminal-reference-visual-browser.test.ts` | Update the shared tab-height expectation to the canonical compact Dock projection; preserve multi-tab, overflow, PTY, focus, and close behavior coverage. |
| `design-density-tokens.test.ts`, `workspace-surface-continuity.test.ts`, titlebar browser fixture | Update the exact shared height expectation to 40px and continue proving Chat/Dock equality, zero seam, canonical single-source ownership, add menu, selection, close, and narrow overflow. |

## Codex self-review feedback

The initial written plan proposed making only the Dock use the existing generic
40px header token. A subsequent required history/call-site pass found the
implemented 2026-07-14 decision that Chat and Right Dock intentionally share
`--ui-panel-header-height` to prevent a visible workspace seam. A Dock-only
override would therefore reproduce the earlier root defect and violate the
single-source rule. This record is explicitly revised before production code:
the one shared token changes to 40px, both consumers remain bound to it, and
the browser acceptance continues to require equal computed heights.

## Implementation and verification plan

1. Commit and push this Recall/index update before production edits.
2. Add focused failing source and real-browser assertions for the measured reference geometry.
3. Update the shared Chat/Right-Dock header token, single Right Dock density recipe, compact Icon projection, and Review empty-copy typography.
4. Run focused source tests, Overlay typecheck/internationalization, and a production Vite build.
5. Run the Review fixture through the Node browser runner, inspect its screenshot at original resolution beside the normalized supplied reference, correct any remaining geometry/color/type mismatch, and rerun.
6. Run the multi-tab and adjacent Right Dock interaction fixtures, documentation health suites, whole-repository stale-contract grep, `git diff --check`, and a second complete diff/visual review.
7. Record the exact evidence, commit only task-owned files with the required prefix, and push the delivery branch through normal legacy remote hooks.

## Progress

- [x] Inspect the supplied and current screenshots at original resolution.
- [x] Read rules, architecture, historical decisions, implementation, primitives, tokens, tests, and git state.
- [x] Enumerate the complete owner/caller/test surface and quantify the mismatch.
- [x] Commit and push this Recall.
- [x] Add failing reference-derived regressions.
- [x] Implement the single-source density correction.
- [x] Complete the real-page screenshot correction and adjacent interaction tests.
- [x] Complete final docs/build checks and second diff review; stage the verified delivery for the containing commit.

## Result

The Review surface now projects the supplied Codex desktop geometry from the
existing shared primitives and the one Right Dock implementation:

- the shared Chat/Right-Dock header is 40px, preserving the intentional level
  top edge instead of introducing a Dock-only height source;
- the selected Review capsule is content-sized at approximately 104x28px with
  an 8px radius, 12px label and leading glyph, compact close action, and the
  existing quiet `rgb(240 240 240)` selected material;
- add, tab-close, and Dock-close controls derive their 28px box from the shared
  header and existing 6px block inset, while their glyphs use the compact 12px
  Icon projection;
- the action row uses one flex composition, so the right-side controls keep the
  measured 2px inter-control gap and 8px edge inset without empty grid columns;
- the Review empty copy retains its existing data/locale owner and 6px panel
  inset, with only its feature-local typography projected to the 12px small
  token.

No Review data path, file-diff behavior, locale, tab state, keyboard semantics,
or primitive API changed. The old 48/32/14 density assumptions were replaced;
no compatibility branch, parallel header, local state, or fallback remains.

## Visual acceptance

The production Vite page was rendered by the task-scoped Node/Playwright
fixture at a 360px Right Dock width. The final page screenshot is
`.scratch/right-dock-review-changes-only.png`; the supplied reference was
normalized without restyling to `.scratch/codex-review-reference-360.png`, and
the 724x607 side-by-side inspection artifact is
`.scratch/review-codex-reference-comparison.png` (reference left, current
right). All three were inspected directly at original pixel resolution.

| Contract | Final rendered evidence |
| --- | --- |
| Shared header | 40px |
| Review capsule | x=8px, y=6px, width=103.734px, height=28px, radius=8px |
| Review typography/glyph | label 12px/400; leading icon 12px |
| Tab close/add/Dock close | 28px boxes; 12px glyphs; 2px action gap; 8px right inset |
| Empty copy | x=6px, y=47px, width=154.453px, 12px, `rgb(105 113 116)` |
| Material | white page; selected capsule `rgb(240 240 240)` |

The first rendered pass exposed a selector-specificity conflict: the generic
medium Tab rule retained a 32px height. The Right Dock's existing primitive
class was made part of the local selector, so its derived 28px projection wins
without `!important`. The next comparison exposed four pixels of right-action
drift because the former explicit grid retained columns for hidden tools. The
header composition was changed to flex, which removed those empty columns and
aligned the final add/close group with the reference. Both issues were fixed
and the page was re-rendered before acceptance.

The in-app Browser was also invoked for the final local comparison artifact,
but its security policy rejects `file://` navigation. That policy was not
bypassed; the already-completed real Node/Playwright page capture and direct
original-resolution image inspection remain the visual evidence.

## Verification evidence

- Focused Right Dock/source regressions: 52 passed, 0 failed, 565 assertions
  across density tokens, ownership, Tabs, Review data, chrome parity, surface
  continuity, border policy, and workspace consistency.
- Review empty-state Node/Playwright fixture: 1 passed, including exact computed
  geometry, color, typography, action, and screenshot assertions.
- Multi-tab Terminal/Browser/Review Node/Playwright fixture: 1 passed, including
  real terminal canvas, selection, close, focus, and compact tab height.
- Titlebar/Right-Dock interaction Node/Playwright fixture: 2 passed, including
  header continuity, Dock open/close, add menu, selection, overflow, and compact
  action projection.
- Cross-theme workspace/Dock continuity Node/Playwright fixture: 1 passed.
- Overlay TypeScript check: passed.
- Overlay internationalization revision check: passed.
- Overlay Vite production build: passed, 2499 modules transformed. The existing
  non-failing large-chunk advisory remains unchanged.
- Documentation health: historical links 21 passed, document health 59 passed,
  and product documentation single-source 4 passed.

The expanded titlebar fixture initially stopped at two stale assertions hidden
behind its old 48px header expectation. History and primitive ownership proved
that the current ordinary `mini` Button correctly uses the newer Codex 8px
radius while only true icon buttons remain pill-shaped. The fixture now asserts
that current single-source contract; production Work Ledger code was not
changed.

## Second review

The production diff was re-read by ownership boundary. `RightDock.tsx` remains
the only tab/add/close DOM and state owner; `workspace.css` remains the only
Right Dock geometry owner; `--ui-panel-header-height` remains the single shared
Chat/Dock height; `changes.css` only narrows the Review-specific empty copy;
generic empty states and all locale/data owners remain untouched. The final
comparison confirms the requested information architecture, order, spacing,
density, edge insets, and empty-state placement rather than merely applying a
new visual theme.
