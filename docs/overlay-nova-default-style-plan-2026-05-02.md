# Overlay Nova Default Style Plan - 2026-05-02

## Goal

Make the Overlay cold-start default read like the provided Nova AI reference:
soft light workspace, blue-purple accent, rounded translucent shell panels,
clear left task rail, central chat workspace, right inspector/workspace pane,
and a prominent composer anchored at the bottom of the main canvas.

## Constraints

- Use the existing Overlay layout and stores. Do not introduce a second UI
  implementation or a parallel theme source.
- Change the default theme at the existing settings/theme entry points only:
  `DEFAULT_THEME`, the prerender bootstrap in `index.html`, and the default
  theme regression test.
- Keep `dark`, `vscode-dark`, and `system` as supported user-selectable themes.
- Use CSS tokens and the existing final visual layer instead of duplicating
  component logic.

## Implementation

1. Change Overlay cold-start default from `vscode-dark` to `light`.
2. Retune the existing `body[data-theme="light"]` token set to the Nova-style
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

## Validation

- Run `bun test packages/overlay/test/default-theme.test.ts`.
- Run `bun run --cwd packages/overlay build:vite`.
- Start the Vite overlay locally and visually inspect the default light shell.
