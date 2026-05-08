# Overlay Host-Scoped Theme Fix

Date: 2026-05-08

## Problem

`cascade/vscode-dark.css` was intentionally converted to pure VS Code
passthrough tokens on 2026-05-07. In a VS Code webview, `--vscode-*`
variables are injected by the host. In Tauri and browser mode, those
variables do not exist, so activating `data-theme="vscode-dark"` makes
surface tokens invalid and the overlay renders as text over a bare
background.

The broken path is not the passthrough stylesheet. The broken path is
that Tauri/browser UI still exposes and persists `vscode-dark` as a
selectable theme.

## Root Cause

- `TitlebarMenubar.tsx` hard-codes `vscode-dark` in the View theme list.
- `CommandPalette.tsx` hard-codes `vscode-dark` in command search.
- `settings.ts` and `theme.ts` accept `vscode-dark` without checking the
  current host kind.

This violates the host boundary documented in
`specs/theme-vscode-passthrough-2026-05-07.md`.

## Fix

Create a single host-scoped theme registry:

- Tauri/browser: `dark`, `light`, `system`
- VS Code webview: `light`, `vscode-dark`, `system`

All theme UI and theme sanitisation must consume this registry. Do not
add fallback color values to `vscode-dark.css`.

## Acceptance

- Tauri/browser theme controls do not render `vscode-dark`.
- Command palette does not offer `vscode-dark` outside VS Code.
- Persisted `vscode-dark` in non-VS Code settings is normalised before it
  reaches `data-theme`.
- VS Code host-theme handshake still accepts and applies `vscode-dark`.
- A browser/Tauri render with persisted `oc_theme=vscode-dark` keeps
  concrete shell backgrounds instead of invalid transparent surfaces.
