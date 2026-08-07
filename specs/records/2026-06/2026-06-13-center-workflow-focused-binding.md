# Center Primary Panel Focused Binding

Date: 2026-06-13

## Problem

The center primary panel owns both the message pane and the shared composer for
normal tasks, Mission launch/session chat, and Coding Assistant chat. It used to
be hard-labelled as Workflow regardless of which left activity was focused.
That made clicking Mission or Chat open a center panel that still looked and
behaved like Workflow.

## Grep Evidence

| Surface                                                                         | Evidence                                                                                                                               | Decision                                                                                                                              |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx` left focus                                                       | `selectedLeftActivity`, `selectedLeftPanelActivity`, `selectLeftActivity`, `openMissionLauncher`, `activateCodingAssistantSessionList` | Keep left focused activity as the source that decides the primary center owner: Tasks -> Task, Mission -> Mission, Assistant -> Chat. |
| `src/main.tsx` center panels                                                    | `centerWorkbenchPanels`, `primaryCenterPanel`, `resetCenterWorkbenchToFocusedPanel`, `selectRightActivity`                             | Switching into Task / Mission / Chat resets optional middle panels and projects the shared primary DOM as the focused owner.          |
| `src/index.html` primary DOM                                                    | `#centerWorkbenchWorkflow`, `#chatMessagePane`, `#solidChatComposer`                                                                   | Do not add a second composer or message panel. Reuse the existing DOM while changing its projected owner/title/data.                  |
| `test/browser/side-activity-toolbar-browser.test.ts`                            | Browser test clicks left Task / Mission / Assistant activities and right toolbar panels.                                               | Assert the visible primary panel is Task / Mission / Chat respectively and optional panels are cleared on each focused switch.        |
| `test/acceptance-panel-mount.test.ts` and `test/coding-assistant-panel.test.ts` | Static tests pin side activities and shared primary panel behavior.                                                                    | Add static assertions for the focused primary-panel binding helper.                                                                   |

## Acceptance

- With Tasks focused, the primary center panel is Task.
- With Mission focused, the primary center panel is Mission.
- With Coding Assistant focused, the primary center panel is Chat.
- Switching Tasks / Mission / Coding Assistant closes Explorer, Diff, Browser,
  Inspector, Notifications, and File center panels so stale middle panels cannot
  remain beside the new focused owner.
- Explorer, diff, browser, inspector, notifications, and file panels keep their
  existing optional open/close behavior after the focused switch completes.
- No new fallback composer, hidden message panel, or parallel Assistant panel is
  introduced.
