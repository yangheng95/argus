# Titlebar Menu Order And Tools Removal

Date: 2026-06-17
Status: implementation plan

## User Request

The titlebar top-level menu currently renders `Project Provider Run Tools Settings View Help`.
The requested order is to remove the top-level `Tools` entry and move `Settings` to the right
of `View`, leaving `Project Provider Run View Settings Help`.

## Existing Evidence

- `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` owns the top-level menu IDs,
  access keys, labels, triggers, and content branches.
- `TitlebarMenubar.tsx` currently includes `tools` in `MenuID`, `MENU_IDS`,
  `MENU_ACCESS_KEYS`, the `menus()` memo, and a `menu.id === "tools"` content branch.
- `packages/overlay/test/browser/titlebar-menubar.test.ts` currently asserts that `tools`
  is present and iterates the old order.
- `packages/overlay/test/browser/prompt-profile-panel.test.ts` opens Prompt settings through
  the old `Tools` menu.
- `packages/overlay/test/titlebar-menubar-primitive.test.ts` already requires the View theme
  chooser to use Kobalte menubar radio primitives, while the source still uses handwritten
  `role="radiogroup"` / `role="radio"` buttons.

## Target

- Top-level menu IDs are exactly `workspace`, `provider`, `run`, `view`, `settings`, `help`.
- Visual order is exactly Project, Provider, Run, View, Settings, Help.
- `Tools` has no trigger, access key, i18n title key, or unreachable menu branch.
- Prompt, channel, and permissions settings remain reachable through the Settings menu because
  `CONFIG_SECTIONS` is the single source for settings panels.
- Theme choices inside View use Kobalte `Menubar.RadioGroup` and `Menubar.RadioItem` instead of
  handwritten radio primitives.

## Tests

- Update source/unit tests to assert the exact menu ID order and absence of `tools`.
- Update browser menu geometry tests to assert order and open only the remaining menus.
- Update prompt-profile browser flow to open Prompt through Settings.
- Run focused titlebar tests, overlay typecheck, and a real browser screenshot review.
