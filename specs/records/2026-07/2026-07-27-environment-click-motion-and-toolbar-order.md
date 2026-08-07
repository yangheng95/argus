# Environment Click Motion And Toolbar Order

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

The supplied chat-header screenshot shows `Open in`, the Right Dock button, and
the Environment Information button in that order. The requested correction is
limited to this control region:

1. exchange the two circular icon positions so Environment Information sits
   immediately after `Open in` and the Right Dock button is the trailing
   control;
2. remove pointer-hover opening from Environment Information and open or close
   it only by clicking its button;
3. when the conversation Workbench is wide enough for the existing shared-width
   behavior, animate the conversation lane so the Environment panel slowly
   squeezes into view in the same manner as Codex;
4. retain the existing narrow-Workbench floating overlay behavior.

### Acceptance criteria

- `App.tsx` renders editor launchers, Environment Information, then Right Dock;
  no icon, button primitive, size, gap, or unrelated header geometry changes.
- Hovering the Environment trigger leaves `aria-expanded="false"` and does not
  mount the Popover; clicking opens it and a second click closes it.
- The existing controlled Kobalte Popover remains the only Environment surface
  and open signal.
- At the existing 900-pixel named `chat-workbench` boundary, opening and closing
  Environment transitions the conversation frame's inline-end padding through
  the shared slow motion token.
- Below that boundary, opening Environment does not reserve a conversation
  lane and remains a floating overlay.
- Reduced-motion preference resolves the squeeze transition to the canonical
  instant duration.
- Focused source tests, Overlay typecheck/build, a Node-launched real-browser
  click/hover/animation check, task-scoped screenshots, original-resolution
  visual review, document health, and a second diff review pass.

### Hard constraints

- Reuse the current `Popover`, `Button`, Portal, named `chat-workbench`
  container, motion tokens, width/clearance tokens, and browser fixture.
- Do not add a second Environment card, open store, manual position
  calculation, viewport listener, state machine, fallback, compatibility path,
  temporary iframe, hidden message, or new responsive scope.
- Do not change the icons themselves or any control dimensions; only exchange
  the two existing mounts.
- Do not restart, refresh, close, or reuse the operator's running
  OpenCorvus/Overlay process. Visual verification uses an isolated
  Node-launched fixture.
- Preserve the unrelated Work Ledger, Agent-card browser, Environment
  typography, and navigation-row edits already present in the working tree.
- Commit subjects use `dsw-33987`; delivery targets the legacy remote
  remote.

### Material read before implementation

- Root `AGENTS.md` and the Browser control skill.
- The supplied screenshot at original resolution.
- `specs/current/architecture/07-panel.md`.
- `2026-07-27-environment-panel-responsive-docking-and-conversation-presentation.md`.
- `2026-07-21-workspace-editor-hover-dropdown.md`.
- `App.tsx`, `TaskDirBar.tsx`, `conversation.css`, `workspace.css`,
  `design-language.css`, focused source tests, and the Environment browser
  fixture.

### Whole-repository search evidence

Searches enumerated every `solidChatHeaderRightDockToggle`,
`solidChatHeaderRuntimeActions`, `project-runtime-status-dropdown`,
`openedFromMouseEnter`, `openRuntimePanelFromMouseEnter`,
`leaveRuntimePanelTrigger`, named `chat-workbench` container rule,
Environment panel `:has()` clearance owner, and browser interaction consumer.

| Call point / owner | Current fact | Disposition |
| --- | --- | --- |
| `App.tsx` | Renders editor launchers, Right Dock, then Environment. | Exchange the two existing mounts so Right Dock is trailing. |
| `TaskDirBar.ProjectRuntimeStatusPanel` | One controlled Kobalte Popover owns both click and mouse-enter opening through `openedFromMouseEnter`. | Remove the hover-only flag and handlers; retain one direct click toggle and existing programmatic source presentation. |
| `conversation.css` | Wide Workbenches instantly add Environment inline-end clearance through one `:has(.project-runtime-status-panel)` rule; narrow Workbenches retain overlay behavior. | Put the transition on the stable conversation frame and use the shared slow duration; keep the existing boundary and clearance source. |
| `design-language.css` | Owns `--ui-duration-slow`, `--ui-duration-instant`, and `--ui-timing-standard`. | Reuse unchanged; add no timing literal. |
| `task-cwd-row-layout.test.ts` | Freezes the retired hover handlers and the old toolbar order. | Replace those assertions with click-only ownership, trailing Right Dock order, and the squeeze/reduced-motion contract. |
| `task-dirbar-keyboard.test.ts` | The shared helper and two coexistence paths still open Environment by hover; the file also has unrelated uncommitted typography tolerance edits. | Update only the interaction-specific hunks to prove hover does not open, click does, and wide padding transitions over time; preserve and do not stage the pre-existing hunks. |
| `specs/current/architecture/07-panel.md` | Describes pointer hover and Environment as the trailing toolbar action. | Replace those clauses with click ownership, trailing Right Dock order, and animated wide clearance. |

No backend route, database schema, API contract, localization key, Right Dock
store, Environment resource loader, icon asset, or control primitive requires
modification.

### Independent agent feedback

No independent agents were requested, so none were started. The primary agent
performed the required repository-wide call-point audit.

### Working-tree and remote evidence

The branch started at `2cdf8123e8` and matched the locally known
`legacy-remote/work-v0.0.19beta-yr-0727` ref. Four unrelated files were already
modified, including focused browser-test tolerance changes, so this task must
stage only its own hunks. `git fetch legacy-remote` failed before implementation
because `legacy remote.myhexin.com` could not be resolved; the push will be retried
after validation without hiding or rewriting that external blocker.

## Root cause

The toolbar mismatch is structural: `App.tsx` mounts Right Dock before
Environment, so normal flex order places Environment at the far right. The
hover behavior is not supplied by Kobalte; `TaskDirBar.tsx` explicitly opens the
controlled Popover from `onMouseEnter` and carries an additional flag solely to
neutralize the following click. Removing those handlers and the flag restores
one unambiguous direct click interaction.

The wide panel already uses the correct single-source layout model, but the
`:has()` clearance appears in one style recalculation with no transition on the
stable frame. The root visual correction is therefore a padding transition on
that existing frame, not a second dock, animated panel copy, measurement
listener, or positional transform.

## Implementation plan

1. Exchange the two existing chat-header mounts in `App.tsx`.
2. Remove Environment's hover-open branch and retain direct click,
   programmatic source presentation, and explicit child-action closure.
3. Animate the stable conversation frame's inline-end padding through the
   shared slow motion token, with the canonical reduced-motion override.
4. Update focused source/browser tests and current architecture.
5. Run isolated Node browser verification, inspect wide opening/closing and
   narrow floating screenshots, then run typecheck/build/i18n and document
   health.
6. Perform a second diff review, commit only task-owned changes with
   `dsw-33987`, reconcile the branch, and push to `legacy-remote`.

## Verification ledger

- Focused source contract:
  `bun test packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/flat-redesign-motion-coverage.test.ts`
  passed 15 tests.
- Overlay type safety:
  `bun run --cwd packages/overlay typecheck` passed.
- Focused format validation:
  `bunx biome check` passed for every task-owned TypeScript, TSX, and CSS
  implementation/test file.
- Real browser interaction and motion:
  `node --test --test-concurrency=1 --test-name-pattern "chat header environment panel matches|environment opens only on click" packages/overlay/test/browser/task-dirbar-keyboard.test.ts`
  passed both wide-layout and click-only cases through the Node Playwright
  sidecar. The browser observed the active
  `project-runtime-panel-enter` animation and the conversation frame's
  `padding-inline-end` transition using the shared slow duration.
- Associated Environment browser consumer:
  `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/goal-group-css-residue-browser.test.ts`
  passed after its fixture was brought onto the current Work Ledger,
  Mission Skill, three-state goal rollup, and default-collapsed contracts.
- Original-resolution visual review passed for:
  `.scratch/codex-message-header-toolbar-closed.png`,
  `.scratch/environment-popover-hover-closed.png`,
  `.scratch/environment-popover-click-open.png`,
  `.scratch/environment-popover-right-dock-wide-clearance.png`, and
  `.scratch/environment-popover-right-dock-narrow-overlay.png`. They show
  Environment immediately after `Open in`, Right Dock at the trailing edge,
  no hover opening, wide conversation clearance, and narrow overlay behavior.
- Historical links and product-document single-source checks passed. The
  combined document-health command reported one unrelated working-tree
  failure because the concurrently added, untracked
  `2026-07-27-agent-rail-tooltip-right-placement-restoration.md` is already
  linked from the monthly index; this task neither stages nor modifies that
  separate record.
- A titlebar browser suite rendered and captured the corrected requested header
  region before later failing on a pre-existing Work Ledger disclosure-width
  assertion outside this task's region. The focused Environment browser
  acceptance above is fully passing.
- `git diff --check` passed. The second diff review preserved the concurrent
  Agent Rail tooltip animation, Work Ledger, navigation-row, and browser
  typography edits by excluding those unrelated hunks from this delivery.
