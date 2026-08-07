# Left Activity Workflow Source Binding

Date: 2026-06-11

## Root Cause

The center Workflow panel is shared by normal task conversations and the
independent Coding Assistant session. The left activity toolbar only changed
the left sidebar body for Tasks / Skills / MCP / Memory. It did not clear the
Coding Assistant session source from `boardStore.selectedSource`, so the center
Workflow kept rendering the Assistant conversation after the operator switched
to another function.

There is also an async lag path: clicking Coding Assistant starts an async
session resolve/hydrate. If the operator switches back to another left activity
before that request finishes, the late assistant activation can still write the
session into the shared Workflow panel.

Skills and MCP had a second source split: settings rendered the default
`SkillsPanel` / `McpPanel`, while the left rail passed an explicit
`directory={activeDirectory}` into compact instances. That made the left rail
depend on a different hydration path from settings even though both surfaces
represent the same project-scoped extension data. The left compact panels must
reuse the component's internal `syncActiveDirectoryApiContext()` path; only
Memory keeps an explicit directory because its requests are task-scoped.

## Call Points

| Surface                     | Evidence                                                                                                                        | Decision                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Left activity selection     | `rg "selectLeftActivity                                                                                                         | activateCodingAssistantSession" packages/overlay/src/main.tsx` shows this is the single toolbar selection entry.                | Keep left activity ownership here. Non-assistant activities cancel pending assistant activation and clear assistant session state through `selectTask("")`. |
| Coding Assistant activation | `packages/overlay/src/main.tsx::activateCodingAssistantSession` calls `selectCodingAssistantSession`.                           | Pass an `AbortSignal` so stale activations cannot write the shared Workflow after the user switches away.                       |
| Coding Assistant service    | `packages/overlay/src/services/coding-assistant.ts::selectCodingAssistantSession` owns session resolve, hydrate, and SSE start. | Thread the signal through list/create/hydrate and check it before mutating `boardStore.selectedSource` and before starting SSE. |
| Task selection clear path   | `packages/overlay/src/services/task.ts::selectTask("")` already clears selected session sources after the Mission fix.          | Reuse it; no second clear implementation.                                                                                       |
| Left Skills/MCP mount       | `rg "SkillsPanel active                                                                                                         | McpPanel active" packages/overlay/src/main.tsx` shows the left rail mounts compact extension panels.                            | Do not pass `directory={activeDirectory}` to Skills/MCP; use the same internal project directory path as settings.                                          |
| Browser side-activity flow  | `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` already covers left toolbar + shared Workflow.            | Extend it to assert Tasks clears Assistant-selected source and title.                                                           |

## Acceptance

- Entering Coding Assistant binds Workflow to the assistant session.
- Entering Tasks / Skills / MCP / Memory from Coding Assistant clears the
  assistant session source and restores the Workflow title/content owner.
- A late Coding Assistant session resolve/hydrate cannot overwrite the center
  panel after the operator switched to another left activity.
- Left Skills and MCP render the same project-scoped extension data as settings
  without a second directory prop path.
