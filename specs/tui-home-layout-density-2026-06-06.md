# TUI Home Layout Density - 2026-06-06

## Problem

The right-side overlay TUI renders the real shared OpenTUI home screen, but the home route still uses a desktop-terminal hero layout. In the overlay panel the fixed 9-row logo, animated background, prompt box, and shortcut footer compete for the same first viewport. The result is visually noisy: the brand banner dominates while the input surface is pushed down and reads as an overlapping block.

## Call Points

| Area                | Call point                                                              | Decision                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| TUI home route      | `packages/opencorvus/src/cli/cmd/tui/routes/home.tsx`                   | Keep the plugin slots as the single customization surface; add responsive compact density for embedded or short terminal sizes. |
| TUI logo            | `packages/opencorvus/src/cli/cmd/tui/component/logo.tsx`                | Reuse the existing logo source; expose a compact wordmark instead of introducing a second brand asset.                          |
| TUI prompt          | `packages/opencorvus/src/cli/cmd/tui/component/prompt/index.tsx`        | Keep the existing prompt component and keymap bindings; only allow Home to pass a density hint so the footer help can collapse. |
| Embedded renderer   | `packages/opencorvus/src/tui/embedded-worker.tsx`                       | Continue importing `TuiRoot`; no overlay-specific TUI fork.                                                                     |
| Overlay panel       | `packages/overlay/src/plugins/coding-agent-tui/CodingAgentTuiPanel.tsx` | Continue rendering backend OpenTUI frames from `/tui/embed/*`; do not synthesize UI.                                            |
| Overlay visual test | `packages/overlay/test/tui-host-panel-visual.test.ts`                   | Assert the embedded TUI panel keeps a readable input-first frame and does not regress into banner-dominated layout.             |
| TUI tests           | `packages/opencorvus/test/tui/embedded-renderer.test.ts`                | Add a renderer-level regression for compact home density.                                                                       |

## Implementation Decision

The single source remains the shared OpenTUI app tree. Home uses terminal dimensions to select `compact` density when the available size is close to the overlay panel. Compact density replaces the tall logo block with a one-line brand/status header and keeps the prompt centered in a bounded input lane. Full-size terminal sessions keep the existing logo and `home_logo` slot.

The prompt component gains a `density` prop so Home can collapse shortcut help into one quieter line in compact mode. This avoids overlay-only CSS or frame rewriting and keeps all interaction, paste, keymap, model, and agent behavior inside the existing prompt component.

## Verification

- `bun test packages/opencorvus/test/tui/embedded-renderer.test.ts packages/opencorvus/test/tui/plugin-runtime-guard.test.ts`
- `bun test packages/overlay/test/tui-host-panel.test.ts packages/overlay/test/tui-host-panel-visual.test.ts`
