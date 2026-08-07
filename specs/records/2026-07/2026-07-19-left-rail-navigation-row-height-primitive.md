# Left Rail Navigation Row Height Primitive

Status: complete

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Fix the visibly different hover/selected bar heights in Projects, Mission, and Phase rows and make them use one primitive contract. |
| Acceptance criteria | Project, Mission, standalone Task/Chat, and Mission-owned Phase rows use one navigation-row compact-height primitive and render equal bounding-box and hover/selected wash heights in light and dark themes. Static top navigation and non-ledger navigation rows retain their own geometry. No nested feedback surface, clipping, action-rail regression, or hierarchy change is introduced. Focused source/browser tests, real screenshots, typecheck, build, internationalization, document health, commit, and `myhexin/v0.0.9beta` push pass. |
| Hard constraints | Preserve `.oc-navigation-row` as the only hover/selected/radius owner and use a data-attribute primitive variant rather than a feature-local override. Remove the Project/Work/nested height sources instead of retaining aliases. Use the design-language density scale; no fallback, compatibility rule, second renderer, mobile scope, worktree, or intervention in the running Overlay. Browser acceptance uses Node-launched isolated fixtures plus an isolated production preview. Preserve unrelated `C:/`. |
| Evidence | The screenshot shows the Project wash at 26px and the selected Phase wash at 34px. Source and production CSS Object Model evidence agree: both elements opt into `.oc-navigation-row`, but the primitive explicitly owns no geometry; `.sidebar` defines Project 26px, Work 34px, and nested 26px, while `.work-row` overrides every Work Ledger row to 34px. |
| Sources read | `AGENTS.md`; Browser control skill; supplied screenshot; `2026-07-14-left-dock-vertical-density.md`; `2026-07-17-work-ledger-hover-pin-row-parity.md`; `2026-07-17-workspace-search-project-plus-alignment.md`; current card-system architecture; `ProjectLedgerGroup.tsx`; `WorkLedger.tsx`; Button and row owners; `design-language.css`; `navigation-row.css`; `sidebar.css`; `work-ledger.css`; density/primitive/source tests and left-Dock/project-ledger browser fixtures. |
| Whole-repository search | `rg` enumerated every `oc-navigation-row` production and fixture consumer, every `--sidebar-*-row-height` declaration/consumer, every Work Ledger height assertion, and all hover/selected browser measurements. Only Project group heads and Work Ledger rows enter the compact ledger-height variant. Static navigation, Config back, Task runtime shortcuts, Goals, and Card headers keep feedback-only `.oc-navigation-row` behavior. Left-Dock and neutral-chrome fixtures are updated to mirror the production variant. |
| Independent agent feedback | None; the user did not request delegation. |
| Git baseline | `6b5bbcf41`; local and `myhexin/v0.0.9beta` are converged. Only unrelated untracked `C:/` exists. |

## Causal chain

1. **Observable:** the Project hover bar is shorter than the Mission/Phase hover or selected bar even though their color and radius match.
2. **Direct trigger:** Project consumes `--sidebar-project-row-height` at 26px; `.work-row` consumes `--sidebar-work-row-height` at 34px and wins over the generic 26px nested-row declaration.
3. **Deep cause:** primitive convergence unified feedback painting but deliberately left geometry to surfaces. The density test then locked the split 26/34px contract, so later parent/child parity did not include the Project row.
4. **Root repair:** add one opt-in compact geometry variant to `.oc-navigation-row`, backed by one design-language density token; opt Project and all Work Ledger rows into it; delete the three ledger height variables and their surface height declarations; update tests to require equal computed geometry.

## Call-site decisions

| Owner / call site | Decision |
| --- | --- |
| `design-language.css` | Add the single compact navigation-row density token at 26px scaled. |
| `navigation-row.css` | Add the opt-in compact density variant that owns exact height/min-height while the base primitive remains geometry-neutral for Cards, Goals, Config, runtime shortcuts, and static navigation. |
| `ProjectLedgerGroup` | Mark only the outer Project feedback owner as compact; retain the nested Button as transparent content and consume the same canonical height token. |
| `WorkLedgerRowView` | Mark the canonical row shell as compact so Mission, Task, Chat, and child Phase rows share the same primitive geometry. |
| `sidebar.css` / `work-ledger.css` | Delete Project/Work/nested height authorities and surface-local row height declarations. Preserve layout, padding, typography, disclosure, indentation, and action rail. |
| Browser fixtures | Mirror the production compact attribute, compare Project/Mission/Phase boxes and wash heights, retain non-overlap/action assertions, and refresh scoped light/dark screenshots. |
| Other `.oc-navigation-row` consumers | Preserve feedback-only behavior; they do not opt into compact ledger geometry. |

## Verification plan

1. Update focused source and browser contracts first and record the expected baseline failure.
2. Implement the primitive token/variant and remove the superseded surface geometry sources.
3. Run the isolated left-Dock and production-shaped Project Ledger browser fixtures, inspect light/dark screenshots at original resolution, and iterate.
4. Run focused tests, architecture guards, Overlay typecheck/i18n/build, documentation health, second diff/call-site review, reconcile git-cc, commit with `dsw-33987`, and push.

## Progress

- [x] Screenshot, historical decisions, complete production/fixture call sites, and current production CSS audited.
- [x] Failing regression contracts and implementation complete.
- [x] Real-browser visual acceptance complete.
- [x] Final verification, commit, and push complete.

## Result and evidence

`--oc-density-navigation-row` is now the single 26px scaled geometry token. The opt-in `.oc-navigation-row[data-density="compact"]` variant owns its exact height and minimum height; Project group heads and every Work Ledger row opt into that variant. The former Project, Work, and nested sidebar height variables and the `.task-row-mini` / `.work-row` physical height declarations are deleted.

The isolated left-Dock fixture at UI scale 1.5 measured Project, standalone work items, Missions with and without disclosure, and the child Phase row at the same 39px height. It also proved every ledger feedback owner carries the compact primitive variant, rows do not overlap, Project/Mission disclosure alignment is unchanged, and the 12px scaled shared radius remains intact. Original-resolution light and dark screenshots show Project hover and Phase selected washes at the same height: `.scratch/left-dock-navigation-row-height-light.png` and `.scratch/left-dock-navigation-row-height-dark.png`.

The production-shaped Work Ledger browser scenario passed and extended the previous Task/Mission/Chat/child equality check to the real Project group head. Its refreshed `.scratch/work-ledger-equal-parent-child-rows.png` was manually reviewed. An isolated production preview then confirmed through the generated CSS Object Model that the canonical token and compact rule ship in the build, all three retired height sources are absent, and neither `.task-row-mini` nor `.work-row` retains a physical height override.

Verification passed: 151 focused primitive, Work Ledger, continuity, and architecture tests; 12 density-token/source tests; both task-owned Node browser scenarios; Overlay TypeScript, internationalization, production build; 21 historical-document tests; docs check; and `git diff --check`.

## Codex review feedback

The first dark screenshot run loaded only the light palette, so its geometry was valid but its theme evidence was not. The fixture now loads both canonical palettes and was rerun before acceptance. A separately sampled legacy neutral-chrome fixture failed before reaching row interaction checks because it still expects the `.sidebar` element itself to paint an opaque blue-grey, while current production delegates material paint outside that transparent element. This task had no ownership overlap with that assertion; the temporary fixture edits were removed rather than weakening an unrelated oracle.
