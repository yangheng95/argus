# Titlebar Menubar Form Focus

## Context

Independent accessibility review found that Titlebar Menubar form rows had a
hover surface but no keyboard-focus equivalent. The affected rows are native
checkboxes in the Run menu and native range controls in the Run/View menus.

## Recall

| Source | Constraint |
| --- | --- |
| `2026-06-19-dropdown-menu-highlighted-contrast-source.md` | Titlebar menu focus/highlight states must be visible, not hover-only. |
| `TitlebarMenubar.tsx` | Menubar semantics are already owned by Kobalte; form controls are deliberate native controls inside the menu. |
| `owner-surface-consistency.test.ts` | Titlebar row hover/focus colors are guarded against palette drift. |
| `titlebar-menubar.test.ts` | Browser coverage already opens Run/View menus and screenshots titlebar menu regions. |

## Evidence

| File | Finding | Decision |
| --- | --- | --- |
| `titlebar.css` | `.titlebar-menubar-toggle:hover` and `.titlebar-menubar-range:hover` get `--surface-hover`, but `:focus-within` is missing. | Add `:focus-within` to the same visual rule. |
| `TitlebarMenubar.tsx` | Run menu has checkbox controls; View menu has opacity/zoom range controls. | Do not replace native controls; improve the shared row state. |
| `owner-surface-consistency.test.ts` | Static guard currently locks the hover-only selector. | Update it to require focus-within. |

## Implementation

- Extend the existing titlebar menu row rule with
  `.titlebar-menubar-toggle:focus-within` and
  `.titlebar-menubar-range:focus-within`.
- Add browser evidence for one checkbox row and one range row.

## Acceptance

- Keyboard focus on Run menu checkbox rows receives the same surface promotion
  as hover.
- Keyboard focus on View menu range rows receives the same surface promotion as
  hover.
- Browser screenshots are saved for both focused form row states.
