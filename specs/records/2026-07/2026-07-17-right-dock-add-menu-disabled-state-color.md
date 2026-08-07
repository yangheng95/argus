# Right Dock Add-Menu Disabled-State Color Repair

## Recall

### User requirement

- Fix the incorrect, overly pale text color in the dropdown opened by the Right Dock `+` button.
- The supplied light-theme screenshot shows every tool label and icon rendered with disabled-state opacity even though the unopened tools are actionable.

### Acceptance criteria

- An unopened Right Dock tool menu item does not expose native or Kobalte disabled state and renders at full opacity with the canonical menu text color.
- An already-open tool remains genuinely disabled, retains the existing `Opened` metadata, and keeps the shared disabled treatment.
- The fix preserves `DropdownMenu`, Kobalte, `RIGHT_DOCK_CATALOG`, and the existing add/open interaction as the single owners.
- Focused source tests, Overlay TypeScript, the Node-launched real browser path, a scoped light-theme screenshot, and document-health checks pass without restarting or modifying the user's running OpenCorvus/Overlay process.

### Hard constraints

- Do not add a color override, opacity exception, fallback selector, or a second disabled-state source. Repair the incorrect DOM state at its owner.
- Do not change theme tokens or the shared `DropdownMenu` disabled recipe; those correctly style genuine disabled items.
- Preserve unrelated worktree edits and stage only this task's files/hunks.
- Use Node, never Bun, to launch Playwright.

### Sources read

- `packages/overlay/src/components/RightDock.tsx`
- `packages/overlay/src/components/ui/DropdownMenu.tsx`
- `packages/overlay/src/styles/primitives/dropdown-menu.css`
- `packages/overlay/src/styles/surfaces/workspace.css`
- `packages/overlay/test/right-dock-panel-ownership.test.ts`
- `packages/overlay/test/dropdown-menu-primitive.test.ts`
- `packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts`
- `specs/records/2026-07/2026-07-17-overlay-primitive-system-convergence.md`
- `specs/records/2026-07/2026-07-16-review-changes-and-empty-dock-alignment.md`
- `specs/records/2026-07/2026-07-14-overlay-startup-and-chrome-parity.md`

### Whole-repository search evidence

Repository searches covered every `data-disabled={...}` JSX writer, every CSS `[data-disabled]` consumer, every Right Dock add-menu render/style/test selector, and every browser helper that opens a Right Dock tool through the menu.

| Owner / call site | Evidence and decision |
| --- | --- |
| `RightDock.tsx` add-menu item | The only `data-disabled={String(...)}` writer. Delete this manual serialization and retain `disabled={isOpen()}` as the single semantic source. |
| `ui/DropdownMenu.tsx` | Keep the canonical Kobalte adapter unchanged; it projects the real disabled state to DOM attributes. |
| `primitives/dropdown-menu.css` | Keep `[data-disabled]` / `:disabled` shared opacity unchanged because presence selectors correctly describe genuine disabled items. |
| `workspace.css` | Keep Right Dock domain layout and genuine-open styling unchanged; do not mask the false attribute with a feature override. |
| `RadioGroup.tsx` | Preserve the only sibling explicit writer because it emits an empty attribute only when disabled and `undefined` otherwise. |
| `right-dock-panel-ownership.test.ts` | Add the source-level regression that forbids string-valued disabled projection while retaining the semantic `disabled` property. |
| `titlebar-toolbar-toggle-browser.test.ts` | Extend the existing real Right Dock fixture to assert full-opacity enabled state, genuine disabled state after opening, light-theme computed color, and the scoped menu screenshot. |
| Other Right Dock browser helpers | Preserve; they consume the same canonical menu items and gain the repair without parallel logic. |

### Independent agent feedback

- None. The user did not request delegated agents, and the repair is localized to one DOM-state owner plus its existing regression path.

## Root cause

`RightDock` serializes the reactive boolean as `data-disabled="false"` for unopened tools. CSS attribute selectors match attribute presence rather than the string's truth value, so the shared `.oc-menu-item[data-disabled]` rule applies `--ui-opacity-disabled` to every add-menu row. The theme palette and menu primitive are behaving correctly against an incorrect DOM contract.

## Implementation plan

1. Remove the manual string-valued `data-disabled` attribute and keep Kobalte's `disabled={isOpen()}` projection as the only disabled-state source.
2. Add focused source and real-browser regressions for enabled and opened rows, including computed opacity/color and a light-theme menu screenshot.
3. Run focused tests, TypeScript, production Overlay build, document-health checks, inspect the rendered screenshot, then record the result and deliver the isolated commit to legacy remote.

## Result

- Removed the manual `data-disabled={String(isOpen())}` projection. Unopened items now expose no disabled state and Kobalte remains the only owner for opened-item disabled semantics.
- Updated the Right Dock domain selectors from the string-value form to canonical `[data-disabled]` presence selectors, preserving muted `Opened` rows without affecting enabled rows.
- PASS: 8 focused menu/Right Dock/chrome tests, 232 expectations.
- PASS: Overlay TypeScript and panel i18n (`8086d1b8b04d6219`).
- PASS: the Node-launched real browser scenario rebuilt the production Vite surface (2,492 modules) and passed both browser tests. It proves enabled Browser/Terminal rows have no disabled state, use full opacity and the resolved `--text-soft` color for both label and icon, while an opened Browser row retains Kobalte disabled state, reduced opacity, and the `Opened` tag.
- PASS: `.scratch/right-dock-add-menu-light-enabled-color.png` was inspected at original resolution. The light-theme menu has legible canonical body-gray labels/icons, aligned baselines, intact border/elevation, and no clipped rows in the captured viewport.
- PASS: 21 historical-document tests and scoped/cached whitespace checks.
- The browser skill guided the background visual-inspection workflow; the deliverable evidence remains the repository's task-scoped Node Playwright fixture and screenshot, matching the project acceptance contract.
