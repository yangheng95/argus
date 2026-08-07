# Overlay Secondary Menu Hover Interaction

Date: 2026-07-25

Status: Implemented and verified

## Recall

### User request

- The Overlay UI does not automatically expand its secondary menu.
- The current operation path feels awkward.
- Inspect the real behavior and repair it.

### Acceptance

- Identify every production two-level menu/list interaction before changing code.
- Reproduce the reported failure in an independently started real Vite Overlay page.
- Hovering the titlebar `File`, `Edit`, `View`, or `Help` trigger opens that
  trigger's second-level menu without a click.
- Moving between titlebar triggers switches the open second-level menu; moving
  through the trigger/content placement gap keeps the intended menu open; and
  leaving both surfaces closes it after a short hover-intent delay.
- Hovering the Composer `+` menu's Agent parallelism row opens its existing
  Kobalte secondary menu without a click and therefore needs no product change.
- Moving from the trigger into the portaled secondary content does not close it.
- Click and keyboard operation remain accessible: titlebar menus still toggle
  from pointer click, open from Alt access keys, focus their initial item, and
  close with Escape.
- The `@` mention category/entity interaction continues to project the hovered
  category automatically and is covered so this repair cannot regress the
  other two-level Overlay interaction.
- Focused source tests, Node-launched browser interaction, Overlay typecheck,
  Vite build, and task-scoped screenshot review pass.

### Hard constraints

- Preserve every unrelated dirty-worktree change; do not stash, reset, restore,
  delete, or broadly stage shared work.
- Do not refresh, close, restart, or otherwise interfere with the user's
  running OpenCorvus/Overlay process.
- Reuse the mature Kobalte `DropdownMenu` and shared Overlay menu primitives.
- Do not create a second menu, click fallback, hidden state source, hand-written
  popup, workflow gate, or compatibility path.
- Use Node, not Bun, for Playwright execution.
- Desktop delivery only; no tablet/mobile expansion is in scope.

### Read sources

- Root `AGENTS.md`.
- Browser control skill instructions.
- `packages/overlay/src/components/ChatComposer.tsx`.
- `packages/overlay/src/components/ComposerMentionMenu.tsx`.
- `packages/overlay/src/components/ui/DropdownMenu.tsx`.
- Installed Kobalte `menu-sub-trigger` implementation.
- `packages/overlay/test/composer-run-controls.test.ts`.
- `packages/overlay/test/browser/chat-composer-resize-browser.test.ts`.
- Prior Workspace Editor hover-menu and Overlay interaction records.

### Whole-repository grep

| Surface | Finding | Disposition |
| --- | --- | --- |
| `DropdownMenu.SubTrigger` / `SubContent` | One production call site: Agent parallelism inside the Composer `+` menu | Reproduce, verify it already auto-opens, and keep unchanged |
| `ComposerMentionMenu` category/entity panels | One custom two-level list; category pointer entry already calls `onCategoryHighlight` | Verify it continues to auto-project rather than changing its architecture |
| Settings navigation groups | Group headings plus flat Tabs; there is no expandable submenu | Keep unchanged |
| Titlebar menus | Four top-level triggers own four portaled second-level menus; the controlled wrapper only writes open state on `pointerdown` | Primary repair surface |
| Workspace editor launcher | One hover-open root dropdown, not a secondary menu; already owns cross-gap delayed close | Reuse its interaction lessons, do not modify it |
| Project, Work Ledger, file explorer, and context menus | Flat item collections in current production source | Keep unchanged |
| Browser coverage | Existing titlebar tests open all four second-level menus by click and therefore cannot detect the missing hover entry | Extend the canonical titlebar test with pointer, portal-gap, sibling, click, and keyboard evidence |

### Independent-agent feedback

- No sub-agent was requested or used.

## Baseline evidence and causal chain

- In the isolated Vite Overlay, the Composer Agent parallelism row changed
  `aria-expanded` from `false` to `true` and rendered visible secondary content
  after a real mouse move and 220ms wait. That mature submenu already meets the
  requested behavior.
- In the same page, moving the pointer to the closed titlebar `File` trigger
  and waiting 250ms left `aria-expanded="false"` and rendered zero
  `[data-testid="titlebar-menu-file"]` elements.
- `TitlebarMenubar` is controlled by `openMenu`. Its only pointer writer is
  `toggleControlledMenuFromTrigger` on `onPointerDown`.
- Kobalte Menubar's `onMouseOver` intentionally changes triggers only when the
  Menubar value is already non-null. It therefore supports File-to-Edit
  switching after click-open but cannot open the first titlebar secondary menu
  from a resting hover.
- Existing browser coverage iterates through all four menus using
  `page.click(...)`, so it proves geometry and actions but cannot falsify the
  missing hover-entry path.

Observable failure → direct trigger → deeper cause → prior coverage gap:

`closed trigger hover renders no panel` → `openMenu` receives no pointer-hover
write → the controlled wrapper supplies click/keyboard entry but no shared
trigger/content hover-intent ownership → every browser scenario starts by
clicking a trigger.

## Revised implementation plan

1. Keep Kobalte Menubar and the existing `openMenu` signal as the only semantic
   and controlled-state owner.
2. Add one titlebar hover-intent owner spanning each trigger and its portaled
   content: enter opens/cancels close; leave schedules a short cross-gap close;
   component cleanup clears the timer.
3. Preserve click toggle, Alt access keys, arrow navigation, initial keyboard
   focus, outside dismissal, menu actions, and macOS native-menu exclusion.
4. Extend the existing Node browser coverage with closed-state hover open,
   trigger-to-trigger switching, cross-gap retention, leave close, click
   toggle, keyboard entry, and screenshot evidence. Retain Composer hover and
   `@` mention assertions as adjacent two-level behavior checks.
5. Inspect the repaired open-titlebar-menu screenshot at original resolution, run a
   second diff review, then commit only task-owned files with the required
   `dsw-33987` subject prefix and push the current delivery branch to
   `legacy-remote`.

## Implementation

- Kept `Menubar.Root`, the existing `openMenu` signal, Kobalte Popper
  positioning, and portaled menu content as the only semantics/state/geometry
  sources.
- Added one hover-intent owner spanning each top-level titlebar trigger wrapper
  and its corresponding portaled menu content.
- Trigger entry now opens the matching second-level menu without moving focus.
- Trigger/content entry cancels a pending close; leaving either surface starts
  the shared 120ms bridge delay, so crossing the seven-pixel Popper gutter does
  not collapse the menu.
- Pointer click toggle, Kobalte horizontal menu switching, outside dismissal,
  Alt access keys, initial keyboard item focus, shortcuts, and native macOS menu
  exclusion remain unchanged.
- Extended the established titlebar browser fixture to cover hover-open,
  `File`-to-`Edit` switching, portaled-content retention, outside hover close,
  click toggle, and the existing Alt/keyboard path.
- Added the newly required Mission Skill catalog response to that fixture; this
  is a real current bootstrap dependency and prevents a concurrent route
  addition from hiding titlebar interaction results behind a 404.

## Verification

- Focused source tests: 26 passed, 0 failed, 333 assertions.
- Overlay TypeScript check: passed.
- Overlay i18n check: passed.
- Production Vite build: passed; the existing informational large-chunk warning
  remains.
- Focused Node/Playwright browser test
  `titlebar menubar uses theme-adaptive text color and supports Alt access
  keys`: passed.
- Browser evidence proved closed-state hover open, horizontal trigger switch,
  trigger-to-portal retention, outside close, pointer click toggle, Alt access
  key entry, keyboard focus, and theme behavior.
- Screenshot:
  `packages/overlay/.scratch/titlebar-menubar-hover-open.png`.
- Original-resolution screenshot review passed: one titlebar only, one
  correctly anchored File menu, no clipping, no duplicate chrome, no content
  occlusion, and consistent shared menu styling.
- Historical documentation links: 21 passed.
- The combined document-health run passed 82/83 checks. Its remaining check
  reports two unrelated parallel July records that are linked while still
  untracked (`mcp-apps-production-host` and
  `settings-system-visual-functional-audit`). This task did not stage those
  owners' files.

## Second review

- Rechecked all production submenu/list call sites against the final diff.
- Confirmed the Composer Agent parallelism submenu already auto-opens through
  Kobalte and received no product modification.
- Confirmed the Composer mention category/entity path retains its pointer
  highlight regression coverage.
- Confirmed no Settings, project, context-menu, titlebar geometry, native macOS
  menu, or shared menu primitive implementation was duplicated.
- Confirmed cleanup clears the only added timer and no process, listener, or
  alternate open-state owner remains.
