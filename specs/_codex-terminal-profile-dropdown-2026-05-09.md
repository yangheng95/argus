# Terminal Profile Dropdown - 2026-05-09

## Recall

- `WorkspaceLayoutControls.tsx` currently renders a single terminal icon button that only opens the workspace terminal panel.
- `WorkspaceTerminal.tsx` already creates PTY sessions through `createTerminal({ profileID })` and lets users change profile inside the terminal panel.
- `/pty/profiles` currently reads `TerminalProfile.list()`, which lists configured profiles only; the default project bootstrap creates one `default` profile from the system shell.
- The workspace command dock is the correct owner surface for terminal launch controls, next to the IDE dropdown.

## Target

- Replace the single terminal button with a compact terminal profile dropdown.
- The dropdown lists terminal profiles reported by the server, including detected installed system terminal shells.
- The trigger icon reflects the server default terminal profile, not a generic unrelated icon.
- Selecting a profile opens the workspace terminal and starts a PTY session with that profile.
- Keep profile resolution single-sourced: the same terminal registry must power both `/pty/profiles` and PTY creation.

## Acceptance

- `/pty/profiles` returns profile items with stable `id`, `label`, and `icon`.
- PTY creation accepts every profile returned by `/pty/profiles`.
- The workspace command dock contains a terminal dropdown, not the old direct terminal button.
- Selecting a dropdown item creates a terminal session with the selected `profileID`.
- The existing in-panel profile picker still works.
- Targeted terminal/profile tests, i18n check, and Vite build pass.
