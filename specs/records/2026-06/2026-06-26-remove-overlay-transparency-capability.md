# 2026-06-26 Remove Overlay Transparency Capability

## Goal

Remove the overlay window/translucency capability from the product so the UI
always renders as an opaque application surface. This is not a blind
`transparent`/`opacity` string purge. Hidden-state opacity, browser/runtime
evidence logic, and SVG evidence overlays are different concerns and must stay
intact.

## Problem

The current overlay mixes two separate ideas:

1. Product-level window translucency:
   - Tauri window uses `"transparent": true`.
   - Overlay settings persist `opacity`.
   - `applyOpacity()` writes `--ui-window-opacity`.
   - Theme palettes fold `--ui-window-opacity` into `--body-bg`,
     `--rail-surface`, `--chat-canvas`, `--inspector-surface`,
     `--panel-body-bg`, and `--chrome`.
   - Titlebar View menu exposes an opacity slider.
2. Ordinary rendering semantics:
   - `opacity: 0/1` for hidden controls.
   - tokenized emphasis (`--ui-opacity-*`) for icon affordance/readability.
   - browser/webpage extraction uses DOM opacity to decide visibility.
   - visual evidence tools use SVG opacity for annotation overlays.

Only the first group is the target of this task.

## Callpoint Inventory

| Area                             | File(s)                                                                                                                                                                        | Current owner                                                                                                              | Required change                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Tauri host window                | `packages/overlay/src-tauri/tauri.conf.json`                                                                                                                                   | Window is compositor-transparent.                                                                                          | Set `transparent` to `false`.                                                        |
| Overlay settings schema/defaults | `packages/overlay/src/store/settings.ts`                                                                                                                                       | `OverlaySettings.opacity`, `sanitizeOpacity`, `MIN_WINDOW_OPACITY`, defaults, `applySettings`, `bootstrapOverlaySettings`. | Delete the setting entirely.                                                         |
| Browser local storage            | `packages/overlay/src/services/overlay-settings-storage.ts`                                                                                                                    | Reads/writes `oc_opacity`.                                                                                                 | Stop reading/writing `oc_opacity`.                                                   |
| Theme runtime service            | `packages/overlay/src/services/theme.ts`                                                                                                                                       | Exposes `sanitizeOpacity`, `MIN_WINDOW_OPACITY`, `applyOpacity()`.                                                         | Delete opacity API; keep theme + zoom only.                                          |
| App bootstrap                    | `packages/overlay/src/main.tsx`                                                                                                                                                | Applies theme, zoom, and opacity after settings hydration.                                                                 | Stop calling `applyOpacity()`.                                                       |
| Titlebar menu UI                 | `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx`                                                                                                                 | View menu renders opacity range and persists it.                                                                           | Delete opacity range and handlers.                                                   |
| i18n copy                        | `packages/overlay/src/i18n/en-US.json`, `packages/overlay/src/i18n/zh-CN.json`                                                                                                 | User-facing opacity strings.                                                                                               | Delete unused opacity copy.                                                          |
| Base cascade token               | `packages/overlay/src/styles/cascade/base.css`                                                                                                                                 | Declares `--ui-window-opacity`.                                                                                            | Delete the token.                                                                    |
| Theme palettes                   | `packages/overlay/src/styles/cascade/dark.css`, `packages/overlay/src/styles/cascade/light.css`, `packages/overlay/src/styles/cascade/vscode-dark.css`                         | Body/shell palette depends on `--ui-window-opacity` and semi-transparent mixes.                                            | Replace shell tokens with opaque values and remove `--ui-window-opacity` references. |
| Architecture/token tests         | `packages/overlay/test/window-opacity-shell-tokens.test.ts`, `packages/overlay/test/overlay-architecture-guards.test.ts`, `packages/overlay/test/theme-palette-intent.test.ts` | Assert opacity-driven translucency.                                                                                        | Rewrite to assert opaque shell tokens and no `--ui-window-opacity` capability.       |
| Browser titlebar test            | `packages/overlay/test/browser/titlebar-menubar.test.ts`                                                                                                                       | Focuses `titlebar-opacity-range`.                                                                                          | Retarget to the surviving zoom range.                                                |

## Non-goals

- Do not delete general UI opacity semantics such as hidden buttons,
  skeletons, hover affordances, disabled emphasis, or readable contrast
  tokens.
- Do not delete browser/webpage extraction visibility logic that reads DOM
  `style.opacity`.
- Do not delete SVG evidence overlay opacity in `packages/opencorvus`.

## Verification

```bash
bun test packages/overlay/test/window-opacity-shell-tokens.test.ts
bun test packages/overlay/test/theme-palette-intent.test.ts
bun test packages/overlay/test/overlay-architecture-guards.test.ts --test-name-pattern "window translucency|vscode-dark"
bun test packages/overlay/test/browser/titlebar-menubar.test.ts --test-name-pattern "view menu"
bun run --cwd packages/overlay build:vite
```

Visual check:

- Open the overlay.
- Confirm shell/background surfaces remain opaque across `light`, `dark`, and
  `vscode-dark`.
- Confirm the View menu no longer exposes an opacity slider.
