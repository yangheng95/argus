# Composer Draft Task/Mission Scope

## Problem

`ChatComposer` owns draft text in a component-local signal. That preserves text only while the component instance survives. It is not bound to the selected task or Mission session, so switching task/mission contexts can leak, lose, or overwrite the operator's in-progress text.

## Grep Coverage

| Surface                             | File                                               | Decision                                                                                                                     |
| ----------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Shared composer implementation      | `packages/overlay/src/components/ChatComposer.tsx` | Add a `draftKey` prop and route text reads/writes through one composer-draft service when present.                           |
| Panel composer mount                | `packages/overlay/src/main.tsx`                    | Bind draft key to `task:<taskID>` when a task is selected; bind new-task draft to active directory when no task is selected. |
| Mission session composer            | `packages/overlay/src/components/Mission.tsx`      | Bind draft key to `mission:session:<sessionID>`.                                                                             |
| Mission launcher composer           | `packages/overlay/src/components/Mission.tsx`      | Bind draft key to active mission-launcher scope for the project directory; clear it on discard or successful wake.           |
| Existing task-list performance test | `packages/overlay/test/task-list-perf.test.ts`     | Extend browser coverage from "component stayed mounted" to task/mission scoped draft restoration.                            |

## Design

Create `services/composer-draft.ts` as the only draft store for composer text:

- Reactive in-memory store for same-session task/mission switches.
- `localStorage` persistence under one key so overlay refresh restores text.
- LRU trimming to keep stale task/mission drafts bounded.
- Empty text deletes the scoped draft, so backspacing to empty is saved as empty.

`ChatComposer` remains generic: it only receives a key, reads the current text for that key, writes on input, and clears the key after a successful submit. The caller owns scope naming because only the caller knows whether the current surface is a task, mission session, or mission launcher.

## Validation

- Unit-test pure draft record operations.
- Source-test that all three composer mounts pass explicit `draftKey`.
- Browser-test that task and Mission drafts are restored by scope instead of merely surviving because the same component instance stayed mounted.
