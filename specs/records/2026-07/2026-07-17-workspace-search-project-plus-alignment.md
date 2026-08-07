# Workspace Search And Project Plus Alignment

## Recall

### User requirement

- “搜索图标跟下面的+没有对齐，调整下，不用push”.
- The supplied desktop screenshot shows the workspace search glyph on a different horizontal axis from the Project row's new-Chat plus glyph.

### Acceptance criteria

- The workspace search glyph and the rightmost Project-row new-Chat plus glyph share the same inline-axis center in the real desktop layout.
- The existing workspace-title/search vertical alignment, visible Projects scrollbar, project action order, hit areas, hover/focus behavior, accessible labels, and command/new-Chat behavior remain unchanged.
- One left-rail geometry contract owns the body inset, Projects-list inset, scrollbar allowance, canonical icon-button density, and compact Project action size; no local pixel nudge or duplicate search/project action implementation is introduced.
- A Node-launched production Overlay browser fixture measures the two glyph centers, captures the complete left rail, and passes manual screenshot review.

### Hard constraints

- Desktop-only scope; no tablet, mobile, or responsive deliverable is added.
- Reuse `App`, `ProjectLedgerGroup`, `Button`, and `Icon`; do not add a second control or a compatibility/fallback path.
- Playwright runs through Node, never Bun.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process. Visual acceptance uses an isolated browser fixture.
- Preserve unrelated workspace state; no reset, restore, stash, new worktree, or hook bypass.
- The user explicitly requested no push. A local task commit is allowed by the repository workflow, but no remote write is performed.

### Sources read

- `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, and `specs/current/architecture/99-principles.md`.
- `specs/records/2026-07/2026-07-14-left-dock-vertical-density.md`.
- `specs/records/2026-07/2026-07-15-workspace-search-mission-disclosure-and-launcher-copy.md`.
- `specs/records/2026-07/2026-07-15-project-row-surface-and-search-alignment.md`.
- `packages/overlay/src/components/{App,WorkLedger,ProjectLedgerGroup,Icon}.tsx`.
- `packages/overlay/src/styles/cascade/base.css` and `styles/surfaces/{activity,sidebar,titlebar,work-ledger}.css`.
- Focused source and Node browser regressions for the titlebar, Work Ledger, project actions, visible scrollbar, and left-Dock geometry.

### Whole-repository search evidence

Repository-wide `rg` searches enumerated every `workspace-contextbar`, `workspace-command-search`, `work-ledger-search-toggle`, `project-group-new-chat`, `project-group-actions`, `work-ledger-projects-scroll`, `sidebar-body`, `session-scrollbar-size`, and left-Dock browser-test reference.

| Owner / call site                                         | Decision                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.tsx` workspace context bar                           | Preserve the single search Button, command-palette event, title, and accessible label.                                                                                                |
| `ProjectLedgerGroup.tsx` action rail                      | Preserve the existing Kobalte menu plus rightmost new-Chat Button and all behavior.                                                                                                   |
| `design-language.css`                                     | Define the left-rail content/action geometry shared by the context bar, Projects list, and isolated production-component fixtures while reusing the canonical icon-button density. |
| `sidebar.css` `.sidebar-body` and project action controls | Consume the shared body inset and project-action size without changing rendered dimensions.                                                                                           |
| `main.tsx` scrollbar geometry                             | Extend the existing animation-frame scrollbar measurement so the Projects gutter, not a platform constant, feeds the left-rail action axis on mount and resize.                         |
| `work-ledger.css` Projects list                           | Consume the shared list inset and retain the stable visible scrollbar.                                                                                                                 |
| `titlebar.css` workspace search                           | Consume the canonical icon-button density and derive the end padding from the Project plus centerline, including the measured Projects scrollbar gutter.                              |
| Static source tests                                       | Assert the geometry variables and all consumers so the two surfaces cannot drift independently.                                                                                       |
| `titlebar-toolbar-toggle-browser.test.ts`                 | Hover the production Project row, measure both SVG centers, capture the complete left rail, and preserve existing search/button-size assertions.                                      |

### Independent agent feedback

- None. The user did not request sub-agents; the collaboration policy forbids unrequested delegation, and the affected files form one tightly coupled left-rail geometry owner.

## Root cause

The workspace search uses the context bar's standalone end padding. The Project plus is inside the sidebar-body inset, the Projects-list inset, and the stable visible scrollbar gutter. Those independent offsets place the glyphs on different horizontal axes even though each Button is internally centered. The first browser run further proved that the native standards-based scrollbar gutter is not equivalent to the separately rendered WebKit scrollbar-size token; treating them as one width left a measured 3px error. The final design extends the existing runtime scrollbar measurement and makes its actual Projects gutter width part of the shared action centerline. Moving either glyph with a local transform or writing a platform-specific gutter constant would preserve split ownership and drift again when the rail, zoom, or host scrollbar geometry changes.

## Implementation

1. Define one left-rail content/action geometry contract in the design-language tokens for the body inset, Projects-list inset, compact Project action size/half-size, and the derived right action centerline. The search Button consumes the canonical icon-button density rather than introducing a search-only size.
2. Generalize the existing chat scrollbar measurement, measure the single-edge Projects gutter on mount and resize, and publish that value to the shared left-rail geometry variable. Replace matching literals in sidebar, Work Ledger, and titlebar rules with the shared variables, and derive only the context bar's end padding from the Project centerline. Keep its start padding and the search button's existing block-axis optical correction unchanged.
3. Add source assertions and extend the existing production Overlay Node browser fixture to compare the actual SVG centers, compare the measured gutter with the rendered Projects gutter, and save a scoped left-rail screenshot.

## Benchmark

- Input: the supplied 660 × 826 screenshot and the existing production-shaped `titlebar-toolbar-toggle-browser` fixture with one visible Project and its new-Chat action.
- Output: the same desktop left rail with the search and plus glyph centers aligned.
- Environment: compiled Overlay assets served by the existing HTTP fixture; Playwright launched with Node in headed mode; no use of the running user application.
- Timeout: existing repository inactivity wrapper/runner behavior; no fixed elapsed-time kill is added.
- Pass conditions: glyph-center delta no greater than one rendered pixel, canonical 32px search and unchanged 20px Project action boxes at UI scale 1, valid scoped PNG, zero browser errors, focused source/type checks, documentation-health checks, and manual screenshot review.

## Result

- The search and Project plus now consume one right-action centerline whose gutter component is measured from `#workLedgerProjectsScroll`; no transform, duplicate control, or platform-specific scrollbar width was added.
- The production Node browser fixture passed both cases after a real Vite build. It verified a glyph-center delta within one rendered pixel, an exact match between the published gutter and `offsetWidth - clientWidth`, canonical 32px/20px action boxes, and wrote `packages/overlay/.scratch/workspace-search-project-plus-alignment.png`.
- Manual review of the complete 280 × 720 left-rail screenshot confirms the search and plus share one vertical axis, while the Projects scrollbar, action order, row density, title, and footer remain visually intact.
- Focused source regression: 36 passed, 0 failed. The changed single-root architecture guard: 1 passed, 0 failed. Overlay TypeScript check: passed. Production browser regression: 2 passed, 0 failed. Historical/product/document-health checks: 80 passed, 0 failed.
- The focused run exposed stale left-rail density assertions for already-committed 30/24/26/24px row heights, 10/10/4px section margins, and the current `work-mission` / `work-task` icons; those assertions were corrected to the production owners before the new alignment assertion was added.

## Later primitive convergence correction

The original alignment slice used a private 30px search-action token. A later exact-tree review found that this
duplicated the shared Button primitive while source tests already expected the canonical icon-button density. The
private search size and half-size tokens were removed; the centerline formula now derives from
`--oc-density-icon-button`, and both real-page geometry oracles require its 32px base size. The compact 20px Project
action remains distinct because it is a shared control family used by the Project row actions rather than a
one-consumer search exception.
