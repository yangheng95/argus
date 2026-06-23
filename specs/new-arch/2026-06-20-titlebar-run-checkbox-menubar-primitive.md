# Titlebar Run Checkbox Menubar Primitive

## Problem

The Run menu is otherwise owned by Kobalte Menubar, but its boolean settings
still use handwritten label/input checkbox rows:

| Source                                                                        | Evidence                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx`                | Historical note: `titlebar.auto_question` and the proposed-task policy checkbox rendered `<label class="titlebar-menubar-toggle"><input type="checkbox">`. The proposed-task label is now `titlebar.auto_confirm_proposed_tasks`. |
| `packages/overlay/src/styles/surfaces/titlebar.css`                           | `.titlebar-menubar-toggle` duplicates menu item layout and focus-within highlight styling outside Kobalte state.                                                                                                                  |
| `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx`                | Ordinary actions already use `Menubar.Item`; theme choices already use `Menubar.RadioItem`.                                                                                                                                       |
| `packages/overlay/node_modules/@kobalte/core/src/menu/menu-checkbox-item.tsx` | `Menubar.CheckboxItem` is available, defaults `closeOnSelect=false`, and owns `role="menuitemcheckbox"`, `aria-checked`, and `data-checked`.                                                                                      |

The native checkbox rows do not participate in the same menuitem checkbox
semantics, roving focus behavior, or highlighted/checked state selectors as the
rest of the titlebar menu.

## Recall

| Search                                                     | Result                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg "titlebar-menubar-toggle                               | type=\"checkbox\"                                                                                                                      | Menubar\\.CheckboxItem | menuitemcheckbox" packages/overlay/src packages/overlay/test specs/new-arch`                                                    | Only the two Run menu rows use `.titlebar-menubar-toggle`; no production `Menubar.CheckboxItem` exists yet.                                    |
| `rg "Menubar\\.Item                                        | Menubar\\.RadioItem                                                                                                                    | data-highlighted       | data-checked" packages/overlay/src/components/titlebar packages/overlay/src/styles/surfaces/titlebar.css packages/overlay/test` | Titlebar already styles Kobalte ordinary and radio menu item states through shared item selectors and `[data-highlighted]` / `[data-checked]`. |
| `specs/new-arch/2026-06-19-titlebar-menubar-form-focus.md` | Prior repair added `:focus-within` to handwritten form rows. This follow-up must remove the checkbox form row instead of extending it. |
| `packages/overlay/test/browser/titlebar-menubar.test.ts`   | Existing browser test opens Run and View menus and can verify real roles plus screenshots with the required Node runner.               |

## Fix Plan

1. Introduce a small `MenuCheckboxItem` helper that wraps
   `Menubar.CheckboxItem as="button"` and renders the existing title/meta copy.
2. Replace the two Run menu native checkbox labels with `MenuCheckboxItem`
   instances, preserving the current config patch functions and test ids.
3. Delete `.titlebar-menubar-toggle` CSS and its native input styling; add only
   checkbox menu item copy/indicator styles that hang off Kobalte item state.
4. Update static tests to require `Menubar.CheckboxItem` and reject the retired
   toggle selector and native checkbox path.
5. Update the browser titlebar test to assert `menuitemcheckbox`,
   `aria-checked`, `data-checked`, keyboard focus/highlight, and screenshot
   evidence for the Run checkbox items.

## Acceptance

- `TitlebarMenubar.tsx` contains `Menubar.CheckboxItem` and no
  `titlebar-menubar-toggle` or `type="checkbox"` path for Run menu settings.
- `titlebar.css` no longer defines `.titlebar-menubar-toggle`.
- Run menu boolean settings expose `role="menuitemcheckbox"` and
  `aria-checked`.
- Browser screenshot confirms focused/checked Run checkbox items remain visible.
