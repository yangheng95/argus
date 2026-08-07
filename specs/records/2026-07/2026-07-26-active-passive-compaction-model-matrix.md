# Active And Passive Compaction Model Matrix

Date: 2026-07-26

## Acronyms

- API: Application Programming Interface, the server contract exercised by the
  live matrix.
- GPT: Generative Pre-trained Transformer, the GPT model family used in the
  matrix.
- HTTP: Hypertext Transfer Protocol, the provider and server response boundary.
- ID: Identifier, a stable message, Session, Part, or control-record key.

## Problem

Manual compaction can complete while automatic predictive compaction appears to
hang forever. Source inspection alone cannot distinguish a compactor-model
failure from a continuation-order failure, so both entry paths must be exercised
against real models and the persisted message/control evidence must be checked.

## Recall

- User request: actually test active and passive compaction and ensure both work
  across different models.
- Acceptance:
  - manual `POST /session/:sessionID/summarize` produces a valid visible summary
    with the explicitly requested model;
  - manual compaction wakes an already-running prompt loop from standby and its
    caller receives the summary rather than a normal reply or a lifecycle error;
  - predictive budget pressure creates and consumes one automatic
    `compaction_request`;
  - the automatic summary uses the configured compaction model;
  - the triggering user request remains the latest user turn after compacted
    replay and receives a normal assistant reply;
  - invalid or unavailable provider models remain visible provider failures and
    are not reported as compaction failures.
- Hard constraints:
  - preserve all unrelated dirty-worktree changes;
  - do not restart or otherwise interfere with the user's running
    OpenCorvus/Overlay processes;
  - use an isolated temporary portable home, database, Git project, and server;
  - keep one compaction engine and one durable control path;
  - do not add fallback, retry-state, or host gate behavior.
- Read before implementation:
  - `AGENTS.md`;
  - `specs/current/architecture/14-agent-runtime-mode.md`;
  - `specs/current/architecture/15-agent-facts-and-turns.md`;
  - `specs/records/2026-06/2026-06-03-compaction-dispatch-anchor-bounded-reference.md`;
  - `specs/records/2026-06/2026-06-14-marker-on-anchor-compaction-boundary.md`;
  - `specs/records/2026-06/2026-06-25-context-recovery-and-worktree-reuse.md`;
  - `packages/opencorvus/src/session/compaction.ts`;
  - `packages/opencorvus/src/session/message.ts`;
  - `packages/opencorvus/src/session/loop.ts`;
  - `packages/opencorvus/src/server/routes/session.ts`;
  - `packages/opencorvus/src/scheduler/task-queue-service.ts`;
  - existing compaction and message tests under
    `packages/opencorvus/test/session/`.
- Full-repository search:

```sh
rg -n "SessionCompaction\.(create|process)|SessionControl|flushCallbacks|attach|waitForUserMessage|automaticCompactionDecision|manual_summarize|compaction_request|filterCompacted|tail_start_id|anchor_id|ContextBudget|/:sessionID/summarize" packages/opencorvus/src packages/opencorvus/test specs
```

- Independent-agent feedback: none. The current request did not authorize
  sub-agent delegation, so the main agent owns investigation and second review.

## Call-Point Audit

| Surface | Current responsibility | Decision |
| --- | --- | --- |
| `server/routes/session.ts` summarize route | Select the latest real user and forward the explicit model. | Keep a user carrying a compaction marker eligible: the marker is attached to the real triggering user, not a synthetic message. |
| `scheduler/task-queue-service.ts::executeCompaction` | Create the durable control and run the shared Session loop. | Keep unchanged; both modes already converge here. |
| `session/compaction.ts::create/process` | Persist `manual_summarize` or `compaction_request`, select head/tail, call the helper model, and persist the marker and visible summary. | Keep unchanged unless tests expose a separate defect. The live automatic summary completed successfully. |
| `session/control.ts` | Persist the canonical compaction request. | Notify a live standby subscriber after the pending record is committed; the database record remains the source of truth. |
| `session/message.ts::filterCompacted` | Build the chronological provider replay from the anchor, summary, preserved tail, marker, and newer turns. | Repair distinct-anchor ordering so the summary precedes retained context while the current marker user remains after the retained tail. |
| `session/loop.ts::collectLoopState/waitForUserMessage` | Select the latest real user/assistant and wake a standby owner. | Exclude markers with an exact valid summary from pending work; subscribe to durable controls and re-read them after subscription to close the lost-wake window. |
| `session/prompt/state.ts` callback ownership | Attach synchronous callers to a live loop and deliver its result. | Store `reply` or `summary` on each callback so a loop started by an earlier message can serve a later manual compact correctly. |
| `session/context-budget.ts` | Decide predictive threshold and preserved-tail budget from model limits. | Keep unchanged. A 10% threshold below non-compressible tool schemas correctly failed; a 35% threshold triggered compaction. |
| `agent/helper-agent-registry.ts` and `agent/model.ts` | Resolve the configured compaction helper model. | Keep unchanged; persisted summary model matched the requested/configured model in successful live cases. |
| `test/session/message.test.ts` | Covers replay boundaries and anchored tail ordering. | Change the distinct-anchor expected order and add a regression with a finished retained assistant before the current triggering user. |
| `test/session/compaction-dispatch-anchor.test.ts` | Covers selected head/tail and dispatch-anchor replay. | Update the expected distinct-anchor order and assert the triggering user remains last. |

## Baseline Evidence

The baseline used `/tmp/opencorvus-compact-live.mDIiwk` as an isolated
`OPENCORVUS_HOME`, database, and Git project. No existing OpenCorvus or Overlay
process was touched.

### Manual compaction

| Requested model | HTTP result | Persisted summary | Result |
| --- | --- | --- | --- |
| `hexin/gpt-5.4-mini` | `200 true` | `hexin/gpt-5.4-mini`, `finish=stop`, marker `ALPHA-742` retained | pass |
| `hexin/claude-sonnet-4-6` | `200 true` | `hexin/claude-sonnet-4-6`, `finish=stop`, marker `BETA-915` retained | pass |
| `hexin/qwen3.7-max` | `200 false` | `APIError`, HTTP 400, gateway reports invalid model name | provider catalog drift; not a compaction defect |

### Automatic predictive compaction

1. With threshold `0.1`, the prompt estimated `70021` tokens against a
   `19900` limit while system plus tool schemas alone occupied `101509`
   characters. The loop correctly produced `PromptBudgetOverflowError` and did
   not claim compaction success.
2. With threshold `0.35`, the same GPT prompt estimated `70048` tokens against a
   `69650` limit and logged `predictive-compaction-triggered`.
3. The automatic control was consumed and the summary completed successfully:
   `auto=1`, `overflow=0`, model `hexin/gpt-5.4-mini`, `finish=stop`, no error.
4. The summary completed in about seven seconds, but the synchronous prompt
   returned no headers for more than five minutes. The isolated server also
   could not finish graceful shutdown while that request remained attached.
5. The filtered replay was:

```text
anchor user
current triggering user with compaction marker
compaction summary
retained prior user
retained prior finished assistant
```

`collectLoopState` therefore selected the retained prior user/assistant pair,
and `shouldEnterStandby` waited for a new user even though the current triggering
user had not received a normal reply.

## Root Cause

Passive observable symptom:

- passive compact produces a valid summary but the original synchronous prompt
  never returns.

Direct trigger:

- the distinct-anchor post-pass in `Message.filterCompacted` moves the marker
  user and its summary together immediately after the anchor.

Deeper cause:

- the marker user is also the current request that caused predictive
  compaction. Moving it before the preserved tail makes an older finished tail
  assistant appear newer than the unhandled request. The Session loop then
  enters standby from truthful but incorrectly ordered facts.
- once the marker user is restored after the preserved tail,
  `collectLoopState` can see that marker before it encounters a finished
  assistant. Its old suffix-only scan treated the marker as pending even though
  the same filtered replay already contained a valid completed summary for that
  marker, causing repeated automatic compaction instead of continuation.

Why earlier coverage did not catch it:

- existing tests explicitly asserted
  `anchor -> marker user -> summary -> tail user -> tail assistant`;
- they checked retained content, but did not assert that automatic continuation
  still sees the triggering user as the latest user after a finished tail.

Active observable symptoms:

- after a normal assistant reply put the prompt loop in standby, manual compact
  persisted a pending control but the request never returned;
- after adding a control wake, the summary was generated but the route returned
  HTTP 500 with `Session prompt loop ended after internal compaction summary
  checkpoint before continuation`;
- repeating summarize could select an older compacted-away user and hang after
  the control was failed.

Active direct triggers:

- standby listened only for a new user-message event and runtime-contract wake,
  not for a newly committed Session control;
- one loop-global `resultMode` came from the request that originally started the
  loop, while all attached callbacks were resolved together;
- the summarize route excluded every user carrying a compaction part even
  though current compaction attaches that part to the real user.

Active deeper cause:

- durable work ownership, prompt-loop wakeup, and synchronous caller result
  ownership were conflated. A control could exist without waking its owner, and
  a later summary caller inherited the earlier reply caller's result semantics.
  The route then treated the marker as synthetic and selected history that
  compacted replay had truthfully removed.

## Repair

For a marker whose `anchor_id` points to a different user:

```text
anchor -> summary -> retained tail -> current marker user -> newer turns
```

Move only the completed summary block beside the anchor. Leave the current
marker user at its chronological position after the retained tail. Keep
marker-on-anchor and legacy tail-only behavior unchanged.

When collecting loop state, derive the set of completed compaction sources from
all valid summaries in the filtered replay and exclude only those exact marker
parts from the pending-compaction list. This uses the existing visible summary
fact; it adds no retry counter, state machine, fallback, or hidden status.

For manual compaction on a live loop:

- notify standby subscribers only after a pending control record is committed;
- subscribe to control wakes and then re-read the durable pending records so a
  commit between the standby decision and subscription cannot be lost;
- store `reply` or `summary` on each attached callback and flush only matching
  callbacks;
- when an exact completed summary already exists, resolve the manual summary
  callback and stop instead of entering standby;
- keep the latest real user eligible as the summarize source even after it
  gains its compaction marker.

These changes alter no durable schema, control kind, model routing, compaction
policy, or provider behavior.

## Post-Repair Real-Model Evidence

The same isolated portable home and real API were used after the repair.

| Mode | Model | Trigger/result | Persisted evidence |
| --- | --- | --- | --- |
| manual/live standby | `hexin/gpt-5.4-mini` | four real reply turns followed by summarize; `200 true` | session `ses_06345e845ffe0Jv9pXie6ldyvn`; valid GPT summary, `finish=stop`, no error |
| manual/live standby | `hexin/claude-sonnet-4-6` | four real reply turns followed by summarize; `200 true` in `4.16s` | session `ses_0634486f7ffep7FnF3NpvpDX4P`; valid Claude summary, `finish=stop`, no error |
| repeated manual | GPT and Claude above | both returned `200 true`; GPT `6.11s`, Claude `0.008s` | latest marker user remained the source; no compacted-away user failure and no attached request remained |
| predictive | `hexin/gpt-5.4-mini` | `71708 > 69650`; request completed in `15300ms` with `PASSIVE-GPT-FIXED2` | one `auto=true`, `overflow=false` marker; one GPT summary and one GPT final reply, both `finish=stop`, no error |
| predictive | `hexin/claude-sonnet-4-6` | `72802 > 69650`; request completed in `22031ms` with `PASSIVE-CLAUDE-FIXED` | one `auto=true`, `overflow=false` marker; one Claude summary and one Claude final reply, both `finish=stop`, no error |

The final isolated server reported `settled process-owned prompts sessions=0
toolParts=0` and exited on the first interrupt. The earlier
repeated-compaction, standby wake, callback-mode, and attached-request failures
did not recur.

## Verification

- Focused regression:
  - `bun test packages/opencorvus/test/session/message.test.ts -t "filterCompacted"`
  - `bun test packages/opencorvus/test/session/compaction-dispatch-anchor.test.ts`
  - `bun test packages/opencorvus/test/session/session-control.test.ts`
  - `bun test packages/opencorvus/test/session/prompt-state-terminal.test.ts`
  - `bun test packages/opencorvus/test/server/session-routes.test.ts`
- Compaction suite:
  - `bun test packages/opencorvus/test/session/compaction.test.ts packages/opencorvus/test/session/compaction-build-session-tail.test.ts packages/opencorvus/test/session/compaction-continue-inherit.test.ts packages/opencorvus/test/session/predictive-compaction-decision.test.ts`
- Documentation health:
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `bun test packages/opencorvus/test/script/document-health.test.ts`
- Real isolated model matrix after the repair:
  - manual compaction with at least GPT and Claude;
  - predictive compaction plus normal continuation with GPT and Claude;
  - persisted control, marker, summary model, finish/error, and final reply
    checked from the real API/database.
- Run the repository typecheck and review the task-owned diff a second time.

## Verification Results

- `bun run --cwd packages/opencorvus typecheck`: pass.
- The eight-file focused run produced 143 passes. Its only failure was the
  unrelated existing `DELETE /session/:id?deleteTasks=true` server-route test,
  which returns HTTP 500 in the concurrently modified Task deletion surface;
  the summarize route, callback ownership, control wake, replay, compaction,
  and predictive tests all passed.
- Historical-document tests passed. Document health had one tracking-only
  failure because three concurrently created July records, including this
  record before staging, were still untracked at test time.
- `git diff --check`: pass.
- Second review confirmed the task changes do not include the concurrent Task
  Artifact transport or process-shutdown handoff changes that share
  `session/loop.ts` and `session/prompt/state.ts`.
