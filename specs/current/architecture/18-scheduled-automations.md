# Scheduled Automations

## Recall

- User requirement: recurring automations must support at least exact-conversation and user-global scope, must be deletable, and must not create a new conversation when exact-conversation scope was requested.
- Acceptance: one explicit target contract across service, tool, HTTP API, generated SDK, and Overlay; one global poller; visible run history and deletion; exact Session reuse for conversation scope.
- Constraints: no compatibility route, no hidden target inference, no UI automation tests, and every schema transition must use the platform's exact transactional migration contract.
- Read before implementation: `specs/records/2026-08/2026-08-02-scheduled-automation-scope-rearchitecture.md`, the Codex Scheduled Tasks documentation cited there, and all repository call sites for `AutomationService` and the retired experimental routes.

## Target contract

A recurring definition owns exactly one explicit target:

```ts
type AutomationTarget =
  | { scope: "session"; sessionId: string }
  | { scope: "project"; projectIds: string[] }
  | { scope: "global" }
```

Session scope resumes the exact visible Session. Project scope creates one visible Chat per selected project for each fire. Global scope creates one visible Chat in the global inbox. The target is part of create and update input; it is never inferred from the HTTP request directory.

## Ownership and execution

Recurring definitions are global records. A process-wide scheduler poller claims due definitions without capturing the first opened project. Private delayed Session and Task wakes retain their exact project owner but share the same lease executor.

One recurrence fire has one `fire_id`. Project fan-out produces one run row per target project under that fire. Every run row records target scope, target project when applicable, visible Session, outcome, timestamps, and error. The definition lease and recurrence advance once after all target outcomes settle.

Session execution re-enters the target Session directory and passes its exact `sessionID` to `SessionWake`. Global execution allocates a normal global Chat through `GlobalConversationService` and wakes that visible Session. Execution initiated inside the already-active target project reuses that active lease; background execution acquires an independent initialized project lease.

Task-scoped named waits remain a separate Orchestrator scheduling fact, not a
recurring-automation definition and not a Host idle timer. When only a long-
duration or external event remains, the Orchestrator creates one named wait;
its exact activity wake resumes the same Task decision epoch. Automatic
Question deadline expiry is likewise a typed interaction resolution:
`question.expired` means no operator decision arrived. It is never projected as
operator rejection, Task failure, or authority to create a wait mechanically.

Private delayed wakes, named Task waits, and recurring fires share lease-safe
execution infrastructure but preserve distinct provenance. Queue may deliver
their exact events; it cannot infer completion, Retry/Replan, force majeure, or
the next scheduling action from elapsed time.

## Public surfaces

`/global/automations` is the only HTTP resource:

- `GET /global/automations`
- `POST /global/automations`
- `PATCH /global/automations/:id`
- `DELETE /global/automations/:id`
- `POST /global/automations/:id/run`
- `GET /global/automations/:id/runs`

The natural-language `schedule` tool and Overlay Scheduled panel use the same service contract. Natural-language creation defaults to session scope. The Overlay exposes scope selection, visible run history, and a row-level delete control.

The Scheduled page itself is a global collection and defaults new definitions
to global scope. Project scope uses `/global/projects/discover` as its only
catalog, requires one or more explicit selections, resolves each directory to
its canonical Project ID, and never auto-selects the first Project. Catalog or
provider metadata failures do not hide global or Session definitions. When a
Project definition specifies a model, creation validates that model within
every selected Project before persisting the definition.

## Deletion

Deletion is a first-class lifecycle operation. It rejects an actively leased definition, otherwise deletes the definition and cascades target and run rows. The service and HTTP route return the deleted `{ id, name }` receipt so callers can show a factual outcome.
