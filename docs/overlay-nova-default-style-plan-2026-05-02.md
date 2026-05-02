# Overlay Reference Default Style Plan - 2026-05-02

## Goal

Make the Overlay cold-start default read like the provided reference image:
soft light workspace, blue-purple accent, rounded translucent shell panels,
clear left recent-chat rail, central chat workspace, right workspace pane,
and a prominent composer anchored at the bottom of the main canvas.

## Constraints

- Use the existing Overlay layout and stores. Do not introduce a second UI
  implementation or a parallel theme source.
- Change the default theme at the existing settings/theme entry points only:
  `DEFAULT_THEME`, the prerender bootstrap in `index.html`, and the default
  theme regression test.
- Keep `dark`, `vscode-dark`, and `system` as supported user-selectable themes,
  and move those themes toward the same workbench shape instead of leaving them
  on the old visual language.
- Use CSS tokens and the existing final visual layer instead of duplicating
  component logic.
- Replace the old blocking startup project gateway with the existing right-pane
  workspace intro. There should be one cold-start entry point, not a modal plus
  a competing empty state.

## Implementation

1. Change Overlay cold-start default from `vscode-dark` to `light`.
2. Retune the existing `body[data-theme="light"]` token set to the reference-style
   palette: cool page background, white translucent panels, blue-purple accent,
   softer borders, and lighter shadows.
3. Update the final workbench CSS overrides for:
   - page background glow,
   - titlebar chrome,
   - sidebar/chat/inspector cards,
   - task rows,
   - chat cards and empty states,
   - composer and send controls.
4. Update `default-theme.test.ts` so future changes cannot silently restore the
   old VS Code dark default.
5. Remove `StartupWorkspaceDialog`, its dead CSS, and its unused locale keys.
6. Remove the cold-start welcome toast so the default screen opens directly
   into the workspace instead of stacking a second hero prompt above it.
7. Preserve OpenCorvus branding while updating generic shell terminology toward
   the reference workbench shape: Recent Chats, New Chat, Conversation, and
   Workspace.
8. Update `titlebar-menubar.test.ts` so first-run setup is covered by the
   workspace intro and the deleted startup dialog cannot reappear.
9. Apply the same rounded translucent workbench treatment to `dark` and
   `vscode-dark` using theme tokens, while preserving their dark color schemes.

## Validation

- Run `bun test packages/overlay/test/default-theme.test.ts`.
- Run `bun test packages/overlay/test/titlebar-menubar.test.ts`.
- Run `bun run --cwd packages/overlay check:i18n`.
- Run `bun run --cwd packages/overlay build:vite`.
- Start the Vite overlay locally and visually inspect the default light shell.
