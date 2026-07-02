# Wait Message Created Activity

Date: 2026-07-02

## Objective

Fix the failure where `message.updated` can interrupt a scheduled wait before the
timer has a real waiting period. A wait should be consumed by new user activity,
not by a replay or mutation of an existing user message.

## Recall

- User requests:
  - "message.updated为什么会造成定时器过早interrupt？"
  - "深度确认问题"
  - "修复这个问题"
- Acceptance criteria:
  - New visible user messages still consume pending session waits.
  - Re-updating an existing visible user message does not consume pending session
    waits.
  - Re-updating an existing visible user message does not consume pending task
    waits or dispatch the task loop.
  - Terminal non-wait tool results still consume pending task waits.
  - Wait tool results still do not consume the cron row created by wait itself.
- Hard constraints:
  - No fallback, compatibility path, gate, timer timestamp heuristic, hidden
    message, polling loop, blocking sleep, or scheduler-specific keyword patch.
  - Do not restart or refresh the running OpenCorvus/overlay process.
  - Do not revert user or pre-existing working tree changes.
  - Add regression tests for every code change.
- Landed sources read:
  - `specs/records/2026-07/2026-07-02-wait-park-turn-boundary.md`
  - `specs/records/2026-07/2026-07-02-wait-agent-scope.md`
  - `specs/records/2026-07/README.md`
  - `specs/README.md`
  - `packages/opencorvus/src/session/message.ts`
  - `packages/opencorvus/src/session/index.ts`
  - `packages/opencorvus/src/scheduler/cron-service.ts`
  - `packages/opencorvus/test/scheduler/cron-service.test.ts`
- Whole-repository search evidence:
  - `rg -n "Message\\.Event\\.|message\\.updated|PartUpdated|handleMessageUpdated|consumePendingSessionWaits|consumePendingTaskWaits|triggerTaskWaitFromActivity|persistMessage|updateMessage\\(" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07`
  - `rg -n "Object\\.values\\(Message\\.Event|for \\(const .*Message\\.Event|Message\\.Event\\[|MESSAGE_EVENT|Event\\.Updated|message\\.updated|message\\.part\\.updated" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
  - `rg -n "eventNames|subscribe\\(|Bus\\.subscribe\\(|BusEvent\\.define|Event\\s*=\\s*\\{" packages/opencorvus/src/bus packages/opencorvus/src/server packages/opencorvus/src/orchestrator/protocol packages/opencorvus/src/protocol packages/opencorvus/src/session -g "*.ts"`
- Independent agent feedback:
  - No sub-agent was spawned. The current request is a focused scheduler/session
    contract repair with enough repository evidence from the searches above; the
    main agent keeps ownership of the change.

## Root Cause

`Session.updateMessage` publishes `message.updated` for both first writes and
subsequent rewrites. `Session.persistMessage` also emits the same event after
silently saving the message row so readers can observe a fully durable
message-plus-parts bundle.

`CronService` currently subscribes to `Message.Event.Updated` and treats every
user `message.updated` as fresh user activity. That is too broad. A delayed
update of an existing user message is not a new user turn, but the scheduler
deletes pending wait cron rows synchronously before it can distinguish that
case. The timer therefore appears to have no waiting period.

This is not a cron-duration problem and not a wait-tool scope problem. The
semantic bug is that the scheduler consumes waits from a generic mutation event
instead of a creation event.

## Callpoint Inventory

| Surface | Current evidence | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/session/message.ts` | `Message.Event.Updated` is the only visible message-level mutation event. | Add a first-write `Message.Event.Created` event with the same visible info payload. |
| `packages/opencorvus/src/session/index.ts` | `updateMessage` sees whether a row existed before the upsert; `persistMessage` writes via `saveMessage` before `updateMessage`. | Publish `message.created` exactly once on first visible message persistence, including the deferred `persistMessage` path. |
| `packages/opencorvus/src/scheduler/cron-service.ts` | Activity subscriptions consume waits from `Message.Event.Updated` and `Message.Event.PartUpdated`. | Move user-message wait consumption to `Message.Event.Created`; keep terminal tool activity on `PartUpdated`. |
| `packages/opencorvus/src/session/loop.ts` | `waitForUserMessage` uses `Message.Event.Updated` to wake an in-process reply loop. | Do not change it; that loop wants any user-message mutation in the watched session. |
| `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` | The bridge intentionally mirrors `message.updated`, parts, removed, and delta events. | Do not mirror `message.created`; this is an internal activity event, while protocol projections keep their existing update source. |
| `packages/opencorvus/src/protocol/session-mirror.ts` and server SSE routes | Existing UI/protocol code projects `message.updated` and part events. | Leave existing UI event behavior intact; the scheduler no longer depends on that broad projection. |
| `packages/opencorvus/test/scheduler/cron-service.test.ts` | Current tests cover new user-message consumption and tool-result consumption; the terminal tool fixture has equal start/end timestamps. | Add existing-message update regressions for session and task waits, and repair the fixture timestamp so current tool-result tests exercise the intended path. |

## Design

1. Introduce `Message.Event.Created` with type `message.created` and payload
   `{ info: Message.VisibleInfo }`.
2. In `Session.updateMessage`, publish `message.created` only when the target
   message row did not exist before the upsert. Continue publishing
   `message.updated` for all upserts.
3. In `Session.persistMessage`, pre-read whether the message row already exists
   before the silent save. After the silent save and before `message.updated`,
   queue `message.created` only for a first write, preserving the same
   transaction and post-commit effect discipline as `message.updated`.
4. In `CronService`, subscribe to `Message.Event.Created` for user-message
   activity. Rename the handler and source strings to `message.created`.
5. Keep `message.part.updated` terminal tool activity unchanged, including the
   existing exclusion for the `wait` tool result.

## Acceptance

- Focused scheduler tests pass:
  `bun test packages/opencorvus/test/scheduler/cron-service.test.ts`
- Historical docs link test passes after adding this record:
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Manual code review confirms no timestamp heuristic, fallback, blocking sleep,
  polling loop, or OpenCorvus/overlay process restart was added.
