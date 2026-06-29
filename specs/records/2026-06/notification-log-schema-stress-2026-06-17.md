# Notification And Log Schema Stress Benchmark - 2026-06-17

## Objective

Pressure-test and harden OpenCorvus notification and log schemas until notification, log, protocol, and overlay error visibility behave as one enterprise-grade system.

## Non-Negotiable Requirements

- No fallback or compatibility branch may hide invalid notification/log data.
- Notification metadata has one source: `BusEvent.define(..., notify)` and `BusEvent.resolveNotify(...)`.
- Task and session protocol projections must derive `notify` from that registry, not from route-local predicates.
- Task-list protocol notifications must include semantic, copyable `notificationDetails`.
- Overlay notification rendering has one primitive: `showNotification(...)` and its typed helpers.
- All overlay dispatch/runtime/native notification failures that are operator-actionable must produce detailed semantic in-app notifications, not only `console.warn` or `console.error`.
- Server log storage and reading has one source: `Log.directory()`, `Log.files()`, `Log.read()`, and `Log.create()`.
- Schema failures and event/log write failures must be loud and diagnosable; no silent overwrite, silent drop, or empty-success behavior.

## Recall And Call-Point Inventory

Commands already run before implementation:

```powershell
rg -n "notification|notify|通知|log|event-log|eventLog|runtime log|logger|silent|静默" specs packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test
rg -n "showNotification|notify(Error|Warning|Success|Progress)|routeNotification|notificationStore|centerHistory|visibleNotificationItems|NotificationCenter" packages/overlay/src packages/overlay/test
rg -n "class Log|namespace Log|Log\.|/log|log/tail|Log\.read|Log\.files|EngineEventLog|event-log|eventLogPath|Bus\.publish|ServerEvent|sse" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test
rg -n "notify\s*:|notificationDetails|task\.failed|task\.completed|evaluation\.completed|interaction\.requested|BusEvent|payloads\(|engine\.task|engine\.evaluation|TaskEvent|publishTask|emitTask|Event\." packages/opencorvus/src packages/opencorvus/test -g "*.ts"
rg -n "BusEvent\.define\(" packages/opencorvus/src -g "*.ts"
rg -n "console\.(warn|error)|AppLog\.(warn|error)|notifyError\(|notifyWarning\(|showNotification\(|routeNotification\(" packages/overlay/src -g "*.ts" -g "*.tsx"
```

Relevant existing plans:

- `specs/records/2026-06/notification-center-history-contract-2026-06-09.md`
- `specs/records/2026-06/overlay-runtime-notification-message-2026-06-05.md`
- `specs/records/2026-06/2026-06-04-unified-log-storage-http-api.md`
- `specs/records/2026-06/event-log-task-project-directory-2026-06-16.md`

Call-point decisions:

| Surface                                                 | Current Evidence                                                                                                     | Benchmark Decision                                                                                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/bus/bus-event.ts`              | Registry silently overwrites duplicate event types. `global.disposed` is defined in two files.                       | Duplicate event type registration must throw with the previous and next event type named in the error.                                                                                           |
| `packages/opencorvus/src/server/routes/orchestrator.ts` | `protocolTaskEvent` and `taskListProtocolEvent` call `BusEvent.resolveNotify(...)`.                                  | Matrix-test task, interaction, evaluation, message, and integrity events through both projections and zod schemas.                                                                               |
| `packages/opencorvus/src/server/routes/session.ts`      | Session event projection also calls `BusEvent.resolveNotify(...)`.                                                   | Session error notify must use the same registry semantics.                                                                                                                                       |
| `packages/overlay/src/services/notify.ts`               | `showNotification` is the primitive. Native permission/send failures currently log to console only.                  | Native notification send/probe/request failures must create semantic in-app diagnostics when operator-actionable.                                                                                |
| `packages/overlay/src/services/sse.ts`                  | SSE dispatch errors already call `notifyError`.                                                                      | Stress tests must keep dispatch errors visible with event type and details.                                                                                                                      |
| `packages/overlay/src/main.tsx`                         | Runtime diagnostics call `AppLog.error` and `notifyError`.                                                           | Runtime error and unhandled rejection must use the actual error summary as visible message and keep source in details.                                                                           |
| `packages/overlay/src/utils/log.ts`                     | `AppLog` posts overlay logs to `/log`; error entries and upload failures could diverge from the notification center. | `AppLog.error(...)` must create semantic notification-center diagnostics, log upload failures must include the failing HTTP/transport cause, and queue retry scheduling must not stall silently. |
| `packages/opencorvus/src/util/log.ts`                   | `Log.files()` and `Log.read()` are the unified log read API.                                                         | Route tests must reject traversal and keep `/log`, `/log/files`, `/log/tail` unified.                                                                                                            |
| `packages/opencorvus/src/engine/event-log.ts`           | Task log write/init failures only warn to the main log.                                                              | Event-log failures must be explicit enough to diagnose path/task/project failures; tests must cover no ambient instance context.                                                                 |

## Benchmark Cases

1. `BusEvent` schema pressure:
   - Duplicate `BusEvent.define("same.type", ...)` throws.
   - Existing source tree has no duplicate event type registrations.
   - Invalid payload passed to a notify resolver throws a schema error instead of resolving an empty notify descriptor.

2. Protocol notification pressure:
   - `task.failed` -> tier 1 + badge in per-task and task-list events, with semantic details.
   - `task.completed` and accepted `evaluation.completed` -> tier 2 in both projections.
   - rejected `evaluation.completed` and `integrity.review.completed` requiring correction -> tier 1 + badge.
   - `message.part.delta`, `run.progress`, and other stream noise stay tier 3 or out of toast routing as defined by the registry.
   - Events without notify metadata do not create notification details.

3. Overlay notification pressure:
   - Every routed tier 1/tier 2 event creates exactly one center-history in-app notification.
   - Tier 3 never creates toast/OS notification.
   - Duplicate aggregate events from per-task and task-list streams do not duplicate the in-app row.
   - Native send failure produces one semantic error notification with diagnostic details.
   - Permission probe/request failures produce semantic warning/error notifications through the same store.
   - Overlay log upload failure produces one semantic center-history error notification with HTTP/transport details.
   - A failed log upload schedules the existing retry queue instead of leaving queued entries with no timer.
   - Runtime error and unhandled rejection create detailed in-app notifications.
   - SSE dispatch failure creates detailed in-app notifications with event type and JSON payload.
   - Any overlay `AppLog.error(...)` entry creates a sticky center-history notification with details.

4. Log route pressure:
   - `GET /log`, `GET /log/files`, and `GET /log/tail` read through `Log`.
   - Named log file parsing rejects path traversal, Windows drive/name-stream separators, and non-log names.
   - Posted log entries are retrievable through the same read API.

5. Timeout policy:
   - Tests and scripts use runner-level timeouts only as no-output/no-activity guards where possible.
   - Long-running service tests that start a server must use port `7078`.

## Completion Criteria

- Focused benchmark and tests pass.
- No duplicate event registration remains.
- No new fallback, gate, or compatibility path is introduced.
- Operator-actionable overlay errors create semantic notification entries with details.
- Log route and notification protocol schemas remain single-sourced.
- After benchmark pass, perform a second code review for hidden dual-source logic and silent failures.
