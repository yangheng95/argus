# Command Palette Combobox Primitive

Date: 2026-06-18

## Acronyms

- UI: User Interface, the visible command palette modal.
- ARIA: Accessible Rich Internet Applications, the browser accessibility attributes for combobox/listbox relationships.
- DOM: Document Object Model, the rendered browser element tree.

## Problem

`CommandPalette` already uses the shared Dialog primitive and derives settings
commands from `CONFIG_SECTIONS`, but it still owns a local combobox/listbox
implementation:

- local `activeIndex`;
- hand-written ArrowUp, ArrowDown, Enter, Tab, and Escape behavior;
- hand-written `role="combobox"`, `aria-activedescendant`,
  `role="listbox"`, and `role="option"`;
- local active option ids and scroll-to-active behavior.

That leaves selection and active-descendant semantics in a feature component
instead of a mature UI primitive. The earlier
`2026-06-18-command-palette-activedescendant.md` note intentionally fixed the
missing ARIA link in place, but the broader primitive audit now shows the root
issue is ownership: command palette input/listbox behavior should not be
hand-written in `CommandPalette`.

## Recall

| Source                                                        | Existing decision                                                                                               | Current decision                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `2026-06-18-command-palette-dialog-primitive.md`              | Dialog shell is already centralized in `components/primitives/Dialog.tsx`.                                      | Keep Dialog unchanged.                                                              |
| `2026-06-18-command-palette-config-sections-single-source.md` | Settings commands derive from `CONFIG_SECTIONS`.                                                                | Keep command data source unchanged.                                                 |
| `2026-06-18-command-palette-activedescendant.md`              | Input and listbox needed an ARIA active-descendant link.                                                        | Replace the local active-descendant implementation with Kobalte Combobox ownership. |
| `2026-06-18-popup-contrast-light-palette.md`                  | Command Palette is a popup-like surface covered by the contrast matrix.                                         | Preserve `.cmdk-*` visual classes and browser screenshot coverage.                  |
| `packages/overlay/node_modules/@kobalte/core/src/combobox`    | Kobalte Combobox owns input role, listbox id registration, active descendant, focus wrap, and option rendering. | Create one overlay Combobox primitive wrapper for CommandPalette to consume.        |

## Impact Sweep

| Sweep                           | Result                                                                                                                                                                                                                       | Decision                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `rg -n 'CommandPalette          | cmdk-input                                                                                                                                                                                                                   | cmdk-list                                                                                       | cmdk-item                                                     | aria-activedescendant                                           | activeIndex' packages/overlay/src packages/overlay/test specs`                                                                      | `CommandPalette.tsx` is the only production `cmdk-*` listbox owner; tests currently assert the local ARIA strings. | Migrate `CommandPalette` and invert tests to reject local listbox ownership. |
| `rg -n '@kobalte/core/(combobox | listbox)                                                                                                                                                                                                                     | Combobox                                                                                        | Listbox.Root                                                  | Listbox.Item' packages/overlay/src packages/overlay/test specs` | `FileChangesView` uses Kobalte Listbox for a focusable list; no Combobox primitive exists.                                                   | Add `components/ui/ComboboxControl.tsx` as the only Kobalte Combobox shell owner.                                  |
| `rg -n 'cmdk-                   | command-palette                                                                                                                                                                                                              | cmdk-list                                                                                       | cmdk-item' packages/overlay/src/styles packages/overlay/test` | Real CSS and browser tests key on `.cmdk-*` selectors.          | Keep `.cmdk-input`, `.cmdk-list`, `.cmdk-item`, and footer selectors stable; replace `.cmdk-item--active` with Kobalte `[data-highlighted]`. |
| Kobalte Combobox source review  | `Combobox.Input` owns role, aria-controls, aria-activedescendant, Arrow navigation, Enter selection, Escape close, Tab close/reset, and virtual focus. `Combobox.Listbox` can be rendered directly without `Content/Portal`. | Use Root + Control/Input + Listbox inside the Dialog panel; do not create a second popup layer. |

## Fix Plan

1. Add `packages/overlay/src/components/ui/ComboboxControl.tsx`.
   - It owns `@kobalte/core/combobox` imports and renders Root, Control,
     Input, Listbox, Item, ItemLabel, and ItemDescription.
   - It accepts command-specific class hooks without owning command data.
   - It forwards `open`, `placeholder`, `aria-label`, `options`,
     `defaultFilter`, and `onChange`.
   - Under controlled `open`, it calls Kobalte's combobox context
     `open("first", "input")` when the palette opens or the Kobalte input
     value changes so the library, not `CommandPalette`, owns the active
     descendant for the first filtered row.
   - It forwards Kobalte `onOpenChange` so Escape can request the owning
     Dialog disclosure to close instead of creating a local key handler.
2. Migrate `CommandPalette` to `ComboboxControl`.
   - Keep command construction, filtering keywords, and `run()` callbacks in
     `CommandPalette`.
   - Remove `activeIndex`, manual active option ids, manual listbox roles,
     manual Arrow/Enter/Tab handling, and manual scroll-to-active effect.
   - Let Kobalte Combobox run selection; `CommandPalette` closes and executes
     the selected command in `onChange`.
   - Keep command selection controlled as `null` because the command palette is
     an action launcher, not a persistent picker.
3. Preserve visual shape and test selectors.
   - `.cmdk-item` remains the row class.
   - Active row styling uses Kobalte `[data-highlighted]`, not a local
     `.cmdk-item--active` class.
   - `data-command-id` exposes stable command identity for browser assertions
     without owning listbox ids locally.
4. Update tests.
   - Static guard rejects direct Kobalte Combobox imports outside
     `ComboboxControl.tsx`.
   - Static guard rejects `activeIndex`, `role="listbox"`, `role="option"`,
     and manual `aria-activedescendant` in `CommandPalette.tsx`.
   - Browser test keeps Cmd/Ctrl+K, focus restore, visual screenshot, search,
     ArrowDown, Enter, Escape, and Skill/MCP command execution coverage.
   - Browser settings-panel assertions use the single rendered
     `data-config-panel` as the active panel evidence, not the retired
     `.active` class removed by the settings Tabs primitive.

## Acceptance

- `CommandPalette.tsx` does not import `@kobalte/core/combobox` or
  `@kobalte/core/listbox`.
- Kobalte Combobox direct use appears only in
  `components/ui/ComboboxControl.tsx`.
- `CommandPalette.tsx` has no local `activeIndex`, `commandOptionID`,
  `aria-activedescendant`, `role="listbox"`, `role="option"`, or
  `cmdk-item--active`.
- `CommandPalette.tsx` has no query mirror such as `setQuery` or
  `focusFirstKey`; Kobalte input value is the single query source.
- Cmd/Ctrl+K opens the palette and focuses the Kobalte Combobox input.
- ArrowDown changes the Kobalte active descendant and selected option.
- Enter runs the active command.
- Escape closes the palette and returns focus to the original trigger.
- Real browser screenshot evidence still shows the compact command palette
  with readable active and inactive rows.
