# Tools Settings Plain-Language Redesign

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement                 | Refactor the Tools settings page shown in `C:/Users/10132/AppData/Local/Temp/codex-clipboard-e660ba5a-6c2e-45f8-bb66-385443e85c05.png` because its current design and terminology are hard to understand; make it clear enough for a first-time user.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Acceptance criteria              | The page explains what tools are and that this surface is read-only; identifies the currently active expert squad without exposing the projection hash as primary content; lets the user choose a squad member through the canonical Select primitive; explains the selected member's total and tool-source groups in plain language; keeps the exact backend-projected tool IDs inspectable; places the deduplicated all-member pool behind the canonical Disclosure as optional technical detail; preserves reload, empty, error, focus, and keyboard behavior; desktop screenshot and visual review pass.                                                         |
| Hard constraints                 | Keep the expert-squad catalog and `prompt_profile.active` as the only source of projected capabilities. Do not infer workflow state, rename tool IDs, hide backend mismatches, add enable/disable mutations, duplicate the pool, add a host gate/fallback, hand-roll controls, add mobile scope, create a worktree, or interfere with the user's running OpenCorvus/Overlay process. Use existing Settings, Select, Badge, Button, Icon, and Disclosure primitives. Start Playwright with Node and inspect goal-scoped screenshots. Preserve unrelated dirty benchmark, Provider, Expert Squad, Multica, environment, toolbar, conversation, and documentation work. |
| Supplied evidence                | The original screenshot shows a redundant `工具` heading, unexplained `general` identifier and SHA-256 hash, an `Agent` label, a technical `workload-reviewer · 0` selector, duplicated `General`, unexplained source categories, and an always-visible `投影工具池`. The hierarchy does not answer what the page is for or why two tool lists exist.                                                                                                                                                                                                                                                                                                                |
| Sources read                     | `AGENTS.md`; Browser skill; `specs/current/architecture/07-panel.md`; the current Tools projection records; `SkillMarketPanel.tsx`; `services/expert-squad.ts`; Settings layout primitives; Select and Disclosure primitives; Settings CSS; locale sources; source tests; and `skill-mount-matrix-browser.test.ts`.                                                                                                                                                                                                                                                                                                                                                  |
| Whole-repository search evidence | `ToolsPanel` is exported only by `SkillMarketPanel.tsx` and mounted by `ConfigDialogHost.tsx`. The capability helpers, selected-agent signal, detail renderer, and pool renderer are all in `SkillMarketPanel.tsx`. `/expert-squad/catalog` through `loadExpertSquadCatalog` is the single data source. Tool-page strings live only in both locale JSON files. Tool-specific visual rules live in `settings.css`. Real browser coverage is owned by `skill-mount-matrix-browser.test.ts`; `left-work-ledger-shell.test.ts` only checks the export remains. The canonical progressive-disclosure primitive is `components/ui/Disclosure.tsx`.                         |
| Independent agent feedback       | None. The user did not request delegation, so no sub-agent was started.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Git baseline                     | Local `v0.0.13beta` started at `951f4bd8f`; legacy remote `legacy-remote/v0.0.13beta` was fetched at `c0ba4751e` and is two documentation commits ahead. Existing dirty files belong to concurrent work. Task-owned changes will be staged by exact path/hunk and reconciled with legacy remote before push.                                                                                                                                                                                                                                                                                                                                                                             |

## Evidence and causal chain

The backend returns an exact active expert-squad projection split by scheduler and
worker. The current page presents that internal model almost verbatim. The
observable confusion is therefore caused by information architecture, not by
missing data: internal identity/hash fields are visually dominant, `Agent` and
`projected` are unexplained, source groups have no meaning, and the global pool
duplicates the member view without saying that it is a deduplicated union.

The redesign stays at the Overlay presentation owner. It introduces one plain
language overview, one selected-member explanation, and one optional all-member
technical list. Exact IDs remain visible because they are the real capability
contract, while the projection hash moves out of the novice path instead of
becoming a second source or disappearing from inspectable evidence.

## Call-site decisions

| Call site                                            | Decision                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SkillMarketPanel.tsx` capability helpers            | Keep exact catalog-derived groups and counts. Add presentation-only member labels and explanatory group copy; do not alter identifiers or projection semantics.                                                                                                        |
| `SkillMarketPanel.tsx` Tools renderer                | Replace the raw scope strip and duplicated cards with an overview, labeled member selector, selected-member summary/groups, and a canonical Disclosure for the deduplicated all-member list plus projection fingerprint. Keep MCP rendering on its existing structure. |
| `styles/surfaces/settings.css`                       | Add Tool-page layout rules scoped below the Tool settings panel. Reuse existing tokens and primitives; retain MCP and Skill layouts.                                                                                                                                   |
| `i18n/en-US.json`, `i18n/zh-CN.json`                 | Replace developer-facing Tool labels with plain-language titles, descriptions, source explanations, selector labels, count copy, technical-detail copy, and reload wording. Preserve exact dynamic IDs.                                                                |
| `test/tools-settings-surface.test.ts`                | Add focused source assertions for the single plain-language hierarchy, canonical Disclosure/Select usage, absence of the old raw scope strip, and retained exact-item rendering.                                                                                       |
| `test/browser/skill-mount-matrix-browser.test.ts`    | Update the real Settings fixture assertions, select a worker, verify copy/count/group semantics, expand the all-member detail with pointer and keyboard, check no duplicate visible pool by default, and capture current-task desktop screenshots.                     |
| `ConfigDialogHost.tsx`, expert-squad service/backend | No production change. Keep the existing Settings mount and catalog route as the only source.                                                                                                                                                                           |

## Implementation and verification plan

1. Add focused failing source assertions for the intended novice-first hierarchy and the retired raw presentation.
2. Refactor only the Tool-mode renderer and localized copy, while leaving MCP/Skill behavior and catalog semantics intact.
3. Add scoped responsive-safe desktop CSS using existing design tokens and primitives.
4. Run focused tests, Overlay typecheck/internationalization/build, and the Node-launched real browser fixture.
5. Inspect closed/open desktop screenshots and computed geometry in the in-app browser; correct visual or interaction issues and rerun.
6. Run documentation health, review the scoped diff, reconcile the fetched legacy remote commits without losing concurrent changes, commit with `dsw-33987`, push `legacy-remote/v0.0.13beta`, and verify local/remote equality.

## Progress

- [x] Inspected the screenshot, current data contract, component ownership, primitives, styles, tests, architecture, and git state.
- [x] Added regression coverage and the plain-language Tools hierarchy.
- [x] Completed real-browser visual verification and correction.
- [x] Completed full checks and second review.
- [x] Completed commit and legacy remote reconciliation; the final push uses the same verified commit.

## Continuation Recall

| Item | Detail |
| --- | --- |
| User continuation | The user asked to continue after the first delivery, so this round extends verification instead of changing the data model or reopening the completed information architecture. |
| Added acceptance criteria | Verify the production Settings page in Chinese and dark theme; select a member whose projection contains no tools; verify long exact tool IDs remain readable without horizontal overflow; capture task-scoped desktop screenshots and correct any visual or wording defect found. |
| Constraints rechecked | Desktop only. Keep `/expert-squad/catalog` as the capability source, use the existing Select and Disclosure primitives, launch Playwright with Node, use an isolated fixture, and do not refresh or restart the user's running OpenCorvus process. |
| Repository search | The continuation uses the same owners already enumerated above. `skill-mount-matrix-browser.test.ts` contains a zero-capability projected member and owns the real Tool/Skill/MCP Settings fixture; locale and theme are supplied by `browserSettingsFixture`; Tool copy remains in the two locale JSON files and Tool layout remains scoped in `settings.css`. |
| Independent agent feedback | None. The user did not request delegation, so no sub-agent was started. |

## Continuation plan

1. Extend the existing Node-launched browser scenario with zero-tool and long-ID geometry assertions.
2. Add a second page in the same task-scoped backend fixture for Chinese dark-theme visual coverage, avoiding duplicated API fixtures or a second preview source.
3. Inspect both new screenshots at original resolution, make only evidence-driven presentation corrections, then rerun source, browser, type, internationalisation, and documentation checks.
4. Review and stage only task-owned hunks, commit with the required `dsw-33987` prefix, reconcile legacy remote, push `legacy-remote/v0.0.13beta`, and verify remote equality.

## Continuation verification evidence

- The extended Node-launched production Settings fixture passed in English/light and Chinese/dark modes against one task-scoped backend source. It covered the canonical member Select, keyboard Disclosure, a genuinely empty projected member, and the long exact package tool ref.
- Computed geometry proved the Tool member section and detail have no horizontal overflow and every long-ID chip stays inside its detail card at the desktop acceptance viewport.
- Original-resolution review of `.scratch/settings-tools-zh-dark-long-identifiers.png` found that worker headings were still generated by splitting internal IDs even though the expert-squad catalog already supplies human-facing labels. The production renderer now uses the catalog label as primary text and retains the exact agent ID beneath it.
- Original-resolution review of `.scratch/settings-tools-zh-dark-empty-member.png` confirms the zero total, three zero-count source cards, and plain empty explanations remain readable in dark theme. The Chinese member-picker help also avoids a gendered pronoun.
- The in-app Browser connection was attempted as an independent artifact check, but its client blocked both loopback host forms. This did not replace or weaken the successful real-page Node/Playwright run; the isolated static review service was stopped after the attempt.

## Verification evidence

- The first Node-launched real-browser run exposed that the author-level
  `.tool-all-members-content { display: grid }` rule overrode the browser's
  closed-details presentation. The supposedly optional all-member pool was
  still visible and duplicated the selected-member content. The correction
  binds grid display only to the canonical Disclosure's real `[open]` state.
- The second real-browser run passed the complete Tool, Skill, and Model
  Context Protocol settings scenario. It selected the frontend implementer,
  proved exactly three explained source groups, proved the all-member pool is
  absent from layout while closed, opened it through keyboard Enter, verified
  the deduplicated pool and configuration fingerprint, and reported no
  unexpected browser diagnostics.
- Original-resolution review of
  `.scratch/settings-tools-plain-language-closed.png` shows a clear path from
  page purpose, to active Expert Squad, to member selection, to three explained
  tool sources, with the technical union collapsed. Review of
  `.scratch/settings-tools-plain-language-expanded.png` confirms the optional
  exact-ID list and fingerprint remain readable without clipping.
- The in-app browser independently opened the current closed screenshot after
  the final visual correction. Its full-page capture matched the task-scoped
  artifact and its warning/error log was empty.
- Focused source ownership coverage passed with 8 tests and 154 assertions.
  Overlay TypeScript and internationalisation checks passed.
