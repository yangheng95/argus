# Mailbox System Message Projection

Date: 2026-07-23

Status: Implemented and verified

Owner: Coding Assistant

## Recall

| Field                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User request               | “mailbox没有出现系统消息推送 实现下” — make system message pushes appear in Mailbox.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Acceptance criteria        | Persisted task protocol events with canonical user-facing system notification semantics appear in the existing global Mailbox page, counts, acknowledgement actions, change stream, badge, and native notification projector. High-frequency informational events and internal engine recovery facts do not flood Mailbox. Existing exclusions for `goal.passed`, `goal.failed`, `task.cancelled`, and `task.lifecycle` remain excluded. No second notification source or frontend event feed is introduced. |
| Hard constraints           | Preserve `protocol_event` as the only durable Mailbox source and `BusEvent.notify` as the canonical system-notification descriptor. No fallback, compatibility alias, event-name keyword matching, state machine, hidden message store, new worktree, or restart/refresh of the running OpenCorvus/Overlay. Browser automation uses Node. Every production change receives regression coverage. Preserve unrelated dirty files. Commit subjects start with `dsw-33987`; push to `legacy-remote`.                   |
| Sources read               | Root `AGENTS.md`; `CLAUDE.md`; `specs/current/architecture/07-panel.md`; the 2026-07-16 Mailbox architecture, 2026-07-17 notification retirement/cross-platform repair, and 2026-07-23 Mailbox refinement records; current `BusEvent`, engine event definitions, protocol projection, Mailbox engine/routes, Overlay Mailbox/native notification projector, and focused backend/frontend tests.                                                                                                              |
| Git baseline               | Branch `work-v0.0.17beta-yr-0723` tracks the same-named `legacy-remote` branch. Existing unrelated modifications are present in Overlay browser coverage, generated OpenAPI, spec indexes, and the Environment heading record; they remain untouched except that this record must be indexed at completion. `git fetch legacy-remote` completed before mutation.                                                                                                                                                         |
| Independent agent feedback | None. The change is one tightly coupled backend projection and regression surface; session-local delegation would add context cost without an independent write boundary.                                                                                                                                                                                                                                                                                                                                    |

### Whole-repository search evidence

| Surface / call site                                  | Current behavior                                                                                                                                                                                                                                                                                                                                       | Disposition                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/model.ts` and other `BusEvent.define` owners | `notify` is the canonical typed descriptor for system-visible task events. Tier 1/2 represent failures, attention, and terminal results; tier 3 also covers high-frequency updates, progress, and message events. Dynamic resolvers already express payload-dependent visibility for evaluation, task reports, Mailbox messages, and integrity review. | Reuse `BusEvent.resolveNotify`; do not recreate the descriptor in Mailbox. Project only tier 1/2 system events so Mailbox does not become a progress/message firehose.                             |
| `server/routes/orchestrator.ts` task-list SSE        | Resolves `BusEvent.notify` and emits small invalidation envelopes plus copyable details. Overlay intentionally uses this stream only to refetch task lists after the old event-oriented Notification UI was deleted.                                                                                                                                   | Leave unchanged. It is transport evidence, not a durable Mailbox source.                                                                                                                           |
| `engine/mailbox.ts`                                  | Reads `protocol_event`, but a hand-maintained event-name table admits only Mailbox messages and a small selected subset. Any newer system-notify event is silently absent from Mailbox pages, counts, acknowledgements, stream invalidation, badge, and native notification delivery.                                                                  | Make the protocol row payload plus `BusEvent.resolveNotify` the source for tier 1/2 system eligibility and presentation. Retain dedicated presentation for Mailbox and coordination/progress rows. |
| Existing Mailbox exclusions                          | `goal.passed`, `goal.failed`, and `task.cancelled` were deliberately removed from every Mailbox path while remaining canonical protocol facts. Full route verification also proved that internal `task.lifecycle` recovery wakes would otherwise create a new unread row whenever the server recovers an active task.                                  | Preserve the existing exclusions and exclude `task.lifecycle`; it is an engine wake fact, not an operator system message.                                                                          |
| `MailboxPanel.tsx` and `desktop-notifications.ts`    | Refetch the canonical `/mailbox` projection and derive UI/native delivery from returned items.                                                                                                                                                                                                                                                         | No new frontend feed or store. Backend projection repair automatically reaches both surfaces.                                                                                                      |
| Mailbox routes and SSE                               | List/count/action lookup and change invalidation all call `MAILBOX_SOURCE_EVENT_TYPES` / `isMailboxChangeEventType`.                                                                                                                                                                                                                                   | Update through the same predicate so all Mailbox operations converge.                                                                                                                              |
| Focused tests                                        | Existing tests cover worker messages, selected canonical events, exclusions, acknowledgements, and system notification projection after `/mailbox` hydration, but not newer `notify` event families omitted by the Mailbox allowlist.                                                                                                                  | Add failing regression cases for dynamic accepted/rejected evaluation and pass/fail integrity review, tier-3 exclusion, and preserved lifecycle exclusions.                                        |

## Causal chain

1. The system persists a protocol event and its event definition resolves canonical `notify` metadata.
2. `/task/events` exposes that metadata, but the Overlay correctly treats the stream as task-list invalidation after retiring the duplicate event-oriented Notification UI.
3. The only durable notification surface is Mailbox, whose source predicate is a separate manually maintained event-name list.
4. New or previously unlisted system-notify events are therefore discarded before Mailbox paging and stream invalidation, so neither the Mailbox UI nor its native notification projector can observe them.
5. The root repair is to make the canonical `BusEvent.notify` descriptor drive system-event Mailbox eligibility while retaining the deliberate Mailbox-specific exclusions and dedicated worker/coordination presentation.

## Implementation and verification plan

1. Add focused backend regressions that persist representative tier-1/tier-2 dynamic-notify events and prove they are missing from Mailbox before implementation; also assert tier-3 and the three deliberate lifecycle exclusions remain absent.
2. Refactor `engine/mailbox.ts` so one source predicate and presentation resolver combine dedicated Mailbox rows with tier-1/tier-2 `BusEvent.notify` system rows. Make list, count, lookup, acknowledgement, and stream invalidation consume that same predicate.
3. Update current architecture and both spec indexes without modifying unrelated record content.
4. Run the focused Mailbox test, protocol notification tests, affected server route tests, OpenCorvus typecheck, document health, and `git diff --check`.
5. Perform a second full call-site and diff review, commit only task-owned paths with a `dsw-33987` subject, push the current branch to `legacy-remote`, and verify remote equality.

## Progress

- [x] Historical decisions, current owners, full event-definition inventory, and Git baseline inspected.
- [x] Recall, causal chain, and implementation plan recorded.
- [x] Failing regression recorded: three persisted tier-1/tier-2 system events returned an empty Mailbox page before implementation.
- [x] Production implementation complete.
- [x] Static and focused runtime verification complete.
- [x] Second source/diff review complete.
- [ ] legacy remote push blocked by a concurrently created mixed checkpoint commit with a noncompliant subject.

## Implementation and verification evidence

- `BusEvent.notifyTypes()` exposes the registered notify-bearing event types in
  stable sorted order. Mailbox uses that inventory only as the bounded SQL
  candidate set; every dynamic descriptor is still resolved from the persisted
  payload through `BusEvent.resolveNotify`.
- Dedicated Mailbox/coordination presentations retain their existing category
  semantics. Other tier-1/tier-2 events project as system notifications; tier-1
  or badge-bearing events receive attention. Tier-3 events and the explicit
  `goal.passed`, `goal.failed`, `task.cancelled`, and internal `task.lifecycle`
  exclusions remain absent.
- List/count, single/batch acknowledgement lookup, and global Mailbox change
  stream all call the same payload-aware source predicate. The Overlay still
  consumes only `/mailbox` plus `/mailbox/events`; no frontend event feed or
  second notification store was introduced.
- The RED case persisted `plan.activated` plus accepted/rejected
  `evaluation.completed` events and received `[]` from `listMailbox`. After the
  implementation the same case passed and proved a routine tier-3
  `task.created` event remains excluded.
- `bun test --timeout 30000 packages/opencorvus/test/tool/send-mailbox-message.test.ts`
  passed 6 tests / 34 expectations.
- The focused protocol notify suite passed 4 tests / 15 expectations; the new
  BusEvent inventory case passed 1 test / 5 expectations; the real global
  Mailbox SSE/list route case passed 1 test / 7 expectations including a
  system `plan.activated` event.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `node packages/overlay/test/browser-runner.mjs
packages/overlay/test/browser/mailbox-left-sidebar-browser.test.ts` passed
  after the existing browser fixture was synchronized with the canonical empty
  `/mission-skill/catalog` response already used by sibling fixtures. The first
  run completed the Mailbox path but correctly failed diagnostics on two 404
  responses from that missing fixture route. The rerun passed with no unexpected
  browser errors. Original-resolution review of
  `packages/overlay/.scratch/left-sidebar-mailbox-focused-open.png` confirmed
  the compact left-sidebar hierarchy, project grouping, unread emphasis,
  disclosure content, and action geometry remain intact.
- Complete serial verification passed: Mailbox tool/projection 6 tests / 36
  expectations; Mailbox routes/SSE 6 / 50; BusEvent 22 / 45; protocol 30 / 117;
  historical links 21 / 70; document health 61 / 1297; `git diff --check`
  passed.
- The final Git review found that a concurrently running Mission created commit
  `dd2717cf1` while this work was in progress. It includes this complete Mailbox
  implementation together with unrelated Environment/OpenAPI work and uses the
  subject `Checkpoint before Phase 01: OpenCorvus Dashboard 市场调研`, which
  violates the required `dsw-33987` prefix. The commit was not created by this
  Coding Assistant, so it was not amended, rewritten, or pushed. The branch is
  one commit ahead of `legacy-remote/work-v0.0.17beta-yr-0723`; remaining unstaged
  files belong to the concurrent Overlay task.
