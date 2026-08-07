# Testing Expert Squad Profile

Date: 2026-06-22

## Goal

Add a first-class `testing` expert squad as a built-in prompt profile. This is
an ecosystem addition to the existing prompt-profile single source, not a new
agent family, workflow, router, gate, or compatibility path.

## Recall

| Source                                                        | Relevant decision                                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-16-prompt-profile-expert-squad-switching.md`         | Expert squads are prompt profiles compiled by one backend registry. They must not create new workflows, tools, routing branches, or per-agent prompt mutations. |
| `2026-06-17-prompt-profile-selector-select-primitive.md`      | The chat composer Expert Squad selector uses the shared Kobalte Select path, not native select or local chrome.                                                 |
| `2026-06-18-expert-squad-unselected-option-contrast-guard.md` | Expert Squad readability belongs to shared Select styling and real browser coverage.                                                                            |
| `2026-06-19-expert-squad-option-visibility-guard.md`          | Strengthen real selector coverage instead of adding component-local visual patches.                                                                             |
| `2026-06-15-opencorvus-test-entry-single-source.md`           | Targeted test entrypoints are required because the full package suite contains long-running suites.                                                             |

## Impact Sweep

| Sweep                                                 | Finding                                                                                     | Decision                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `rg -n "prompt_profile                                | PromptProfile                                                                               | prompt-profile                                                                                     | promptProfile"` | Runtime, API, overlay settings, task/session profile switching, and tests already flow through `PromptProfile`. | Add `testing` only to `packages/opencorvus/src/agent/prompt-profile.ts` and tests that assert catalog/UI visibility. |
| `rg -n "Object\\.keys\\(PromptProfile\\.builtIns\\)"` | Only `packages/opencorvus/test/agent/prompt-profile.test.ts` pins built-in profile order.   | Update the single registry pressure test.                                                          |
| `GET /config/prompt-profile` route                    | Schema exposes `profiles[]` as data, not a profile-id enum.                                 | OpenAPI and SDK types do not need regeneration for a new built-in data row.                        |
| Overlay composer and settings panel                   | UI renders profiles returned by the catalog. Some browser fixtures hard-code built-in rows. | Extend the real selector/panel fixtures so the user-facing surface proves the new profile appears. |
| Prompt-profile import helpers                         | Built-in rejection is driven by catalog rows.                                               | Add `testing` to helper fixtures so imports cannot override it.                                    |

## Implementation

- Add built-in `testing` to `PromptProfile.builtIns` after `algorithm`.
- The testing profile must cover every canonical prompt-profile target:
  `coding`, `coding-assistant`, `build`, `visual-qa`, `general`, `explore`,
  `mission`, `requirements`, `architect`, `frontend-design`,
  `intent-analysis`, `fact-check`, `deep-research`, `frontend-research`,
  `goal-workload-analyst`, `orchestrator`, and `integrity`.
- Each overlay must be role-scoped, direct, and evidence-oriented. It must not
  mention workflow mechanics, dispatch, fallback, gates, state machines, tool
  inventories, or host-side routing.
- Update backend unit tests for profile order, required target coverage,
  catalog exposure, config activation, and testing prompt composition.
- Update overlay helper/browser fixtures to include the Testing row and prove
  selector and settings surfaces render it.

## Acceptance

- `PromptProfile.builtIns.testing` exists and is visible from
  `GET /config/prompt-profile`.
- `testing` can be selected through project config and session config like the
  other built-ins.
- The testing profile covers every prompt-profile target without introducing a
  second expert-squad source.
- Overlay selector and settings fixtures include Testing and keep shared Select
  readability coverage.
- No generated API type change is required unless a later schema change adds a
  profile-id enum.

## Verification Plan

- `bun test packages/opencorvus/test/agent/prompt-profile.test.ts`
- `bun test packages/opencorvus/test/server/config-routes.test.ts`
- `bun test packages/overlay/test/prompt-profile-config.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/prompt-profile-selector-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/prompt-profile-panel.test.ts`
