# Empty-home task examples

## Recall

| Item | Evidence |
| --- | --- |
| User request | Replace the three weak examples below the empty-home Composer with practical examples such as building a webpage, making a poster, fixing a bug, writing a daily report, doing research, and creating a presentation. Keep the examples aligned to both sides of the input. |
| Acceptance criteria | The empty home presents exactly six practical starters in English and Chinese; each starter fills the real Composer with a useful prompt; the examples form a compact desktop grid; the examples container and the real Composer share the same left and right edges; focused source and browser tests pass; fresh Vite screenshots are visually reviewed. |
| Hard constraints | Preserve all unrelated dirty-worktree changes. Do not restart or manipulate the user's running OpenCorvus/Overlay. Use the shared Button and Icon primitives, the central Lucide registry, the existing real Composer, and one canonical suggestions collection. Use Node, not Bun, for Playwright. Do not add mobile or responsive delivery scope. |
| Read records | `AGENTS.md`; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-15-composer-budget-hover-and-home-cards-authority.md`; `specs/records/2026-07/2026-07-16-conversation-and-home-width-alignment.md`; Browser skill instructions. |
| Whole-repository grep | `chat.home_suggestion.*` production use is confined to `Conversation.tsx` and both locale files. Regression owners are `conversation-empty-state-source.test.ts`, `mission-i18n.test.ts`, and the real-browser empty-home geometry inside `command-palette.test.ts`. `.chat-home-suggestions` and `.chat-home-suggestion` styling is owned by `conversation.css`; the container shape remains owned by `action-tile.css`. The command-palette fixture's separate chat title is not a starter call site. |
| Independent agent feedback | None. The user did not request sub-agents or parallel independent review, so this task remains single-agent. |

## Decision

Replace the project/global three-item branches with one six-item task-starter
collection. The examples are useful regardless of directory state, so project
setup and Mission-planning entries are not retained as a second source.

Use the existing three-column desktop grid with two compact rows. Each tile
uses a horizontal icon-and-label layout and the shared action-tile container.
The suggestions owner continues to consume
`--chat-home-composition-width`, exactly like the title and Composer. Browser
geometry checks will assert both left and right coordinates, not width alone.

## Call-site disposition

| Owner | Current role | Disposition |
| --- | --- | --- |
| `Conversation.tsx` `homeSuggestions` | Builds separate project/global three-card arrays | Replace with one six-starter array and keep the existing real-Composer fill action. |
| `Conversation.tsx` suggestion render | Shared Button/Icon loop | Preserve; add a stable example identity for browser assertions. |
| `en-US.json` / `zh-CN.json` | Three project/setup/planning labels and prompts | Replace with six practical task labels and prompts. |
| `conversation.css` | Three 108-pixel vertical cards | Replace with two rows of compact horizontal action tiles while preserving the three-column desktop grid and shared width owner. |
| `Icon.lucide.ts` | Canonical Lucide registry | Add the mature Bug and Presentation glyphs for exact task semantics; reuse existing webpage, poster, report, and research glyphs. |
| `conversation-empty-state-source.test.ts` | Static empty-home structure contract | Replace the old three-card assertions with the six-task collection, compact geometry, and canonical primitive assertions. |
| `mission-i18n.test.ts` | Prevents the old Mission starter wording | Replace with a locale completeness assertion for the six new starters and continued absence of standalone Mission intent. |
| `command-palette.test.ts` | Real Vite/browser layout and screenshot owner | Assert six tiles, compact heights, exact Composer/suggestions left-right alignment, and click-to-fill behavior. |

## Verification

1. Run focused Bun source/i18n tests.
2. Run the Node-launched `command-palette` browser suite against its real Vite
   fixture.
3. Inspect fresh 1440x900 and 1920x1050 screenshots at original resolution;
   correct spacing, clipping, density, or edge drift before accepting.
4. Run Overlay typecheck/build plus the required historical-docs and document
   health checks.
5. Review the final task-owned diff and staged paths, commit with the
   `dsw-33987` prefix, and push the current main delivery branch to `legacy-remote`
   through normal hooks.

## Codex review feedback

The first focused source-test run exposed two assertions that were already
stale against committed production source: the `Conversation` mount now also
passes the exact Subagent-conversation opener, and the launcher-home predicate
now explicitly excludes an active Session. The review keeps those production
responsibilities unchanged and updates only the stale structural assertions.

The first Node browser run reached the real Vite UI but its fixture returned
404 for the committed `/chat/capability` bootstrap request. The fixture now
serves the same typed empty capability shape used by the dedicated capability
browser suites; the production request path remains unchanged.

The next run exposed a second fixture drift: its Work Ledger rows predated the
required `pinned`, `started`, `queueOrder`, and `pendingInteractions` fields,
so strict transport parsing rejected the first page and no project row could
render. The fixture rows now satisfy the current strict transport schema rather
than weakening product parsing. Its Mission identity also now uses the
schema-required lowercase alphanumeric-and-hyphen form instead of an underscore
identifier.

Once the fixture reached the target surface, real geometry measured the title
and examples at 900 pixels but the input at 868 pixels. The empty-home Composer
still inherited the ordinary transcript's 16-pixel inline padding on both
sides, so its nominal shared width was reduced by 32 pixels. The empty-home
layout owner now clears that ordinary transcript inset; the existing shared
900-pixel composition width becomes the actual input and examples edge source.

After the target geometry passed, the same broad browser suite reached two
unrelated left-Dock density assertions that were stale against the current
rendered token values: the search toggle is 20 pixels and the section title is
15 pixels. The assertions now match the existing production presentation;
none of the concurrent Work Ledger or Tooltip implementation is modified.

The suite's later Expert Squad interaction also assumed the retired flat
intent menu. The current product places Squad choices in the Mission submenu,
so the browser path now opens that existing submenu before selecting General;
no product menu behavior or source is changed. Its state assertion now reads
the visible primitive-owned `Chat` / `Mission · 1` trigger instead of a retired
hidden native select.

Because Squad checkbox items intentionally use `closeOnSelect=false`, the
browser path now closes the Squad submenu and parent intent menu with their
real Escape interaction before capturing the home surface or continuing. This
prevents a stale Portal from intercepting unrelated later controls.

Concurrent primitive work changed the Composer from its retired 24-pixel local
radius to the current shared 12-pixel radius while this task was running. This
suite now asserts only that the unrelated input retains a nonzero shared
radius; exact radius ownership remains covered by the primitive task's own
source and browser tests.

Target screenshots now move the pointer onto empty canvas and wait for any
unrelated left-Dock tooltip Portal to close, so the captured evidence shows the
empty-home delivery surface rather than transient hover chrome.

The broad suite also reopened and closed the Work Ledger Organize menu, then
clicked Create without waiting for the second close transition. It now waits
for the existing menu Portal to become hidden before the next interaction,
matching the same lifecycle assertion already used for its first close. Since
the screenshot helper does not leave focus inside the nested menu tree, the
browser uses the public Organize trigger's real toggle behavior to close it
before asserting the parent is hidden.

After the browser closes the nested intent menus with Escape, the Kobalte
Dropdown Menu correctly restores focus to its trigger. The stale textarea
expectation is replaced with an exact `composer-intent-selector` focus check;
the product's primitive-owned keyboard behavior is preserved.

The same current Composer now exposes `@mission` alongside `@skill` and
`@squad` and uses the canonical `Agent Squad` product term. The broad fixture's
old Expert Squad hint copy is synchronized to the shipped locale text.
