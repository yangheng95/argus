# Composer Model Single-Source Repair

## Recall

| Item | Evidence |
| --- | --- |
| User request | Entering a conversation must not clear the model selected in the Composer. Remove the Agent Models setting from every frontend entrypoint. Every frontend Chat, Work, and Task execution must use the model selected in the Composer at that time, while the backend retains its independent per-Agent model configuration capability. |
| Acceptance criteria | The selected Composer model remains visible when switching between New Chat, conversation Sessions, and Tasks; project and global conversation creation receive it; every standalone Session prompt receives it explicitly; every Task create/follow-up receives it; Settings, titlebar/native menus, and card actions expose no Agent Models setting; backend `agent.<id>.model` schema and resolver remain available; the real Overlay is opened and the affected UI is visually reviewed. |
| Hard constraints | Do not add, update, delete, or run UI automation tests. Verify UI only through a real isolated page and manually inspected screenshots. Add focused non-UI protocol/service coverage. Preserve unrelated worktree changes. Do not restart or mutate the user's running Overlay. Commit subjects use `dsw-33987` and delivery pushes to `legacy-remote`. |
| Sources read | Root `AGENTS.md`; the two supplied failure screenshots; `specs/current/architecture/06-provider.md`; the previous `2026-07-29-global-new-chat-model-handoff-repair.md`; Composer model selector/store; Chat, Task, and conversation Session services; Session prompt schema/route; Task message schema/handler; global conversation service; Config dialog, titlebar/native menu, and card action entrypoints. |
| Whole-repository search | `rg` enumerated every `agent-models`, `AgentModels`, `native-menu:agent-models`, `newTaskModel`, `currentOpenCorvusModel`, `createConversationSession`, `promptSessionMessage`, `prompt_async`, `TaskMessageInput`, `handleTaskMessage`, `configOverlay`, and model-reference validation callsite. The disposition table below covers every production owner; historical specs and forbidden UI tests remain historical evidence and are not edited to follow the new UI. |
| Independent Agent feedback | None. The user explicitly requested that this repair be completed without parallel work. |

## Root Cause

The visible failure is a source-ownership switch:

1. In New Chat without a directory, `ComposerModelSelector` writes the choice to
   `appStore.newTaskModel`.
2. After selecting a Task, the same component stops reading that value and
   derives its label from the Task operator Agent's Session config.
3. After entering a project context without a selected Task, it instead derives
   the label from project config.
4. Session and Task follow-up requests do not consistently carry the current
   Composer choice, so later execution can also resolve a different configured
   model.

The earlier global New Chat handoff repaired only initial global Session
creation. Its assumption that Session configuration should then become the
Composer display authority is superseded by this record.

## Single Source Contract

- `appStore.composerModel` is the sole frontend authority for the visible
  Composer selection.
- Context changes never replace or clear that value.
- Selecting a model updates only this Composer authority; the Agent Models
  Settings writer is removed from the frontend.
- Every user-triggered execution boundary sends the current Composer model.
- The backend continues to support top-level and per-Agent model configuration.
  Its resolver remains available for backend callers that do not supply an
  explicit model.
- Missing Composer selection remains an explicit disabled-send state. There is
  no fallback to project, Session, or Agent configuration.

## Production Callsite Disposition

| Owner | Disposition |
| --- | --- |
| `store/app.ts` | Replace context-specific `newTaskModel` with `composerModel`. |
| `ComposerModelSelector.tsx` | Read/write only `composerModel`; remove Task operator and project-config model ownership. Keep provider catalog and budget presentation. |
| `services/task.ts` | Make `currentOpenCorvusModel()` read only `composerModel`; include it in Task creation and follow-up request bodies. |
| `main.tsx` and `conversation-session.ts` | Pass the Composer model into both project and global Chat/Work Session creation. |
| `services/chat.ts` and selected-Session submit path | Send the Composer model as the canonical structured explicit model on every `prompt_async` call. |
| `TaskMessageInput` and `handleTaskMessage` | Accept the selected model, validate it through the existing config model-reference validator, and apply it to the Task root Session before recording/waking the follow-up. |
| Project/global conversation creation routes | Accept the model and persist it through the existing Session config overlay path before first use. |
| Config dialog, titlebar/native menus, card action | Delete every production Agent Models navigation/action entrypoint. |
| `AgentModelsPanel`, its data loader, legacy UI tests | Leave unreachable and unchanged in this task because repository policy explicitly forbids modifying UI tests; they are historical UI-test burden, not a frontend entrypoint. |
| Backend Config and Agent model resolver | Preserve unchanged so `agent.<id>.model` remains supported. |
| Expert Squad model declarations and Agent-identifying icons | Preserve; they are backend capability/package configuration, not the removed Settings item. |

## Verification

1. Add and run focused non-UI schema/service tests for explicit Session and Task
   model transport and Task root-Session persistence.
2. Run Overlay and OpenCorvus typechecks/build plus API and documentation
   integrity checks required by the changed contract.
3. Start an isolated Overlay/Vite runtime, select a model, switch into an
   existing conversation and Task context, and manually inspect screenshots
   proving the Composer label remains visible and Agent Models is absent from
   Settings/menu surfaces.
4. Re-read the diff and production callsites, verify the backend per-Agent
   schema/resolver still exists, then commit and push to `legacy-remote`.
