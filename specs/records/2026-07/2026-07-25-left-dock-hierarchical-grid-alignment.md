# Left Dock hierarchical grid alignment

## Recall

### User requirement

- “整个布局和对齐都有问题，缩进长度也不一样。”
- The supplied screenshot
  `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-18ac503e-af9a-496f-8521-c8c86ff404e9.png`
  shows the complete desktop left Dock. Static navigation, `Chats`,
  `Projects`, Project rows, Mission rows, Chat rows, and their nested levels
  must read as one hierarchy rather than several locally aligned fragments.

### Acceptance criteria

- `Chats`, `Pinned`, and `Projects` consume one section inset.
- Static navigation and every top-level Project row share one icon axis and
  one label axis.
- Each Project child row advances exactly one shared tree-depth increment on
  both its icon and label axes; each Mission child Task advances the same
  increment again.
- Anonymous `Chats` groups and named `Projects` groups use identical Project
  and child-row geometry.
- Mission rows with child Tasks and sibling Chat/Task rows share the same
  title axis. The child-count disclosure remains visible without preceding
  and displacing the Mission title.
- Existing vertical density, row actions, status/loading projection,
  selection, hover/focus behavior, Project actions, collapse behavior,
  Mission child reveal, scrollbar geometry, and desktop-only scope remain
  intact.
- Focused source tests, Overlay typecheck/build, a real Vite fixture,
  Node-launched headed Playwright geometry, task-scoped screenshots, and a
  second visual/code review pass.

### Hard constraints

- Preserve every concurrent worktree change. Do not stash, reset, restore,
  broadly stage, create another worktree, or touch the running
  OpenCorvus/Overlay process.
- Reuse `WorkLedger`, `ProjectLedgerGroup`, `Button`, `Icon`, and the existing
  navigation-row primitives. Do not add a second sidebar, compatibility
  selector, fallback layout, temporary iframe, local signal, or query override.
- Keep one token-owned hierarchy. No per-section pixel compensation.
- Playwright runs through Node, never Bun.
- Commit subjects start with `dsw-33987` and push the current delivery branch
  to `myhexin`.

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-08-work-ledger-row-alignment.md`
- `specs/records/2026-07/2026-07-14-left-dock-vertical-density.md`
- `specs/records/2026-07/2026-07-15-workspace-search-mission-disclosure-and-launcher-copy.md`
- `specs/records/2026-07/2026-07-16-mission-disclosure-row-inset-alignment.md`
- `specs/records/2026-07/2026-07-17-workspace-search-project-plus-alignment.md`
- `specs/records/2026-07/2026-07-21-work-ledger-visible-action-right-edge-alignment.md`
- `specs/records/2026-07/2026-07-25-anonymous-project-chats-promotion-and-attachments.md`
- `specs/records/2026-07/2026-07-25-left-dock-direct-launch-and-alignment.md`
- `specs/records/2026-07/2026-07-25-left-dock-brand-and-focus-weight.md`
- `packages/overlay/src/components/{WorkLedger,ProjectLedgerGroup,LedgerRowMainButton}.tsx`
- `packages/overlay/src/styles/tokens/design-language.css`
- `packages/overlay/src/styles/surfaces/{sidebar,work-ledger}.css`
- The focused source and browser tests named below.

### Whole-repository grep and call-site disposition

| Owner / call site | Current evidence | Decision |
| --- | --- | --- |
| Left-rail geometry tokens | Project-list and navigation-section insets independently encode the same 10px value; no tree-depth token exists. | Replace the duplicate section insets with one section token and add one semantic tree-depth token. Preserve the body and row-control insets. |
| `.sidebar-codex-static-nav` / `.sidebar-codex-action` | The static rows already establish the desired top-level icon and label axes. | Keep their geometry and make Project rows consume the same section, control, icon-track, and label-gap tokens. |
| `.work-ledger-section-title`, Projects toolbar, `ledger-list`, Chat groups, pinned groups | Section headings and wrappers use 14px, 10px, missing padding, and header-local compensation. | Consume the single section inset everywhere and delete section-specific Project-header offsets. |
| `.project-group-toggle` | Uses a separate 20px icon track, 7px gap, and a context-specific header inset. | Use the shared row-control inset, icon track, and label gap. |
| `.project-group-body` | Owns a 12px child inset that is unrelated to any other hierarchy level. | Consume the shared tree-depth increment. |
| `.task-row-mini` / `.work-row` | The Work row starts at a 9px literal, uses a phantom zero column, and the main Button adds another 3px inset. | Use the shared row-control inset, icon track, and label gap; remove only the Work-row main Button’s extra inline padding. |
| `mission-task-disclosure` | The only renderer mounts between the kind glyph and row body, so a Mission with Tasks shifts its title while a sibling Chat/Task does not. | Keep the same visible count/chevron inside the row head after the title, preserving truthful child metadata without changing the title axis. |
| `.work-row-child-list` | Owns a separate 14px Mission-child inset. | Consume the same tree-depth increment used by Project children. |
| `work-ledger-top-level-alignment.test.ts` | Protects the 14px/4px/0px compensations and 12px child inset now disproved by the supplied screenshot. | Replace those assertions with the single-grid contract and reject local header compensation. |
| `left-dock-compact-browser.test.ts` | Measures vertical density and Mission glyph alignment but not cross-level label axes; its Mission disclosure fixture precedes the title. | Model the production markup, assert exact icon/label depth increments and same-level title axes, and save the scoped Dock screenshot. |
| `global-new-chat-provider-error-browser.test.ts` | Real Vite fixture asserts Project icons equal section-heading starts and only checks that the anonymous child moves right. | Replace the weak oracle with exact static/Project/anonymous/named/child axes, add a named Mission with child Tasks, and capture the real production-shaped left Dock. |
| Action/status/browser owners | Right-edge alignment, hover actions, scrollbar, and Project menus are already covered by dedicated tests. | Preserve and rerun the focused owners; do not create another action geometry. |

### Independent agent feedback

- None. The user did not request sub-agents, and the current collaboration
  policy prohibits unsolicited delegation.

## Causal chain

The previous alignment repair treated each section header as an isolated visual
target. It therefore applied 14px to anonymous Chat Project headers, 4px to
pinned Project headers, and 0px to regular Project headers while leaving child
content at 12px. That makes the three top-level headers appear locally aligned
to their neighboring headings, but the compensation does not flow into their
children: an anonymous Chat title lands on its Project title axis while a named
Project child advances much farther. Separately, the Mission disclosure is a
conditional grid column before the row body, so only Missions with child Tasks
move their titles to the right. The visible result is a set of incompatible
axes rather than a tree.

## Design

1. Keep the existing body inset and define one section inset, one row-control
   inset, one icon track, one label gap, and one tree-depth increment.
2. Project static navigation and all Project headers onto the same top-level
   icon and label axes. Make every section wrapper consume the same section
   inset and delete context-specific Project-header offsets.
3. Make Project children and Mission child Tasks consume the same depth token.
   Normalize Work-row columns and remove the Work main Button’s redundant
   inline inset so icon and text axes advance by the same depth.
4. Keep the Mission child count/chevron in the row head after the title so it
   remains visible without changing the title’s start.
5. Strengthen the source, isolated headed-browser, and real Vite tests, inspect
   both screenshots at original resolution, then run focused regression,
   typecheck/build, documentation health, and final diff review.

## Progress

- [x] Inspect the screenshot, prior records, current owners, focused tests,
      dirty worktree, and synchronized remote baseline.
- [x] Record the complete Recall, causal chain, call-site disposition, and
      verification plan before implementation.
- [x] Add failing hierarchy geometry regressions.
- [x] Implement the single left-Dock hierarchy grid.
- [x] Complete real Vite/browser visual acceptance and correction.
- [x] Complete second review and focused validation.
- [x] Commit and git-cc push.

## Codex review feedback

The first real-browser pass exposed two offsets that source inspection alone
did not make obvious: the Work-row main Button still contributed its primitive
inline padding, and Task rows retained a transparent one-pixel border while
Mission and Chat rows did not. Both affected the rendered axis even though the
grid tokens were shared. The final implementation removes that Button-local
padding and makes the shared Work row borderless, rather than introducing
another context-specific compensation. The related action-right-edge browser
test was rerun after this correction.

The same review found two stale browser fixtures outside the production
implementation: the hover fixture still modeled the former title element and
compact archive glyph, while the scrollbar fixture did not answer the current
Mission-skill catalog and file requests. Those test owners were updated to
model the current production contract; no fallback was added to product code.

## Verification results

- Exact rendered hierarchy at `--ui-scale: 1`: section heading `x=18`,
  top-level icon `x=26`, top-level label `x=52`, Project-child icon `x=46`,
  Project-child label `x=72`, Mission-child icon `x=66`, and Mission-child
  label `x=92`.
- `node packages/overlay/test/browser-runner.mjs
  packages/overlay/test/browser/left-dock-compact-browser.test.ts
  packages/overlay/test/browser/global-new-chat-provider-error-browser.test.ts`
  passed against the Vite build.
- `node packages/overlay/test/browser-runner.mjs
  packages/overlay/test/browser/hover-action-geometry.test.ts
  packages/overlay/test/browser/ledger-scrollbar-browser.test.ts` passed.
- The focused Work Ledger source regressions, Overlay typecheck and
  internationalization check, historical documentation links, and
  `git diff --check` passed.
- Original-resolution screenshots inspected:
  `.scratch/left-dock-hierarchical-grid-vite.png`,
  `.scratch/left-dock-navigation-row-height-light.png`,
  `.scratch/default-anonymous-project-chats-dock-provider-error.png`, and
  `.scratch/work-ledger-visible-action-right-edge-alignment.png`.
