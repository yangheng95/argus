# Directory Queue Hard Gate

> Date: 2026-05-14
> Status: implementation plan

## Problem

The overlay can freeze because task creation can bypass the directory-scoped
queue. `persistQueuedTask()` writes `time_started=now` whenever `queue` is
omitted or false. That makes each new task derived `active` immediately, even
when another active task already owns the same working directory.

The live project evidence on 2026-05-14 showed 17 active tasks in the same
directory. WebView2 then receives and renders many concurrent task streams
while the embedded server also runs many orchestrator loops. When the renderer
main thread is saturated, pointer hover and cursor updates stop responding.

## Historical Conflict

`specs/new-arch/2026-05-13-task-queue-opt-in.md` explicitly required new task
creation to start immediately by default, even if another task is active in the
same directory. The corresponding test asserts that behavior.

That requirement is incompatible with the older and stronger invariant in
`engine/queue.ts`: one working directory has one active task because the tasks
share git state and filesystem state. The current production failure proves
the immediate-start requirement is unsafe. This plan replaces that requirement
instead of adding a fallback path.

## Requirements

1. A task must never become active by direct insert during creation.
2. Every newly created task must enter the same directory queue path.
3. If the directory has no active task, `dispatchTaskLoop()` must claim the new
   task and start it immediately.
4. If the directory already has an active task, the new task remains queued.
5. The task list may show a task as queued briefly after creation; that is the
   accurate state until the queue claim succeeds.
6. Existing queue reorder behavior still applies only to queued tasks.
7. No compatibility path may keep the old concurrent-start semantics.
8. An explicit operator `Start now` action is not queue reorder. It starts the
   clicked queued task immediately and must not silently degrade to "move to
   front and wait". This is a deliberate manual override, separate from task
   creation, retry, and operator-message revival.

## Implementation

1. Change `persistQueuedTask()` so it always inserts `time_started=null`.
2. Emit task-created/progress status as queued/created at insert time.
3. Keep `EngineService.createTask()` dispatching the task after persistence.
   That is the only path that may promote the task to active.
4. Update engine and gateway tests that codified the unsafe immediate-start
   behavior.
5. Add regression coverage proving `queue=false` cannot create two active tasks
   in one directory.

## Current Running Tasks

This code fix prevents new task storms. It does not mutate already active
tasks in a live database. Reducing the current 17 active tasks requires an
explicit operator decision to cancel or requeue selected tasks.

## Review Update

Independent review found another active-promotion source: operator messages
and inject can revive a terminal task through `openTaskForOperatorMessage()`.
That path must not call `updateTask(... status: "active")` directly. Revival
must set the task to queued and let `dispatchTaskLoop()` / `claimNextForCwd()`
decide whether the cwd is free. Regression coverage must include a terminal
sibling receiving an operator message while another same-cwd task is active.

## Manual Start-Now Override

Operator clicks on queued rows are a separate product gesture from automatic
task creation and task-message revival. The UI label says "Start now", so the
server contract must actually start that task if it is still queued. It must
not implement the click as queue reorder, priority bump, or any other delayed
queue operation.

The override remains narrowly scoped: only `POST /task/:taskID/start-now` may
directly claim the clicked queued task. Automatic paths continue to use the
directory queue.
