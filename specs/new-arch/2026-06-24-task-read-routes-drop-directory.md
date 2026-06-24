# Task Read Routes Drop Directory Requirement

Date: 2026-06-24

## Problem

Task record reads are keyed by `taskID`, but the shared route policy still
classified most `GET /task/:taskID/...` reads as project-scoped. That forced API
callers to pass `directory` even though the task row already owns
`project_id`, session, and directory resolution.

## Recall

- `2026-06-12-deleted-project-task-record-routes.md` already moved task
  conversation reads and task delete out of the directory middleware.
- `2026-06-24-overlay-task-deep-link.md` relies on task selection resolving the
  directory from the backend task record, not from URL/query state.
- Write routes must remain directory-scoped. This change is not a fallback; it
  removes a duplicate ownership input from read routes.

## Call Points

| Surface | Decision |
| --- | --- |
| `packages/transport-protocol/src/index.ts` | Add explicit method-aware task record GET read bypasses. |
| `packages/opencorvus/src/server/routes/orchestrator.ts` | Remove the `Instance.project.id` dependency from `GET /task/:taskID/events`. |
| Overlay API directory injection tests | Expect task read routes not to inject `directory`; project routes and write routes still inject. |
| Server directory middleware tests | Prove task read routes work without `directory`; prove `/tasks` still rejects missing directory. |

## Acceptance

- `GET /task/:taskID`, `status`, `board`, `progress`, `events`, `brief`,
  `transcript`, `runs`, `interactions`, `bindings`, and
  `operator-model-context` do not require `directory`.
- Existing task conversation read exemptions remain.
- `GET /tasks`, `POST /task`, and task write routes still require `directory`.
- `GET /task/:taskID/events` connects without `Instance.current()`.
