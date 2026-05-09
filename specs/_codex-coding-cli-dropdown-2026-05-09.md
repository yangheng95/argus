# Coding CLI Dropdown - 2026-05-09

## Recall

- `WorkspaceLayoutControls.tsx` owns the compact terminal profile dropdown in the workspace command dock.
- `WorkspaceTerminal.tsx` opens an in-app PTY only when the user selects a terminal profile.
- `TerminalProfile.resolve()` is the single source for configured and installed system terminal profiles.
- Coding CLIs are launchable tools (`claude`, `codex`, `gemini`, `copilot`, `glmcode`) and must not be modeled as PTY profiles.
- User correction: selecting a coding CLI must open it in the currently selected/default system terminal, not in the built-in workspace terminal.

## Target

- Add a separate compact Coding CLI dropdown beside the editor and terminal dropdowns.
- List only installed coding CLIs: Claude Code, Codex, Gemini Code, GitHub Copilot, GLM Code.
- Selecting a CLI calls a server-owned external launch endpoint with `{ cliID, terminalProfileID, cwd }`.
- The server resolves the CLI executable and the selected terminal profile, then opens the CLI in that external terminal process.
- The built-in workspace PTY remains terminal-only and never receives coding CLI profile ids.

## Acceptance

- `/coding/cli/profiles` returns only installed coding CLI profiles with `id`, `label`, and `icon`.
- `/coding/cli/open` rejects unknown CLI ids, unknown terminal profile ids, and cwd outside the project.
- Selecting a coding CLI in the workspace command dock posts the current selected/default terminal profile id to `/coding/cli/open`.
- Terminal profile dropdown still opens the in-app workspace terminal for terminal profiles.
- Targeted backend tests, overlay browser tests, i18n check, typecheck, and Vite build pass.
