# Task ledger wording and new-action button parity

Date: 2026-06-12

## Problem

The left task ledger still presents itself as a chat list: `Recent Chats`,
`New Chat`, `No conversations yet`, and onboarding copy that says "recent
chat". That conflicts with the product model: the left ledger owns tasks.
Assistant sessions are the place where chat wording is appropriate.

Mission and Coding Assistant creation controls also diverge from the Task
creation control. Task creation uses the shared `oc-button` solid accent
primitive through `data-ui="sidebar-new-task-button"`, while Mission hides its
label behind an icon-only ghost button and Coding Assistant carries its own
30px sizing rule.

2026-06-12 follow-up: Mission and Coding Assistant now share the visual button
contract, but their new actions still live inside each ledger's search toolbar
instead of the sidebar header. The header has only `leftPanelTaskActions`, and
runtime state hides that toolbar for every activity except Tasks. The result is
that Mission/Chat creation is not available from the header where the left
activity title lives.

## Grep Evidence

| Surface                                                          | Evidence                                                                                                                                      | Decision                                                                                                                                                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/index.html`                                | Static sidebar title/action text: `Recent Chats`, `New Chat`; guide copy says recent chat.                                                    | Change only task-ledger copy to Task wording. Keep central chat component ids/classes because they are message-surface internals.                                                                  |
| `packages/overlay/src/i18n/en-US.json` and `zh-CN.json`          | `sidebar.title`, `task.new`, `task.none` use chat/conversation words; `coding_assistant.new` is generic `New`.                                | Replace task-list keys with `task.ledger.title`, `task.ledger.new`, and `task.ledger.empty`. Replace Assistant chat creation with `coding_assistant.chat.new` / `coding_assistant.chat.new_title`. |
| `packages/overlay/src/components/MissionList.tsx`                | `data-ui="mission-new"` button is ghost/icon and hides `.mission-new-label`.                                                                  | Keep `data-ui` for tests/e2e selectors, but use the same solid accent `oc-button` shape and visible label as Task creation.                                                                        |
| `packages/overlay/src/components/CodingAssistantSessionList.tsx` | `data-ui="coding-assistant-new"` button is solid but has a local sizing rule and no `sidebar-btn-label`.                                      | Keep selector identity, align markup and style with the Task creation button.                                                                                                                      |
| `packages/overlay/src/styles/surfaces/sidebar.css`               | Only `.sidebar-header .oc-button[data-ui="sidebar-new-task-button"]` owns the new-task surface tweak.                                         | Make this the shared left-ledger new-action style for Task, Mission, and Assistant selectors.                                                                                                      |
| `packages/overlay/src/styles/surfaces/mission.css`               | Mission new button has private icon-only width and label hiding.                                                                              | Remove private button chrome; keep Mission ledger layout with auto action width.                                                                                                                   |
| `packages/overlay/src/styles/surfaces/coding-assistant.css`      | Assistant new button has private height/padding/gap.                                                                                          | Remove private button chrome and let the shared left-ledger action style apply.                                                                                                                    |
| `packages/overlay/src/main.tsx`                                  | Header state only toggles `#leftPanelTaskActions` for activity `tasks`; Mission/Assistant create handlers are buried in list component props. | Make the sidebar header actions the single create-action owner for Tasks, Mission, and Coding Assistant; wire each static button to the existing launcher/session creation functions.              |
| `packages/overlay/src/components/MissionList.tsx`                | The Mission new button is rendered beside search.                                                                                             | Remove the create button and prop from the list; search remains the only ledger toolbar control.                                                                                                   |
| `packages/overlay/src/components/CodingAssistantSessionList.tsx` | The New Chat button is rendered beside search.                                                                                                | Remove the create button and prop from the list; the header owns chat creation.                                                                                                                    |
| Tests                                                            | `mission-launcher-component.test.ts`, `sidebar-header-buttons-primitive.test.ts`, i18n tests reference these contracts.                       | Update/add focused assertions for Task wording and button-style reuse.                                                                                                                             |

## Acceptance

- The task ledger no longer shows "chat" or "conversation" wording in its
  title, empty state, or new-task action.
- Coding Assistant creation uses `New Chat` wording, because that surface owns
  assistant chat sessions.
- Task, Mission, and Coding Assistant new-action buttons share the same
  left-ledger `oc-button` visual contract without private Mission or Assistant
  sizing overrides.
- Task, Mission, and Coding Assistant new actions render in the sidebar header,
  never inside the ledger search toolbar.
- Focused overlay tests cover the wording and style contract.

## Codex Review Feedback

The first pass changed locale values but left key ownership mismatched:
`sidebar.title` still represented the task ledger, and `coding_assistant.new`
still represented a chat-creation command. That leaves semantic debt in the
i18n catalog. Revise the contract so task-list copy lives under
`task.ledger.*` and Assistant chat creation lives under
`coding_assistant.chat.*`; remove the retired keys instead of keeping aliases.
