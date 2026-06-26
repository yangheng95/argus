# 2026-06-26 Workspace Command Dock Windows Terminal Launch Root Repair

## Problem

The workspace command dock can show enabled editor, Coding CLI, and terminal
launchers while Windows terminal and Coding CLI actions do not produce a usable
interactive window. The terminal profile icons are also visually ambiguous:
PowerShell, Command Prompt, and Bash all resolve to the same `Terminal` lucide
glyph and differ only by color.

## Recall

| Source | Constraint |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, inspect disk plans before edits, add tests, and do not restart the user's live overlay process. |
| `2026-06-18-coding-cli-icon-token-source.md` | Coding CLI product glyphs live in `Icon.tsx`; visible CLI brand color is owned by CSS tokens. |
| `2026-06-26-coding-assistant-directory-status-contract.md` | Workspace/coding assistant calls must keep explicit directory scope instead of relying on frontend fallback. |
| `packages/opencorvus/test/system-terminal/external-launch.test.ts` | Current tests only assert command construction. They pinned the broken direct Windows shell spawn shape. |
| `packages/overlay/test/browser/workspace-terminal-open.test.ts` | Overlay browser tests assert button clicks submit the correct API payload; they do not prove the OS terminal has interactive stdio. |

## Call Point Inventory

| Surface | Evidence | Repair |
| --- | --- | --- |
| `packages/overlay/src/components/TaskDirBar.tsx` | The dock mounts editor, Coding CLI, then terminal launchers. | Keep the source order; the VS Code icon is the editor launcher, not the Coding CLI launcher. |
| `packages/overlay/src/components/WorkspaceCodingCliLaunchers.tsx` | Lists `coding/cli/profiles`, reloads terminal profile selection, then posts `coding/cli/open`. | Keep the existing API flow; root issue is downstream terminal launch. |
| `packages/overlay/src/components/WorkspaceLayoutControls.tsx` | Maps terminal profile icons to `terminal-*` icon names. | Keep this single map, but give those icon names distinct glyphs. |
| `packages/overlay/src/components/Icon.tsx` | `terminal-powershell`, `terminal-command-prompt`, and `terminal-bash` all use lucide `Terminal`. | Move profile-specific terminal glyphs into the existing icon primitive. |
| `packages/opencorvus/src/server/routes/coding.ts` | `/coding/cli/open` delegates to `CodingCli.open`. | Keep. |
| `packages/opencorvus/src/coding-cli/index.ts` | Resolves Coding CLI binary and delegates to `SystemTerminal.openCommand`. | Keep. |
| `packages/opencorvus/src/server/routes/terminal.ts` | `/terminal/open` delegates to `SystemTerminal.open`. | Keep. |
| `packages/opencorvus/src/system-terminal/index.ts` | Windows `buildCommand` currently returns `powershell.exe`/`cmd.exe` directly and `launchDetached` starts it with ignored stdio. | Use the Windows console launcher (`cmd.exe start`) as the single Windows launch path so the target shell/CLI owns a real console. |
| `packages/opencorvus/test/coding-cli/external-launch.test.ts` | Pins command prompt CLI open shape. | Update to the Windows launcher contract. |
| `packages/opencorvus/test/system-terminal/external-launch.test.ts` | Pins direct spawn and explicitly rejects `start`. | Replace with assertions that require `start`, cwd binding, safe quoting, and profile-specific command payloads. |
| `packages/overlay/test/editor-brand-icons.test.ts` | Guards Coding CLI icon token source. | Extend with terminal profile glyph distinction without altering Coding CLI brand glyph rules. |

## Acceptance

- Windows terminal open and Coding CLI open both build a `cmd.exe /d /s /c start ...`
  command line that binds the requested `cwd` through `/D`.
- Windows Coding CLI open still launches the selected terminal profile and keeps
  it open after the CLI command.
- Windows PowerShell profile receives a PowerShell command, not cmd quoting.
- PowerShell, Command Prompt, and Bash terminal profile icons have distinct SVG
  definitions through `Icon.tsx`.
- Existing overlay browser click tests continue to pass; no live OpenCorvus or
  overlay process is restarted.
