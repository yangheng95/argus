# Terminal Profile Host Drift Repair

Date: 2026-06-23

## Problem

The workspace launcher shows VS Code, Coding CLI, and system terminal split buttons. VS Code opens through the host native `workspace.openProjectEditor` command. Coding CLI and terminal both depend on the server-owned terminal profile registry.

The reported failure is that Claude Code and CLI do not open anything. Local evidence shows `.opencorvus/opencorvus.jsonc` has a single generated Linux terminal profile:

```json
{
  "terminal": {
    "default_profile_id": "bash",
    "profiles": {
      "bash": {
        "label": "Bash",
        "command": "/bin/bash",
        "args": [],
        "env": {
          "TERM": "xterm-256color",
          "COLORTERM": "truecolor"
        },
        "icon": "bash"
      }
    }
  }
}
```

On the Windows host, `/bin/bash` is not a resolvable terminal command. `TerminalProfile.registry()` therefore fails, `WorkspaceLayoutControls` clears terminal selection, and `WorkspaceCodingCliLaunchers` disables its primary Claude Code/Codex action because `currentTerminalProfileID()` is empty. VS Code still works because it does not use terminal profiles.

This is generated-profile host drift, not an invitation to add a fallback shell. The repair must replace only OpenCorvus-generated terminal profiles that no longer match the current host, and must keep explicit user terminal profiles fail-loud.

## Recall

| Source                                                    | Constraint carried forward                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                               | No fallback, no double source, recall plans before edits, test every code change, visual QA for overlay UI work.                         |
| `2026-06-10-tui-removal-plan.md`                          | Preserve `/terminal/profiles`, `/terminal/open`, `/coding/cli/profiles`, and `/coding/cli/open`; do not reintroduce TUI or PTY behavior. |
| `2026-06-22-task-switch-stable-request-keys.md`           | `WorkspaceLayoutControls` and `WorkspaceCodingCliLaunchers` share terminal profile ownership and coalesce same-directory reloads.        |
| `2026-06-18-workspace-split-launcher-button-primitive.md` | The visible launcher buttons are owned by `WorkspaceSplitLauncher` and the shared `Button` primitive.                                    |
| `.opencorvus/opencorvus.jsonc`                            | Current local terminal profile is generated-looking Linux Bash and invalid on this Windows host.                                         |

## Call Point Inventory

| Surface                                              | Evidence                                                                                                                               | Decision                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `WorkspaceLayoutControls.tsx`                        | Calls `reloadTerminalProfileSelection()` and disables the terminal button when `terminalProfiles().length === 0`.                      | Leave UI ownership unchanged; fix the terminal registry source.                                               |
| `WorkspaceCodingCliLaunchers.tsx`                    | Calls `listCodingCliProfiles()` and `reloadTerminalProfileSelection()`; disables Coding CLI launch when `!currentTerminalProfileID()`. | Leave the dependency on terminal profile intact because Coding CLI must open in the selected system terminal. |
| `terminal-selection.ts`                              | Coalesces same-directory profile reloads and surfaces the same failure to both launchers.                                              | Preserve coalescing; no cache or alternate profile source.                                                    |
| `services/terminal.ts`                               | Uses `/terminal/profiles` and `/terminal/open`.                                                                                        | Preserve route surface.                                                                                       |
| `services/coding-cli.ts`                             | Uses `/coding/cli/profiles` and `/coding/cli/open`.                                                                                    | Preserve route surface.                                                                                       |
| `routes/terminal.ts`                                 | `TerminalProfile.list()` and `SystemTerminal.open()` map config errors to 400.                                                         | Preserve fail-loud behavior for explicit invalid profiles.                                                    |
| `routes/coding.ts`                                   | `CodingCli.open()` maps `SystemTerminal.ConfigError` to 400.                                                                           | Preserve fail-loud behavior.                                                                                  |
| `TerminalProfile.ensureProjectDefaultProfile()`      | Currently writes defaults only when terminal config is missing or an old `default` single profile is present.                          | Extend this one source to detect generated host drift and rewrite generated profiles for the current host.    |
| `TerminalProfile.setupDefaultProfile()`              | Current single source for generating host terminal profiles.                                                                           | Reuse this; do not hand-write a second profile generator.                                                     |
| `SystemTerminal.openCommand()`                       | Validates cwd and terminal profile before launching Coding CLI.                                                                        | Leave launch semantics unchanged.                                                                             |
| `transport-protocol.routeRequiresProjectDirectory()` | `/terminal/*` and `/coding/cli/*` are project-scoped by default.                                                                       | No routing change.                                                                                            |

## Root Cause

Generated terminal profiles are persisted in project config, but the generated profile shape can be host-specific. A project that carries a generated Linux Bash profile into the Windows host keeps a stale generated config. The current `ensureProjectDefaultProfile()` only replaces missing terminal config or an older single `default` profile. It does not recognize the newer generated Bash profile as replaceable, so every profile list/open request fails before either terminal button can launch.

Follow-up evidence after the first repair: Windows can resolve a `bash.exe`, so the generator wrote a valid generated `bash` profile alongside `powershell`/`pwsh`/`cmd`. The running overlay had already stored `bash` as the selected terminal id when it was the old default, and `reloadTerminalProfileSelection()` preserved that id because it still existed. That made the Claude/Codex launcher keep opening Bash instead of the Windows default terminal profile.

Follow-up evidence after removing generated Windows Bash: a still-running overlay can keep stale in-memory `bash` selection even after the config no longer contains that profile. Clicking terminal/Coding CLI then sends `profileID=bash` / `terminalProfileID=bash`, and the backend correctly rejects it as unknown. The launcher must revalidate terminal profiles immediately before sending an external open request.

User correction: removing Bash from generated Windows profiles is too broad. Windows can support Git Bash, but the current host resolves plain `bash.exe` to WSL/WindowsApps while Git for Windows is discoverable through `git.exe`. Generated Windows terminal profiles must scan PowerShell, pwsh, cmd, and Git Bash as distinct current-host capabilities. Git Bash detection must prove a Git for Windows Bash path; WSL `bash.exe` must not be treated as Git Bash.

## Fix Plan

1. Add a generated-profile recognizer inside `TerminalProfile` that classifies only profiles matching OpenCorvus-generated shape: known generated id/label/icon/args/env, and command basenames from the generated definition set.
2. Replace stale generated profiles when any generated-looking profile command is not resolvable on the current host.
3. Treat generated profiles that are no longer in the current platform's generated set as drift even when their command resolves.
4. Generate Windows terminal profiles from host capabilities: `powershell`, `pwsh`, `cmd`, and `git-bash` when Git for Windows Bash is discovered.
5. Preserve explicit/custom terminal profiles and their selected default profile when they are valid; do not overwrite custom profiles whose ids collide with generated ids.
6. Keep explicit/custom invalid terminal profiles fail-loud: rewriting stale generated entries must not mask a separate invalid custom profile.
7. Keep `setupDefaultProfile()` as the only writer for replacement generated profiles.
8. Keep frontend terminal selection as an explicit override only; a default profile loaded from the server must not be copied into `selectedTerminalProfileID()`.
9. Treat incomplete generated profile sets as drift when the current host scanner discovers a supported generated profile that is missing from config.
10. Revalidate terminal profiles immediately before terminal/Coding CLI open requests. Primary buttons use the refreshed current/default profile; explicit menu selections fail loudly if that selected profile disappeared.
11. Add backend tests for generated Linux Bash drift on Windows-shaped data, unsupported WSL Bash rejection on Windows, Git Bash inclusion on Windows, generated set expansion, custom invalid profile preservation, and mixed custom/generated profile preservation.
12. Add overlay/browser coverage that terminal and Coding CLI primary buttons become enabled, revalidate stale terminal state before opening, and POST their canonical routes when profile reload succeeds.
13. Run focused tests, typecheck/build as needed, visual screenshot review, and self-review.

## Acceptance

- A generated Linux `/bin/bash` terminal config on Windows is rewritten to current-host generated terminal profiles during project bootstrap.
- A generated Windows WSL/WindowsApps `bash.exe` profile is removed from generated Windows terminal config.
- Git Bash is included in generated Windows terminal profiles when Git for Windows Bash is discovered from a known install root or the resolved `git.exe`.
- Existing generated terminal profile sets are expanded when the current host scanner discovers an additional supported profile such as Git Bash.
- Valid custom terminal profiles survive a generated-profile rewrite, including a custom default profile.
- Custom invalid terminal profiles still fail loudly and are not masked by generated-profile repair.
- Frontend terminal selection does not persist the server default as an explicit selection; if the server default changes, the launcher follows the new default unless the user explicitly selected a valid custom profile.
- Terminal and Coding CLI launchers revalidate terminal profiles immediately before opening, so stale in-memory `bash` selection cannot be sent after generated Bash is removed.
- `/terminal/profiles`, `/terminal/open`, `/coding/cli/profiles`, and `/coding/cli/open` remain the only launcher route surfaces.
- Claude Code/Codex launch still requires a concrete terminal profile; no fallback terminal is invented at click time.
- Focused backend tests, overlay tests, browser screenshot evidence, and self-review pass.
