# Mission / Assistant shared composer panel

Date: 2026-06-12

## Problem

Mission start still renders an inline launcher shell inside the left activity panel. That violates the current panel model: the left side is a ledger/activity selector, while conversation and input belong to the shared center Workflow panel and the single `#solidChatComposer` mount. Coding Assistant already follows the shared center Workflow path after a session is selected; tests should pin that contract.

## Grep Evidence

| Surface                            | Evidence                                                                                                          | Decision                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/index.html`                   | `#leftPanelMissions`, `#leftPanelAssistant`, `#centerWorkbenchWorkflow`, `#solidChatComposer`                     | Keep static shell as the single panel area and composer mount.                                            |
| `src/main.tsx`                     | `CodingAssistantSessionList`, `<Mission`, `<ChatComposer`, `panelMessage`, `activeSessionID()`                    | Route Mission launch from main composer; keep Coding Assistant session submission through `panelMessage`. |
| `src/components/Mission.tsx`       | `MissionComposer`, inline `<ChatComposer`, `wakeMission`                                                          | Delete inline launcher and expose `onCreateMission` to the panel owner.                                   |
| `src/services/coding-assistant.ts` | `selectedSource: { kind: "session" }`, `startSSE(source)`                                                         | Keep Assistant as a shared session source; no dedicated Assistant panel.                                  |
| `src/services/mission.ts`          | `wakeMission`                                                                                                     | Reuse endpoint from main composer submit path.                                                            |
| tests                              | `mission-session-source`, `mission-launcher-component`, `composer-textarea-unification`, `coding-assistant-panel` | Update string-contract tests to reject inline Mission composer and require main composer binding.         |

## Implementation

1. Lift Mission launch into `main.tsx`:
   - clicking Mission New opens the shared Workflow panel;
   - deselects task/session content with existing `selectTask("")`;
   - marks the main composer as Mission launch scoped;
   - submits via `wakeMission`, then opens the returned Mission session in the shared conversation surface.
2. Remove `MissionComposer` and launcher-specific CSS from `Mission.tsx` / `mission.css`.
3. Make `ChatComposer` clear the draft key captured at submit time so parent context switches cannot clear the wrong draft.
4. Add/update tests so Mission and Assistant both reuse `#solidChatComposer` and the center Workflow panel.

## Verification

Run focused overlay tests for Mission / Assistant composer contracts and typecheck. For visual validation, open the overlay in the in-app browser or Playwright target after the build/dev server is available.
