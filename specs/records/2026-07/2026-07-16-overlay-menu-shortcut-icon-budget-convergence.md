# Overlay Menu, Shortcut, Icon, And Budget Convergence

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement                 | 1. Make the Help menu reasonable. 2. Make every shortcut displayed in the File menu actually work. 3. Give ordinary UI icons one repository-wide size and keep primary body copy on one size; specifically repair the undersized Right Dock `+` and close icons. 4. Center the empty Right Dock tool launcher. 5. Restore Hexin account-balance hover on the Composer model selector.                                                                                                                                                                                                                                                                                                                                                                          |
| Acceptance criteria              | Help is a compact, scan-friendly desktop menu; File-menu shortcut labels and keyboard matching share one definition and trigger the same actions as pointer selection; all rendered Icon-primitive glyphs compute from the canonical 14px icon-size token; Right Dock primary labels resolve to the body/control 14px tier and its empty launcher is centered in the actual panel bounds; a Hexin model exposes a balance tooltip even when connection/directory/resource readiness becomes available after mount; focused tests, typecheck, i18n, build, Node-launched Playwright screenshots, document health, OpenAPI hook checks, second review, commit, and git-cc push pass. |
| Hard constraints                 | Desktop-only scope. Reuse Kobalte Menubar/Tooltip/DropdownMenu, the existing Button/Icon primitives, current Hexin budget resource, and current Right Dock owner. No fallback, duplicate action implementation, hidden shortcut route, handwritten popup, global zoom, mobile scope, temporary iframe, query override, or user-process restart/refresh. Playwright is launched with Node. Preserve unrelated dirty spec work and stage only task-owned hunks.                                                                                                                                                                                                                                                                                                  |
| User evidence                    | `codex-clipboard-c1727271-2e60-4dc5-95a6-a2e3432a6137.png` shows the 520px two-column Help panel with verbose wrapped descriptions; `codex-clipboard-edcea22b-b516-4741-b4bb-e8ea0282a823.png` shows advertised but inert File shortcuts; `codex-clipboard-3066a222-62fe-413b-a149-236d575dd5b0.png` shows 12px Right Dock `+`/close glyphs; `codex-clipboard-f87d1627-3ccf-4523-b838-0c57d7036270.png` shows the empty tool launcher visually offset; `codex-clipboard-639183a1-0857-4f9f-9e80-8172dea25840.png` shows the Hexin selector without its expected balance hover.                                                                                                                                                                                 |
| Sources read                     | `AGENTS.md`; `specs/README.md`; `specs/current/architecture/99-principles.md`; July records for strict Codex parity, startup/chrome parity, icon ownership, composer typography, and the 2026-07-15 budget-hover restoration; `TitlebarMenubar.tsx`; `RightDock.tsx`; `ExecutorSelector.tsx`; `Icon.tsx`; shared design-language/button/titlebar/workspace/composer CSS; focused unit and browser tests.                                                                                                                                                                                                                                                                                                                                                       |
| Whole-repository search evidence | Searches enumerated every `TitlebarMenubar` action and key listener, all displayed `Ctrl+...` strings, all Right Dock catalog/control/empty-launcher selectors, both `HexinBudgetInline` call sites and the only `getHexinBudget` request, all `<Icon ... size>` consumers, all SVG size overrides, and the shared typography/icon tokens. The inventory found one menu owner, no File-shortcut dispatcher, one Right Dock owner, one Hexin budget resource, and many component-authored numeric icon sizes bypassing the existing `--oc-icon-size` token.                                                                                                                                                                                                     |
| Independent agent feedback       | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Evidence-Backed Cause Chain

1. **Help density**
   - Observable: a five-item Help menu occupies a 520px panel and wraps descriptions across multiple lines.
   - Direct trigger: Help alone receives a 520px width, two-column grid items, and long `meta` copy.
   - Root cause: educational descriptions were projected into a command menu whose job is fast action selection; the normal compact Menubar row contract was bypassed for one menu.

2. **Advertised shortcuts are inert**
   - Observable: File menu shows seven accelerator labels, but key presses do not invoke them.
   - Direct trigger: `TitlebarMenubar` listens only for Alt access keys; the top-level app listens only for zoom and F12.
   - Root cause: shortcut strings are presentation-only literals and have no shared executable definition. Pointer actions and keyboard labels therefore diverged.

3. **Icon/type drift and undersized Right Dock chrome**
   - Observable: Right Dock `+` and close are visibly smaller than neighboring icons, and Right Dock primary labels are 12px while the body/control source is 14px.
   - Direct trigger: `RightDock.tsx` passes 12, 14, and 16 numeric sizes while `workspace.css` repeats 12/14 overrides; the repository has many similar numeric icon call sites despite `--oc-icon-size` already existing.
   - Root cause: the Icon primitive exposes arbitrary numeric sizing as the default API, so consumers—not the design language—own ordinary glyph geometry.

4. **Empty launcher centering**
   - Observable: the visible icon/text cluster is offset inside the empty Right Dock.
   - Direct trigger: the list is a full-width block with left-aligned rows, so centering the block does not center the visible content footprint.
   - Root cause: centering is expressed on an invisible max-width container rather than on a content-sized launcher grid.

5. **Balance hover disappears outside ideal startup order**
   - Observable: the real Hexin selector can show no hover content even though the model label is already known.
   - Direct trigger: Tooltip is disabled by `!hexinBudget.key()`. That key also requires connection and directory readiness, so interaction ownership is coupled to whether a request may start at that instant.
   - Root cause: “this is a Hexin model and owns a balance tooltip” and “the budget request has all prerequisites” are separate facts but use one request key. The existing browser fixture starts with all prerequisites and passes, so it cannot detect the delayed-readiness failure.

## Call-Site Disposition

| Owner / call site                                          | Decision                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TitlebarMenubar.tsx` File items and document key listener | Introduce one declarative shortcut catalog for displayed labels, accessible key metadata, matching, and action dispatch. Invoke the existing menu action functions; add no second business-action implementation.                                                                             |
| Help branch and `titlebar.css` Help-only rules             | Remove verbose menu `meta` descriptions and the Help-only two-column/520px contract; retain the five actions, add semantic separators, and use the normal compact panel width/row typography.                                                                                                 |
| `Icon.tsx` and `<Icon size>` consumers                     | Make rendered geometry primitive-owned and backed by `--oc-icon-size`, so historical numeric SVG attributes cannot change layout. Remove the Right Dock's local numeric sizes and add source/browser guards that prevent visual size drift from returning. |
| `RightDock.tsx` / `workspace.css`                          | Consume the default icon size for tab/add/close/menu/launcher glyphs, route primary labels to `--ui-font-body`, keep secondary count/tag copy smaller, and make the empty launcher content-sized and centered in both axes.                                                                   |
| `ExecutorSelector.tsx`                                     | Derive tooltip eligibility from the selected Hexin model, not the resource key. Keep the existing request key/resource as the only balance data source and expose loading/error copy while prerequisites settle.                                                                              |
| Focused source/browser tests                               | Replace obsolete Help two-column and 12px Right Dock assertions; exercise every advertised File accelerator through real keyboard events; add delayed Hexin readiness hover coverage; measure icon/text equality and centered launcher geometry; save task-scoped screenshots.                |
| OpenAPI drift found by baseline push                       | Regenerate/verify the tracked SDK OpenAPI only if the route checker proves the generated contract is authoritative; do not bypass the hook or mix unrelated route behavior changes into this UI repair.                                                                                       |

## Benchmark

- **Environment:** current Windows host worktree; isolated Overlay fixture servers; Node browser runner; no interaction with the user's running OpenCorvus/Overlay process.
- **Pass criteria:**
  1. Help panel has compact width, one-line rows, logical separators, no description column, and all five actions remain functional.
  2. `Ctrl+Shift+N`, `Ctrl+N`, `Ctrl+Alt+N`, `Ctrl+O`, `Ctrl+W`, `Ctrl+,`, and `Ctrl+Q` each prevent the browser default and invoke the same action as their File-menu item when available.
  3. All visible Icon-primitive glyphs compute to `--oc-icon-size`; Right Dock add/close match neighboring glyphs; primary Right Dock labels compute to the body/control tier. Semantic transforms such as a loading spinner's rotation may change an instantaneous axis-aligned bounding box, but not its computed width/height.
  4. Empty launcher content bounds are centered within the real Right Dock body within one pixel on both axes.
  5. Hexin hover is available before and after delayed request prerequisites and eventually shows the real/stubbed budget response; non-Hexin models expose no budget tooltip.
  6. Focused tests, Overlay typecheck/i18n/Vite build, document-health suite, route/OpenAPI hook checks, screenshot review, and final diff review pass.

## Progress

- [x] Reproduce existing ideal-path budget hover and record the test coverage gap.
- [x] Enumerate source owners, history, call sites, and unrelated dirty worktree boundaries.
- [x] Implement compact Help and executable shared shortcuts.
- [x] Normalize ordinary icons, Right Dock typography, and empty-state centering.
- [x] Repair delayed-readiness Hexin hover ownership.
- [x] Run visual/browser/full verification and correct discrepancies.
- [x] Complete second review, selective commit, and git-cc push.

## Verification Evidence

- Repository typecheck, i18n audit, route inventory, and 93 focused unit/source-contract tests pass with zero failures.
- Production Vite build passes.
- Node-launched Playwright proves all seven advertised File shortcuts invoke their real action owners and records `packages/overlay/.scratch/titlebar-help-menu-compact.png`.
- Node-launched Playwright proves every visible Icon-primitive node computes to 14px, the Right Dock add/close and launcher glyphs render at 14px, body copy is 14px, and the content-sized launcher is centered within one pixel on both axes; evidence is `packages/overlay/.scratch/right-dock-empty-centered.png`.
- The existing Hexin integration fixture passes after tooltip eligibility is separated from request readiness, and `.scratch/composer-model-hexin-budget-tooltip-full.png` visibly shows the restored balance hover.
