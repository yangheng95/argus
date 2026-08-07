# Question Timeline Order Source Repair

## Recall

### User request

After a Mission is published, later AI interaction content is rendered at the top of the conversation instead of at its chronological position. The supplied screenshot shows a `System` question created at 18:30:21 above a Mission turn created at 18:29:10.

### Acceptance criteria

- A question asked after an existing Mission turn sorts after that turn and remains attached to the Mission conversation.
- The question header time and its timeline `orderKey` use the same authoritative creation time.
- A resolved answer keeps its existing resolution-time ordering between the question and the following Mission turn.
- The real server event stream, Overlay projection tests, and a headful desktop browser screenshot verify the repaired chronology.
- No compatibility path, fallback ordering, keyword heuristic, UI-only reordering, or second timestamp source is introduced.

### Hard constraints

- `Question.Request.timeCreated` becomes the single creation-time source for the question event, Engine interaction persistence, protocol ordering, and Overlay display.
- `Identifier.timestamp()` must not be used as wall-clock time: an ascending identifier retains only the low 36 timestamp bits.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus or Overlay processes.
- Browser acceptance uses the existing Node-launched, headful Playwright fixture; Bun must not launch Playwright.
- Every behavior change has a regression assertion, and delivery is committed with the `dsw-33987` prefix and pushed to `myhexin`.

### Sources read

- User screenshot `C:/Users/10132/AppData/Local/Temp/codex-clipboard-5509d939-2928-4be3-8298-3e287d966e3d.png`.
- Live read-only evidence from `GET /work-ledger`, the affected session conversation, and `C:/Users/10132/.local/share/opencorvus/log/2026-07-19T102728-15844-1.log`.
- `specs/current/architecture/07-panel-reactivity.md`.
- `specs/records/2026-06/2026-06-04-mission-question-rendering.md`.
- `specs/records/2026-06/2026-06-20-instance-late-bootstrap-question-popup.md`.
- `specs/records/2026-06/2026-06-27-bug-hunt-residual-convergence.md`.
- Question lifecycle, Engine interaction persistence, protocol mirror, timeline ordering, Overlay tree writer, and their unit/server/browser tests.
- Browser-control skill instructions and its Node client reference.

### Whole-repository search evidence

Repository-wide searches covered `Identifier.timestamp`, `Question.Request`, `Question.Event.Asked`, `question.asked`, `questionRequestOrderKey`, `timeCreated`, route schemas, and generated API artifacts.

| Surface | Decision |
| --- | --- |
| `packages/opencorvus/src/question/index.ts` | Add creation time to the event schema and capture it once when a new request is created. Stable duplicate callers join the existing request without replacing its time. |
| `packages/opencorvus/src/protocol/session-mirror.ts` | Replace identifier timestamp decoding with strict `Question.Request.timeCreated` ordering. |
| `packages/opencorvus/src/engine/interaction.ts` | Persist the request's creation time instead of sampling a second `Date.now()`. |
| `packages/opencorvus/src/server/routes/question.ts` | Keep the route implementation; its existing `Question.Request` schema projection receives the new required field. |
| `packages/opencorvus/src/orchestrator/tools.ts` | Keep unchanged; it asks through the canonical Question API and does not own timestamps. |
| `packages/overlay/src/services/event-policy.ts` | Keep unchanged; event admission is not the ordering defect. |
| `packages/overlay/src/services/tree-writer.ts` | Display the authoritative request/resolution timestamps and reject order-key timestamp drift instead of sampling the event envelope time. |
| `packages/opencorvus/test/question/question.test.ts` | Assert that the asked event and pending request expose one stable creation time. |
| `packages/opencorvus/test/protocol/session-mirror.test.ts` | Assert the interaction key uses the 2026 request time, not the wrapped identifier timestamp. |
| `packages/opencorvus/test/server/session-conversation-routes.test.ts` | Exercise the real `Question.ask` to server-event bridge and assert chronological ordering against an earlier message. |
| `packages/overlay/test/tree-writer-hierarchy.test.ts` | Assert request/display time ownership and fail-fast behavior when payload and order key diverge. |
| `packages/overlay/test/browser/mission-question-response-chronology-browser.test.ts` | Feed production-shaped timestamps and retain the headful rendered chronology screenshot. |
| Generated OpenAPI/SDK files | Regenerate from the changed `Question.Request` schema; do not hand-edit generated contracts. |

### Independent agent feedback

None. The user did not request multiple agents or parallel audit, so no sub-agent was started.

## Evidence and causal chain

The affected live Mission started at `1784456950466` (18:29:10.466). Its question was logged at `1784457021372` (18:30:21.372) with ID `que_f79ed47bc00177x6giD181RnYP`. The visible card correctly showed 18:30:21 because the protocol envelope sampled current time, while `questionRequestOrderKey()` decoded the identifier body. The decoded value is `66470102972`, which corresponds to 1972 because the identifier encodes only the low 36 timestamp bits.

Therefore the causal chain is:

1. Visible symptom: the later System question renders above the earlier Mission card.
2. Direct trigger: top-level cards are correctly sorted by `orderKey`, but the question's key carries a 1972 timestamp.
3. Deep cause: `session-mirror.ts` treats a truncated identifier component as an absolute wall-clock timestamp, while the envelope separately supplies a correct 2026 display time.
4. Why prior coverage missed it: protocol and browser fixtures manually created valid interaction keys and never sent a production-shaped 2026 `Question.ask` request through identifier generation and the server mirror.

This is not a tree-sort defect and must not be repaired by special-casing System cards in the UI.

## Implementation

1. Add a required positive integer `timeCreated` to `Question.Request`; capture it once before publishing a new request.
2. Make Engine persistence and session mirroring consume that field directly.
3. Make the Overlay consume the payload's request/resolution timestamps and verify that they match the supplied interaction order key.
4. Update all production-shaped fixtures, add the wrapped-ID regression to the server path, and regenerate OpenAPI/SDK output.
5. Run targeted Bun tests, Overlay type/build checks, docs health checks, and the Node/headful browser chronology test; inspect the resulting screenshot.

## Verification commands

```bash
bun test packages/opencorvus/test/question/question.test.ts
bun test packages/opencorvus/test/protocol/session-mirror.test.ts
bun test packages/opencorvus/test/server/session-conversation-routes.test.ts
bun test packages/overlay/test/tree-writer-hierarchy.test.ts
bun run typecheck
bun ./script/generate.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/mission-question-response-chronology-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```

## Verification outcome

- Question lifecycle: 15 tests passed.
- Session mirror: 17 tests passed.
- Real session event route: 11 tests passed, including a production-generated question ID whose wrapped timestamp is explicitly rejected as the ordering source.
- Late Engine interaction bootstrap: 3 tests passed, including equality between the published request time and the persisted interaction time.
- Overlay tree writer: 58 tests passed, including payload/envelope time separation and fail-fast order-key drift coverage.
- Workspace typecheck: 9 package tasks passed.
- Generated OpenAPI and JavaScript SDK contracts include required `QuestionRequest.timeCreated`.
- Node/headful browser chronology test passed. The inspected screenshot at `.scratch/interaction-response-chronology/mission-question-response.png` shows the question and answer nested after the first Mission text and the next Mission turn below them; browser/runtime error collectors were empty.
- Historical-doc links, document-health, product-doc single-source, API route inventory, and generated API documentation checks passed.
