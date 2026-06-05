# Mission workbench task parity fix - 2026-06-05

## Trigger

User review of Mission mode found that Mission does not match the default
Task/Panel workbench except for the right Channels column:

- Mission cannot open or switch the project directory from its own page.
- The conversation header is missing compared with the Task panel.
- User and Mission messages are not visually distinct enough.
- The Mission ledger header uses unclear icon-only creation and the label
  says "Start mission" instead of the expected "New Mission".
- The launcher exposes a primary "Mission ID" field whose meaning is unclear.
- The controls near the composer are not explained by the Mission surface.

## Callsite Grep Summary

| Surface | Current owner | Evidence | Decision |
| --- | --- | --- | --- |
| CWD control | `index.html` static DOM plus `main.tsx` event handlers for `#taskCwdDropdown`, `#taskDir`, `#recentDirPanel` | `rg "taskCwdDropdown|recentDirPanel|TaskDirContent"` shows all behavior tied to the Panel-only IDs. | Move CWD dropdown behavior into `TaskDirBar.tsx` as the single reusable Solid owner. Panel and Mission mount the same component. |
| Mission workbench | `Mission.tsx` `MissionWorkbench`, `MissionConversation`, `MissionComposer` | `rg "MissionWorkbench|MissionConversation|MissionComposer"` shows a custom middle shell. | Keep Mission-specific data flow, but reuse the task chrome pieces directly where possible. |
| Task header | `index.html` `.chat-header` plus `TaskStatusHeader` mount in `main.tsx` | `rg "chat-header|TaskStatusHeader"` shows only Panel has the header/status/usage track. | Add Mission header chrome in the Mission workbench now; deeper status semantics remain session-owned. |
| Agent rail/workspace | `ConversationAgentRail` and `WorkspacePanel` mounted only in Panel DOM | `rg "ConversationAgentRail|WorkspacePanel"` shows no Mission mount. | Existing gap remains a larger shell refactor; do not fake it with a second rail or workspace. |
| Composer | `ChatComposer` shared, but `MissionComposer` wraps a visible Mission ID control | `rg "mission.launcher.mission_id"` shows only launcher UI/tests/i18n. | Remove the primary Mission ID field. Resuming is done by selecting an existing Mission row and sending a follow-up. |
| Mission ledger copy/actions | `MissionList.tsx` | `rg "mission.new_requirement|mission-row"` shows icon-only create and compact row icons. | Use explicit "New Mission" copy and a visible text button. Keep row actions but reduce visual ambiguity with existing tooltips/tests. |
| Role distinction | `utils/message.ts`, `chat-bubble.css`, `chat-bubble-role-distinction.test.ts` | `rg "role.*mission|data-role=\"mission\""` shows Mission is normalized but styled weakly. | Strengthen Mission bubble styling and test the stronger selector contract. |

## Root Cause

Mission mode is a sibling page that hides `main.panel`. The mature Task/Panel
chrome lives inside that hidden panel as static mount points plus imperative
ID-based event handlers. Mission then rebuilt its own workbench shell, so the
Task cwd/header/workspace/rail improvements never reached Mission.

## Implementation Slice

1. Extract the CWD dropdown behavior into `TaskDirBar.tsx`:
   - no duplicate DOM IDs;
   - no second directory source;
   - reuse `activeDirectory`, `browseDirectory`, `createDirectory`,
     `setDirectory`, `openDirectory`, and recent-directory helpers;
   - render the recent-directory popup from the component.
2. Replace the Panel `solidTaskDirMount` usage with the new shared component
   and delete the obsolete `main.tsx` directory event block.
3. Mount the same shared project cluster at the top of Mission mode so the
   Mission page can open/switch/create directories.
4. Remove the launcher Mission ID field from the primary UI and from tests/i18n
   requirements. New Mission always creates from the launcher; existing Mission
   continuation happens by selecting a Mission row.
5. Change creation copy to "New Mission" / "新建 Mission" and make the button
   visibly labelled.
6. Strengthen Mission bubble styling and tests so Mission is not visually
   collapsed into user/assistant messages.

## Out Of Scope For This Slice

The full replacement of `MissionWorkbench` with the exact Panel middle shell,
including `ConversationAgentRail` and `WorkspacePanel`, is still required for
complete parity. This slice does not add fake rail/workspace placeholders and
does not add a parallel workspace implementation.

## Verification

- Targeted source/component tests for Mission launcher/list/i18n/role styling.
- Existing CWD layout tests updated to assert the shared component mount and
  absence of Panel-only directory event handlers.
- Browser or Playwright visual pass after the dev server is running, focused on
  Mission mode with the CWD bar, labelled New Mission button, and Mission
  conversation header.
