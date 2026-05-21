# Completed task conversation hydrate project binding

Date: 2026-05-21

## Problem

Completed task conversation hydrate can return `transcript: []` while the task's
session tree and messages still exist on disk. The visible symptom is that the
overlay conversation and agent rail only show the replayed integrity card.

Observed production facts:

- `/global/health` reports the packaged server database at
  `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`.
- Task `tsk_e48edf2d6001Jf6BcSZDGBo7wQ` belongs to project
  `04f89a362b690cbdeae3a4cdc95ee8348ef7008b`.
- The active request header used project
  `C:\Users\chuan\myhexin-local\opecorvus`, whose project id is
  `4b0ea68d7af9a6031a7ffda7ad66e0cb83315750`.
- Raw SQL confirms the task root has orchestrator / requirements / architect /
  build / explore / integrity descendants with persisted messages.
- `GET /task/:id/conversation` returns `transcript: 0`, `view.sessions: 0`, and
  protocol events including `integrity.review.completed`.

## Root Cause

`loadTaskTranscript(taskID)` gets the task root session, then traverses children
through `Session.children(parentID)`. `Session.children` is intentionally scoped
to the current `Instance.project`. When the selected directory is not the task's
own project directory, every child row is filtered out even though it belongs to
the task's recorded `project_id`.

Integrity still appears because it is restored from replayable protocol events,
not from the transcript message tree.

## Callpoint Inventory

- `packages/opencorvus/src/server/routes/orchestrator.ts`
  - `GET /task/:taskID/conversation` calls `loadTaskTranscript(taskID)`.
  - `GET /task/:taskID/transcript` also calls `loadTaskTranscript(taskID)`.
  - `loadTaskTranscript` calls `Session.children(id)`.
- `packages/opencorvus/src/session/index.ts`
  - `Session.children(parentID)` filters by `Instance.project.id`.
  - Existing callpoints include session removal and project-scoped session
    routes; those should remain current-project scoped.
- `packages/overlay/src/services/conversation.ts`
  - `hydrateTaskConversation` trusts the returned transcript and events.
- `packages/overlay/src/services/tree-writer.ts`
  - Transcript creates ordinary agent cards.
  - `integrity.review.completed` creates the integrity card from protocol
    replay.

## Fix Plan

1. Add a project-explicit session child reader, e.g.
   `Session.childrenInProject({ parentID, projectID })`, that filters by the
   caller-supplied project id.
2. Update `loadTaskTranscript` to traverse the task root using the task row's
   `project_id`, not the current request's `Instance.project`.
3. Keep existing `Session.children(parentID)` behavior unchanged for
   current-project session APIs and deletion.
4. Add a server route regression test: create a task in project A with a child
   agent message, call `/task/:id/conversation` while the request directory is
   project B, and assert the transcript/view still includes the project A child
   session.

## Acceptance

- Completed task hydrate restores ordinary agent transcripts even when the
  selected directory differs from the task's project directory.
- No fallback to current directory, no unscoped session tree traversal, and no
  duplicate session identity source.
- Existing project-scoped `Session.children(parentID)` semantics remain intact.
- Targeted server conversation route tests pass.
