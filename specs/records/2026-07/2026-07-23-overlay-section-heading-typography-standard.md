# Overlay Section Heading Typography Standard

Date: 2026-07-23

Status: Implemented, verified, and pushed

Owner: Codex

## Recall

| Field | Evidence |
| --- | --- |
| User request | The Settings page renders group headings smaller than setting items. Audit the whole Overlay and make headings slightly larger than content through one primitive-like standard. |
| Supplied evidence | `codex-clipboard-aff9448b-be38-44ab-8f47-843c4bb2ec62.png`, inspected at original resolution, shows `Personal`, `Expert Squads`, `Integrations`, `Coding`, and `Archived` at the 12px small tier while their navigation items render at the 14px control tier. |
| Acceptance criteria | Page headings continue to use the heading tier; standalone section/group headings use the shared 15px title tier; ordinary content and controls remain on the 14px body/control tier; metadata remains smaller. Settings, Work Ledger, menus/pickers, task evidence, activity panels, and content subsections no longer locally downsize true section/group headings. Focused source tests, Overlay typecheck/build, isolated Node-launched browser interactions, task-scoped screenshots, original-resolution visual review, documentation health, second review, commit, and legacy remote push pass. |
| Hard constraints | Preserve item-title, filename, status-pill, code, and metadata typography unless the element is proven to own a section/group heading role; class names alone are not evidence. Reuse the existing Section primitive and `--ui-font-title`; do not add another typography token, fallback, compatibility alias, global zoom, new worktree, or restart/refresh the user's running OpenCorvus/Overlay. Desktop-only scope. Playwright is launched by Node. Every code change receives regression coverage. Commit subjects start with `dsw-33987`; push to `legacy-remote`. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; the July 8 font-size alignment record; the July 10 desktop typography normalization record; `design-language.css`; `section.css`; settings, Work Ledger, titlebar, command palette, Composer, activity, changes, conversation, inspector, mailbox, messages, card, and settings styles; corresponding component and focused test owners. |
| Git baseline | Branch `work-v0.0.16beta-yr-0723` showed no ahead/behind marker against `legacy-remote/work-v0.0.16beta-yr-0723`. The worktree already contained unrelated in-progress Overlay/mission changes, which remain preserved. The required pre-change push was attempted, but `legacy remote.myhexin.com:6443` was unreachable from the environment. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation. |

### Whole-repository search evidence

| Surface / search | Complete ownership and disposition |
| --- | --- |
| Canonical scale and primitive | `design-language.css` is the only font-size token source: title is 15px and body/control are 14px. `section.css` already makes `.oc-section__title` consume `--ui-font-title`. Extend that primitive with a standalone `.oc-section-heading` typography role; do not create another token or cascade owner. |
| Settings navigation and settings content | `ConfigDialogHost.tsx` exclusively renders `.config-nav-group-title`; `settings.css` incorrectly assigns `--ui-font-small`. Adopt the shared heading role and remove the local size. Existing `.config-page-title`, `.s-group-head`, `.s-row-title`, `.provider-section-label`, Expert Squad headings, and About headings already use heading/title tiers; add the shared role only where it represents a standalone group heading. |
| Left rail and menu/picker groups | `WorkLedger.tsx` owns `.work-ledger-section-title` and `.work-ledger-toolbar-menu-heading`; `TitlebarMenubar.tsx` owns `.titlebar-menubar-group-title`; `CommandPalette.tsx` owns `.cmdk-group-label`; Composer mention/model components own their popup and provider-group headings. Each currently uses small/tiny/control or a literal 13/15px value. Adopt the primitive role and delete the local font-size override. |
| Task and activity section headings | `FileChangesPanel/View`, `ScreenshotBrowserPanel`, `ConversationAgentRail`, `TaskDirBar`, `GoalGroup`, `IntegrityCard`, `ReviewStreamSection`, `MailboxPanel`, `LogViewer`, `TracePanel`, and `SkillMarketPanel` own true section/group headings that currently use 11.5–14px local values. Adopt the shared role without changing nearby paths, counts, code, timestamps, or status pills. |
| Content and dialog headings | `ArtifactFrame.tsx` renders a real `h3` but `messages.css` assigns the body tier; Goal and plan-node titles also use body/small, while the image-preview dialog locally overrides the shared dialog title to 13px. Route those titles through the title tier and keep their existing truncation/layout. |
| Semantic-title false positives | `.titlebar-menubar-item-title`, `.file-editor-title`, `.work-row-child-title`, `.card__subtitle`, and similarly named selectors are item/content identity, not section/group headings. Preserve them. This disposition is based on their rendered role and DOM context, not their names. |
| Regression owners | Update `font-size-hierarchy.test.ts` from `title >= body` to strict `title > body`; extend the Section primitive test; add one whole-Overlay standalone-heading ownership guard; update existing settings, Work Ledger, command-palette, menu-group, and right-panel expectations that currently pin the undersized values. |

## Causal chain

1. The shared design-language scale already expresses the requested hierarchy.
2. Standalone section/group headings were never given a reusable primitive role, so surfaces independently chose small, tiny, control, or literal sizes.
3. Those local choices override the correct title/body ordering and make headings smaller than the content they organize.
4. Extending the existing Section primitive with one standalone heading role removes the repeated decision while keeping layout and surface color ownership local.

## Implementation and verification plan

1. Add failing focused regressions for strict title-over-body ordering and standalone section-heading primitive ownership.
2. Extend `section.css` with `.oc-section-heading`, sharing the exact typography tuple with `.oc-section__title`.
3. Adopt the primitive on proven standalone section/group headings and remove their local font-size declarations; update existing exact-value regressions.
4. Document the current typography contract in `specs/current/architecture/07-panel.md`.
5. Run focused typography/component tests, Overlay typecheck/build, i18n and documentation health checks.
6. Start only isolated Node-based browser fixtures, capture the Settings sidebar plus representative left-rail/menu/panel screenshots, inspect them at original resolution, and iterate if hierarchy, wrapping, clipping, or density is wrong.
7. Re-grep every owner, inspect the exact diff a second time, commit with `dsw-33987`, fetch/converge if the remote is reachable, push to `legacy-remote`, and verify local/remote equality.

## Verification evidence

- Latest focused typography and component suite: 132 passed, 0 failed, including strict title-over-body ordering, primitive ownership, Settings, menu, and right-panel regressions. The typography-specific Work Ledger assertions also passed; a wider Work Ledger suite currently fails on an unrelated in-progress status-indicator expectation.
- Overlay typecheck and production Vite build passed.
- Biome passed for every touched production and test owner; `git diff --check` passed.
- The Node-launched Settings browser suite passed after its obsolete 11–12px sidebar-heading expectation was replaced with the canonical 15px title token and strict `heading > item` assertion. The same fixture was repaired to serve the two provider-refresh routes that the real Providers panel calls.
- Isolated in-app browser review at the actual desktop surface measured Settings sidebar headings at 15px versus 14px navigation items, page headings at 20px, section/row titles at 15px, and descriptions at 14px. A second About-panel review measured section headings at 15px versus 14px content. The reviewed screenshots are `.scratch/section-heading-settings-visual.png` and `.scratch/section-heading-about-visual.png`.
- Historical documentation-link checks passed. The required pre-push hook passed full workspace typecheck, route inventory, generated API documentation, Overlay i18n, and secret scanning. The standalone document-health test still observes another concurrent July record indexed while untracked; this task does not stage or claim that record.
- Implementation commit `e45121639` was pushed to `legacy-remote/work-v0.0.16beta-yr-0723`; the local and legacy remote-tracking commits matched after push.

## Progress

- [x] User evidence, historical decisions, canonical tokens/primitive, production owners, test owners, and Git baseline inspected.
- [x] Recall, causal chain, call-site disposition, and implementation plan recorded.
- [x] Focused regressions updated.
- [x] Production implementation complete.
- [x] Static, browser, and screenshot verification complete.
- [x] Second review, commit, and legacy remote push complete.
