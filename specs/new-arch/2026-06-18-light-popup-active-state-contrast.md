# Light Popup Active State Contrast

Date: 2026-06-18

## Report

After the Expert Squad and popup secondary-text fixes, independent review found
that active states were still under-tested on light popup surfaces. The issue
was not the unselected option path; it was active/tinted rows that put accent or
muted text on `--accent-dim`.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-18-popup-contrast-light-palette.md` | Popup readability belongs to light-theme semantic palette tokens and browser matrix coverage, not component-local color patches. |
| `2026-06-18-command-palette-activedescendant.md` | Command Palette keeps a hand-written combobox/listbox surface, so active option states need explicit visual coverage. |
| `2026-06-18-prompt-profile-trigger-select-primitive.md` | Expert Squad now participates in the shared Select primitive; this follow-up covers non-Select active popup states. |

## Impact Sweep

| Sweep | Result |
| --- | --- |
| `rg -n "accent-dim|cmdk-item--active|project-worktree-row\\[data-status=\\\"active\\\"\\]" packages/overlay/src/styles` | Worktree active state uses accent text on `--accent-dim`; Command Palette active rows keep muted child text on `--accent-dim`. |
| `rg -n "workspace-terminal-menu|workspace-editor-menu|workspace-coding-cli-menu" packages/overlay/src packages/overlay/test` | Workspace split launcher DropdownMenu surfaces were not represented in the popup contrast matrix. |

## Fix

- Adjust light-theme `--accent` and `--text-muted` so active popup text keeps
  at least 4.5:1 contrast on `--accent-dim`.
- Extend the non-Select popup browser matrix with:
  - active worktree rows;
  - active Command Palette rows including group and hint text;
  - Workspace split launcher DropdownMenu panels.
- Extend palette intent coverage to lock `--accent` and `--text-muted` against
  `--accent-dim`.

## Acceptance

- Active worktree state text is readable in the light popup matrix.
- Active Command Palette group/hint text is readable in the light popup matrix.
- Workspace launcher menu labels are covered by the light popup matrix.
- The palette test prevents future light-theme active popup token regressions.
