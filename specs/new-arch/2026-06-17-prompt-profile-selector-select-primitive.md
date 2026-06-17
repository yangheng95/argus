# Prompt Profile Selector Readable Options

Date: 2026-06-17

## Bug

The chat composer Expert Squad selector can render unselected dropdown options
unreadable on a white/light popup surface.

## Evidence

Call-site inventory:

| Search | Result |
| --- | --- |
| `rg -n "prompt profile|promptProfile|prompt-profile|Expert Squad|专家团" specs packages/overlay/src packages/overlay/test -S` | The chat composer selector is implemented in `packages/overlay/src/components/ChatComposer.tsx`; the profile catalog and setting panel use the prompt profile API. |
| `rg -n "<select|<option|Select\\.Root|oc-select|field-input" packages/overlay/src packages/overlay/test -S` | `ChatComposer.tsx` is the only overlay source file with a handwritten prompt-profile `<select>` and `<option>`; mature Kobalte Select usage already exists in `AgentModelsPanel`, `LogViewer`, `AppDialogHost`, `SkillMarketPanel`, and `BrowserPreviewPanel`. |

Root cause:

- `.prompt-profile-select` is the real native select.
- The visible control chrome is a separate `.prompt-profile-select-chrome`.
- The native select is made invisible with `opacity: 0` and `color:
  transparent`.
- Native popup option rendering inherits the transparent foreground in some
  light/background combinations, so unselected options become invisible.

This is also a double-source UI implementation: visual value and actual select
state are separate surfaces. It diverges from the 2026-06-16 prompt-profile
switching spec, which requires using the same mature select/list pattern as
agent model settings.

## Fix Plan

Replace the composer prompt-profile native select with the shared Kobalte Select
primitive and `.oc-select-*` listbox styling already used by the settings and
log controls.

Required properties:

- one visible interactive Select trigger, no hidden visual chrome plus native
  popup split;
- no handwritten `<select>` or `<option>` for the prompt profile picker;
- selected profile still comes from `props.promptProfileID`;
- selection still calls `props.onPromptProfileChange(profile.id)`;
- disabled state remains tied to no profiles, disabled composer, or busy task;
- dropdown content is real DOM with tokenized background/text colors so light
  theme can be visually tested.

## Acceptance

- Unit/static test proves the chat composer prompt profile selector delegates
  listbox semantics to Kobalte Select and no longer carries the native select
  synchronization ref.
- Browser test opens the selector on a light surface and asserts all visible
  options have readable contrast against the popup background.
- Manual visual screenshot shows the open Expert Squad dropdown on white/light
  theme with unselected options readable.
