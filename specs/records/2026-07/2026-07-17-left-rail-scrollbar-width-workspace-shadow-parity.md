# Left Rail Scrollbar, Width, And Workspace Shadow Parity

Status: implemented and locally accepted; git-cc delivery explicitly authorized on 2026-07-18

## Recall

| Item | Detail |
| --- | --- |
| User request | Use the supplied Codex desktop sidebar as the reference: do not display a scrollbar in the OpenCorvus left rail, move the left/right division closer to the center by adjusting the left-rail width, and refine the center workspace shadow toward Codex. |
| Acceptance criteria | The Work Ledger remains wheel-, pointer-, and keyboard-scrollable with overflowing real rows, but both standards and WebKit computed scrollbar chrome are hidden and no stable gutter is reserved. The default desktop rail uses one wider clamp that approaches the established approximately 445px Codex reference at a 1902px workspace while retaining the existing pane resizer and persisted explicit user width. The workspace remains the only elevated region and uses a softer, lower-strength tokenized left/top diffusion with its existing rounded top-left corner. Focused source tests, Overlay typecheck/internationalization/build, a Node-launched overflowing Work Ledger browser path, full-shell light/dark/VS Code Dark screenshots, and manual original-resolution review pass. |
| Hard constraints | Preserve `#workLedgerProjectsScroll` as the only Work Ledger scroll owner, `--ui-sidebar-width` and the pane service as the only width path, and `.workspace-main` as the only raised workspace owner. Do not add a fake scrollbar, overlay mask, second width state, inline transform, viewport-specific exception, fallback, mobile/tablet scope, worktree, or interaction with the user's running OpenCorvus/Overlay. Playwright starts through Node against isolated fixtures. |
| User follow-up | After implementation began, the user first instructed that this code must not be pushed. On 2026-07-18 the user explicitly superseded that instruction and requested that the code be committed and pushed to `work-v0.0.8beta-yr-0717`. |
| Sources read | `AGENTS.md`; Browser control skill; both supplied screenshots at original resolution; `specs/current/architecture/99-principles.md`; the 2026-07-10 strict Codex parity, 2026-07-13 visual alignment, 2026-07-17 action-axis alignment, Work Ledger parity, and workspace-continuity records; current `design-language.css`, `base.css`, `activity.css`, `sidebar.css`, `work-ledger.css`, `workspace.css`, `main.tsx`, `pane.ts`, and focused source/browser tests. |
| Whole-repository search evidence | `rg` enumerated every `#workLedgerProjectsScroll`, `--ui-left-rail-scrollbar-gutter-x`, `--ui-rail-width`, `--ui-rail-min-width`, `--ui-sidebar-width`, `.workspace-main`, workspace shadow token, `ledger-scrollbar-visible-browser`, and `work-ledger-scrollbar-visible` occurrence. Production ownership is singular: `base.css` opts the ledger back into visible scrollbar chrome, `work-ledger.css` reserves its stable gutter, `main.tsx` measures the resulting gutter for the shared search/Project action axis, `design-language.css` owns default/minimum rail and shadow geometry, `pane.ts` owns resizing/persistence, and `workspace.css` composes the raised surface shadow. Direct regressions are `visible-scrollbar-whitelist`, `overlay-left-rail-density`, `workspace-surface-continuity`, the ledger scrollbar browser fixture, titlebar toolbar alignment, pane resize, and full-shell continuity browser paths. Historical records contain eight live test-path references that must follow the neutral browser-test rename without rewriting their recorded visible-scrollbar result. |
| Baseline evidence | The supplied OpenCorvus image visibly exposes a full scrollbar track/thumb at the left rail edge; the Codex image keeps the same long-list affordance without visible scrollbar chrome and places the raised workspace boundary farther inward. Current source explicitly sets the ledger to `scrollbar-width: auto`, a 12px WebKit scrollbar, and `scrollbar-gutter: stable`; the default rail caps at 392px despite the earlier approximately 445px reference measurement; workspace diffusion uses 30px blur and a literal 42% shadow-tone mix. Existing `.scratch/work-ledger-row-time-tooltip.png` and `.scratch/workspace-surface-continuity-light.png` show the current narrow rail and comparatively heavy edge band. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | The investigation-only plan was pushed as `512703bf3` before the temporary no-push instruction. The production and regression changes described below are the delivery set authorized by the user's 2026-07-18 follow-up for `work-v0.0.8beta-yr-0717`. |

## Causal chain

1. **Observable:** the left rail paints a track/thumb, its default division sits too far left relative to the reference, and the workspace edge reads as a broad gray band.
2. **Direct triggers:** `base.css` explicitly exempts the Work Ledger from the hidden-scrollbar default; `work-ledger.css` reserves a stable gutter; the rail clamp is `280px / 20.5cqw / 392px`; and `.workspace-main` mixes its shadow at a literal 42% with 30px blur.
3. **Deep cause:** three earlier parity batches optimized the surfaces independently—visible ledger position feedback, a narrower one-fifth rail, and pronounced two-region separation—so the composed result no longer matches the newer Codex reference. The width, gutter, and shadow remain correctly centralized, so the root repair is to replace those contracts at their owners rather than add feature overrides.
4. **Root repair:** remove only the Work Ledger visible-scrollbar opt-in and stable gutter, keep runtime gutter measurement as the truthful zero-width action-axis input, widen the single rail clamp to the established desktop reference range, and move shadow strength into the shared design token while softening its geometry.

## Call-site disposition

| Surface / call site | Decision |
| --- | --- |
| `cascade/base.css` | Keep the global hidden-scrollbar default. Remove every Work Ledger standards/WebKit opt-in; keep the Chat transcript hover/focus scrollbar contract unchanged. Initialize the left-rail measured gutter token to zero so first paint matches the hidden chrome. |
| `work-ledger.css` | Preserve `overflow-y: auto` and `overflow-x: hidden`; delete only `scrollbar-gutter: stable`. No mask or negative-margin compensation. |
| `main.tsx` action-axis measurement | Keep measuring `workLedgerProjectsScroll`; its real hidden-scrollbar gutter resolves to zero and remains the single source used by search/Project action alignment. |
| `design-language.css` rail width | Replace the current clamp with `clamp(300px * scale, 23.25cqw, 440px * scale)` and raise the minimum to `280px * scale`. `--ui-sidebar-width` remains the only projection; explicit persisted resize values still win through the existing pane service. |
| `design-language.css` / `workspace.css` shadow | Use `-6px` left offset, `24px` blur, `6px` inset-top offset, the existing `-18px` spread, and one `24%` semantic strength token. Preserve the existing workspace material, top-left radius, clipping, and isolation. |
| Source tests | Replace the Work Ledger visible-whitelist assertions with hidden-chrome/no-gutter assertions; pin the wider clamp/minimum and the tokenized softer shadow. Preserve Chat and pane-resizer assertions. |
| Browser tests | Rename the outdated visible-only ledger fixture to neutral `ledger-scrollbar-browser.test.ts`; assert real overflow, positive scrolling, `scrollbar-width: none`, zero WebKit width, zero measured gutter, fixed nav/pinned regions, and hidden-scrollbar screenshot evidence. Update all repository references to the neutral test path. |
| Visual acceptance | Regenerate the overflowing left rail in desktop light mode and the full workspace in light, dark, and VS Code Dark. Review the left/right division, absence of scrollbar chrome, row/action alignment, rounded corner, and soft edge diffusion at original resolution. |

## Verification plan

1. Add focused failing assertions for hidden ledger chrome/no gutter, the wider rail clamp, and softer tokenized workspace shadow.
2. Replace the three canonical production contracts and rename/update the neutral ledger browser owner.
3. Run focused source tests, Overlay typecheck/internationalization/build, and Node browser fixtures for the overflowing ledger, search/Project action alignment, pane resizing, and workspace continuity.
4. Inspect every current-task desktop screenshot at original resolution and iterate until the supplied differences are absent without clipping, overlap, or broken scroll/resizer behavior.
5. Run documentation health, whitespace checks, and exact-diff/call-site review, then commit with the required `dsw-33987` prefix and push to the explicitly authorized git-cc branch.

## Verification results

- Focused source coverage passes: 30 tests / 346 expectations across the scrollbar whitelist, rail density, workspace continuity, design-density tokens, pane configuration, and left-shell ownership.
- Node-launched browser coverage passes for the overflowing hidden-scrollbar ledger, workspace continuity in light/dark/VS Code Dark, search/Project action alignment, and keyboard/pointer pane resizing.
- Original-resolution review passed for `.scratch/work-ledger-scrollbar-hidden-full-page.png`, `.scratch/workspace-surface-continuity-{light,dark,vscode-dark}.png`, `.scratch/workspace-search-project-plus-alignment.png`, and the pane-resizer screenshots. The 1280px ledger fixture resolves to a 300px rail; its real overflow scrolls with zero standards/WebKit chrome and zero gutter. The 1500px continuity fixture resolves to the wider proportional rail, with a shorter, softer raised-workspace edge and no dark-theme halo or right-dock seam.
- Overlay `typecheck` and `check:i18n` pass. The Node browser runner also completed a production Vite build.
- First browser failure in the pane-resizer path was caused by missing `/mailbox` and `/mailbox/events` routes in that isolated fixture, not layout behavior. The fixture now reuses the canonical Mailbox responses and the original command passes without ignored errors.
- **Codex review feedback:** the second whole-repository grep found `design-density-tokens.test.ts` still pinning the retired rail/shadow values, and the real titlebar test still requiring a positive historical scrollbar gutter. Both direct contract owners were updated; the titlebar geometry then passed at `searchCenter = newChatCenter = 272` and measured gutter `0`.

## Progress

- [x] Supplied references, prior decisions, production owners, direct regressions, and historical test-path references inspected.
- [x] Regression tests updated.
- [x] Production implementation complete.
- [x] Real browser and screenshot acceptance complete.
- [x] Second review complete.
- [x] User explicitly authorized the implementation commit and git-cc delivery on `work-v0.0.8beta-yr-0717`.
