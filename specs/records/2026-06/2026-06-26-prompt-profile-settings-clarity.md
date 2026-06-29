# Prompt Profile Settings Clarity

Date: 2026-06-26
Status: implementation plan

## User Report

The Settings Prompt expert-squad configuration page is confusing: the layout is
hard to read and does not make it clear how a user should configure an expert
squad.

## Recall

| Source                                                    | Constraint                                                                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                               | No fallback, no double source, inspect landed plans before edits, test code changes, and visually verify frontend work with real screenshots.             |
| `2026-06-16-prompt-profile-expert-squad-switching.md`     | Expert squads are prompt profiles compiled by one backend registry; the UI must switch one `prompt_profile.active` source, not mutate many agent prompts. |
| `2026-06-18-prompt-profile-extension-import-consensus.md` | The settings editor shows and edits only expert-squad overlay prompts under `config.prompt_profile.profiles`.                                             |
| `2026-06-18-prompt-profile-list-current-aria.md`          | Profile list rows expose `aria-current`, not listbox/toggle semantics.                                                                                    |
| `2026-06-18-prompt-profile-list-row-primitive.md`         | Profile rows use `SettingsRow as="button"` and `.s-row` chrome.                                                                                           |
| `2026-06-20-settings-textarea-primitive.md`               | Long prompt-profile editors use `AutoGrowTextarea` and `.composer-textarea`.                                                                              |
| `2026-06-22-prompt-profile-task-session-owner.md`         | Settings and composer share `prompt-profile-scope.ts`; selected-task pending scope must not fall back to project catalog.                                 |
| `2026-06-24-orchestrator-expert-squad-skill.md`           | Expert-squad selection is explicit and writes only `prompt_profile.active`; no keyword gate, hidden injection, or workflow branch.                        |

## Callpoint Inventory

| Surface                      | Evidence                                                                                                                                                   | Decision                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Settings tab mount           | `packages/overlay/src/components/ConfigDialogHost.tsx` renders `<PromptCatalog />` for `data-config-panel="prompt"`.                                       | Keep the existing tab and route; this is a surface refactor only.                                                |
| Prompt profile data load     | `PromptCatalog.tsx` calls `promptProfileCatalogScope()` and `loadPromptProfileCatalog(scope)`.                                                             | Do not change the scope/data path.                                                                               |
| Project activation           | `setProjectPromptProfileActive(profile.id)` writes through existing config helpers.                                                                        | Keep one write path.                                                                                             |
| Session activation           | `setSessionPromptProfileActive(sessionID, profile.id, directory)` writes session overlay only.                                                             | Keep one write path and visible session scope.                                                                   |
| Profile creation/import/save | `savePromptProfile`, `deletePromptProfile`, and `importPromptProfiles` write only `prompt_profile`.                                                        | Preserve contract; tests must continue rejecting `agent`/`prompt` writes.                                        |
| Visual layout                | `settings.css` owns `.prompt-profile-*` selectors from the current split list/detail layout.                                                               | Replace confusing chrome with a clearer command-summary-detail layout using existing settings primitives.        |
| i18n                         | `en-US.json` and `zh-CN.json` own all user-visible prompt-profile copy.                                                                                    | Add explicit configuration-step labels in both locales.                                                          |
| Browser coverage             | `packages/overlay/test/browser/prompt-profile-panel.test.ts` opens the real settings dialog, exercises built-in/custom/import/save, and saves screenshots. | Extend this test to assert the layout communicates scope, actions, summary, and editable/readonly target states. |
| Static coverage              | `prompt-catalog-save.test.ts` and `settings-primitives.test.ts` guard single-source and primitive usage.                                                   | Extend only targeted assertions if new selectors/labels need protection.                                         |

## Root Cause

The current panel exposes every concept at once:

- profile selection is a vertical list whose rows already carry active badges;
- activation buttons live in the right detail header, away from the active badges;
- built-in read-only profiles render large target preview blocks, so the first
  screen looks like a wall of prompt text instead of a configuration flow;
- custom profile fields and target editors start immediately after the detail
  header, with no compact explanation of what is editable and what will be
  persisted;
- project scope and selected-session scope are described as paragraphs, not as
  an operator-visible state.

This is an information-architecture defect. Adding more helper text without
changing layout would keep the same unclear action path.

## Design

1. Add a compact top summary strip inside the Prompt Profiles group:
   - project active profile;
   - selected session active profile when present;
   - current catalog scope;
   - selected profile type and target count.
2. Keep the profile list on the left, but make it a dense selector with badges
   and concise copy.
3. Turn the right side into a clear task flow:
   - selected profile header with type badges;
   - primary activation actions immediately under the header;
   - editable metadata section only when the profile is custom;
   - read-only built-in guidance when the profile is built-in;
   - target overlay list with explicit editable/read-only state per target.
4. Add per-target count labels so a user can see whether a profile has overlays
   before reading long text.
5. Keep built-in previews visible, but make them inspection panels rather than
   card-like editor blocks.
6. Keep custom target textareas as the only editable prompt body controls.
7. Do not change API routes, data loading, save helpers, or prompt composition.

## Tests

- Update `packages/overlay/test/browser/prompt-profile-panel.test.ts` to assert:
  - summary strip exists and reports project active/current selection;
  - built-in profile renders no editors and shows read-only target state;
  - custom profile renders editable metadata and exactly editable target
    textareas;
  - action buttons are visible in the detail action block;
  - save and import still patch only `prompt_profile`.
- Save new screenshots for built-in summary and custom editable states.
- Run focused static tests:
  - `bun test packages/overlay/test/prompt-catalog-save.test.ts packages/overlay/test/prompt-profile-config.test.ts`
  - `bun test packages/overlay/test/settings-primitives.test.ts`
- Run the browser test with the Node runner:
  - `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/prompt-profile-panel.test.ts`
- Run `bun run --cwd packages/overlay build:vite`.
- Inspect generated screenshots manually before closing the task.

## Acceptance

- The Prompt Profiles settings page shows one clear configuration path:
  choose profile -> activate for project/session -> duplicate/create if custom
  editing is needed -> edit target overlays -> save.
- Built-in profiles are visibly read-only without looking like disabled
  broken forms.
- Custom profiles make editable fields and target textareas obvious.
- Project/session scope and active profiles are visible before the user reads
  target prompt text.
- No fallback, second prompt source, local profile state source, route bypass,
  or per-agent prompt mutation is introduced.
- Existing prompt-profile import and save paths still write only
  `config.prompt_profile`.
- Browser screenshot review confirms the page is legible in the real settings
  dialog.
