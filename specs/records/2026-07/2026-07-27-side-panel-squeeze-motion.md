# Side Panel Squeeze Motion

Date: 2026-07-27
Status: Implemented
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser layout and presentation language.
- DOM: Document Object Model, the browser's rendered element tree.
- VCS: Version Control System, the canonical repository status source.

## Recall

### User requirement

The supplied desktop screenshot highlights the left Projects panel toggle and
the right component-panel toggle. Opening and closing either panel should
follow the existing Environment floating-panel motion language and visibly
squeeze or release the center Workbench instead of jumping between layouts.

### Acceptance criteria

- Clicking the left panel toggle animates the left layout root between its
  configured width and zero, continuously moving the Workbench edge.
- Clicking the right panel toggle animates the Right Dock and its resizer
  between their configured widths and zero, continuously squeezing or
  releasing the center conversation.
- Both panels remain mounted during closing so the browser can render the
  complete transition; closed panels are not interactive or exposed as open
  accessibility surfaces.
- The existing persisted left and right widths, Right Dock resize behavior,
  panel contents, toggle controls, and desktop-only layout remain unchanged.
- Motion reuses the canonical slow duration and standard timing tokens already
  used by the Environment squeeze. Reduced-motion preference resolves the
  layout transition to the canonical instant duration.
- Focused source tests, Overlay typecheck/build, Node-launched headed
  Playwright interaction/geometry checks, task-scoped open/closed screenshots,
  original-resolution visual review, documentation health, and a second diff
  review pass.

### Hard constraints

- Reuse the existing shell, Right Dock, resizer, toggle, settings store, and
  motion tokens. Do not add a second panel, open store, timer, state machine,
  compatibility path, fallback, viewport listener, or manual transform
  measurement.
- Do not restart, refresh, close, or reuse the operator's running
  OpenCorvus/Overlay process. Visual verification uses an isolated
  Node-launched fixture.
- Keep this delivery desktop-only. No tablet, mobile, or new responsive scope.
- Preserve the existing uncommitted Work Ledger and test edits; stage only
  task-owned changes.
- Commit subjects use `dsw-33987`; delivery targets the git-cc `myhexin`
  remote.

### Material read before implementation

- Root `AGENTS.md` and the Browser control skill.
- The supplied screenshot at original resolution.
- `specs/current/architecture/07-panel.md` and
  `specs/current/architecture/07-panel-reactivity.md`.
- `2026-07-27-environment-click-motion-and-toolbar-order.md`,
  `2026-07-27-environment-panel-responsive-docking-and-conversation-presentation.md`,
  `2026-07-24-right-dock-conversation-width-boundary.md`, and the current
  monthly/root spec indexes.
- `App.tsx`, `main.tsx`, the Right Dock store, settings/pane configuration,
  `activity.css`, `sidebar.css`, `workspace.css`, `conversation.css`, design
  tokens, and focused source/browser tests.

### Whole-repository search evidence

Searches enumerated every `leftActivityShell`, `sidebarCollapsed`,
`rightDockOpen`, `setRightDockVisible`, `rightDock.hidden`,
`rightDockResizer`, `.left-activity-shell`, `.sidebar[data-collapsed]`,
`.right-dock[data-open]`, panel width token, transition, resize, and browser
consumer.

| Call point / owner | Current fact | Disposition |
| --- | --- | --- |
| `App.tsx#leftActivityShell` | The outer left shell is the actual flex item that occupies layout width. | Keep the existing element and `data-collapsed`; make this root own the squeeze transition. |
| `activity.css#.left-activity-shell` | Open and closed widths are defined here, but the shell has no transition. | Animate its width, min/max width, and flex-basis through the shared slow motion contract. |
| `sidebar.css#.sidebar` | Carries width/min-width transition, but `activity.css` makes the nested sidebar `width:100%`; it does not move the Workbench edge. | Retain visual ownership but do not duplicate the layout transition here. |
| `main.tsx` sidebar effect | Projects `sidebarCollapsed` onto both sidebar and shell, then schedules persisted pane geometry. | Keep this single open-state projection; add no second signal. |
| `App.tsx#rightDock` / `rightDockResizer` | The Dock is initially closed and the resizer is statically `hidden`. | Keep both nodes mounted with explicit `data-open` and accessibility state. |
| `main.tsx` Right Dock effect | Projects the canonical signal, then immediately writes `dock.hidden` and `resizer.hidden`. | Remove display-removal writes; project `data-open` and `aria-hidden` only. |
| `workspace.css#.right-dock` | Open width is canonical; the closed selector uses `display:none`. | Transition the existing width/flex-basis/max-width to zero and suppress closed interaction without removing layout frames. |
| `workspace.css#.right-dock-resizer` | Open resizer width is canonical; `[hidden]` removes it immediately. | Transition the same resizer root between border width and zero from `data-open`. |
| Right Dock resize functions | Persist and clamp `--right-dock-width`; they read the mounted Dock geometry. | Keep unchanged; animation consumes the same custom property. |
| `composer-file-loader-right-dock.test.ts` and titlebar browser checks | Assert the retired `hidden` projection and resizer hidden state. | Replace with mounted/data-open/accessibility assertions and animated geometry. |
| Existing Environment motion | Uses `--ui-duration-slow`, `--ui-timing-standard`, and an instant reduced-motion override for a visible layout squeeze. | Reuse the same motion language without copying the Environment surface or its Popover state. |

No backend route, database schema, API contract, localization key, component
catalog, or panel content requires modification.

### Independent agent feedback

No independent agents were requested, so none were started. The primary agent
performed the required repository-wide call-point audit.

### Working-tree and remote evidence

The branch starts this task at `667c7e6e5b`, matches
`myhexin/work-v0.0.19beta-yr-0727`, and already contains four unrelated
uncommitted files. A pre-change fetch succeeded; `myhexin/v0.0.19beta` has
advanced independently and will be reconciled before delivery without
overwriting the unrelated working-tree edits.

## Root cause

The visible jump is caused by the layout roots, not the panel content or toggle
buttons. The left shell directly changes its flex width from the configured
rail width to zero without a transition, while the nested sidebar's existing
transition cannot move the Workbench because the outer shell owns that flex
edge. The Right Dock is removed from layout immediately through the `hidden`
attribute and a `display:none` selector, so no intermediate width can ever be
painted.

The single-source repair is to animate the two existing layout roots and keep
the Right Dock/resizer mounted while their canonical open state projects
zero-width, non-interactive closed geometry. This matches the Environment
squeeze principle: animate the stable layout owner instead of duplicating or
manually positioning the panel.

## Implementation plan

1. Give the left shell canonical slow width/flex-basis transitions and an
   instant reduced-motion override.
2. Replace Right Dock/resizer display removal with `data-open`-driven
   width/flex-basis transitions and closed accessibility/interactivity.
3. Update focused source contracts and add a headed real-browser interaction
   case that measures intermediate geometry for both panel directions and
   captures task-scoped screenshots.
4. Update current panel architecture and this verification ledger.
5. Run focused tests, typecheck/build/i18n, document health, inspect screenshots
   at original resolution, perform a second diff review, commit only
   task-owned hunks, reconcile the delivery branch, and push to `myhexin`.

## Verification ledger

- Focused source contracts passed all 16 tests across
  `side-panel-squeeze-motion.test.ts`,
  `composer-file-loader-right-dock.test.ts`,
  `left-work-ledger-shell.test.ts`, and
  `flat-redesign-motion-coverage.test.ts`.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed with catalog digest
  `0762a4bc7c9590d2`.
- `bun run --cwd packages/overlay build:vite` passed after 7,043 modules; its
  output contained only the established dependency directive and chunk-size
  warnings.
- The Node-launched headed `pane-collapse-rail.test.ts` passed. It measured
  both opening and closing frames strictly between zero and the final Projects
  panel width, and proved the Workbench edge moved with the panel.
- The Node-launched headed Right Dock case in
  `titlebar-toolbar-toggle-browser.test.ts` passed. It measured a non-zero
  intermediate Dock width below the final width, a conversation width above
  the final squeezed width, closed/open `inert` and `aria-hidden` semantics,
  resizer accessibility state, and the final panel geometry.
- The same browser run exposed and repaired three test-toolchain defects before
  reaching the real checker: a rotating loading icon was measured through its
  transform-dependent bounding box instead of computed width, a keyboard-tab
  fixture requested an impossible Dock width and did not trigger tab reflow,
  and one screenshot assertion retained a retired filename.
- Original-resolution review passed for
  `.scratch/pane-collapse-titlebar-collapsed.png`,
  `.scratch/pane-collapse-titlebar-expanded.png`,
  `.scratch/codex-message-header-toolbar-closed.png`,
  `.scratch/right-dock-last-tab-closed.png`, and
  `.scratch/right-dock-empty-centered.png`. The endpoints preserve the
  established desktop shell and visibly reserve/release the center Workbench
  without overlay seams or leftover empty rails.
- `bunx biome check`, `git diff --check`, and the historical document-link
  suite passed. Document health passed after the new record was staged, as
  required by its tracked-record ownership check.
- The second diff review confirmed one left shell, one Right Dock, one open
  signal per panel, canonical persisted widths, no timer or state machine, no
  `display:none` Dock close path, reduced-motion coverage, and preservation of
  the unrelated Work Ledger, Agent-card, Environment, and navigation-row
  working-tree edits.
