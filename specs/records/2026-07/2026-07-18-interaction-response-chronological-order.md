# Interaction Response Chronological Order

## Recall

| Item                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | During a conversation, after the Artificial Intelligence (AI) asks a question, the newly entered answer is rendered above the current conversation flow. It must appear at its real chronological position below the preceding flow. The user supplied `C:/Users/10132/AppData/Local/Temp/codex-clipboard-4a8500b6-0e05-4d9f-b6ea-b166750bd8b2.png` and directed the work to use branch `work-v0.0.9beta-yr-0718`.                                                                                                                                                                                                                                               |
| Acceptance criteria        | A Mission question request keeps its ask-time position; the human response receives its own backend-projected response order key at resolution time; the interaction splits otherwise-adjacent Mission message segments so request and response render between the preceding and subsequent Mission turns; persisted Task question/permission responses follow the same contract; focused unit/server tests, Application Programming Interface (API)/Software Development Kit (SDK) generation, a Node-launched real desktop page, current-goal screenshot inspection, typecheck, docs health, diff review, commit, and legacy remote push pass.                        |
| Hard constraints           | Keep backend `orderKey` as the sole cross-family timeline source; do not derive ordering from frontend arrival, array position, labels, or wall-clock fallback; do not add a second interaction store, compatibility alias, sorting gate, state machine, temporary iframe, local query override, or worktree; use Node rather than Bun to launch Playwright; do not restart, refresh, close, or otherwise disturb the user's running OpenCorvus/Overlay process.                                                                                                                                                                                                 |
| Supplied visual evidence   | At original resolution, the screenshot shows the System question at 09:28:29 and the System response at 09:28:44 above a Mission card that begins at 09:27:59 and contains Mission activity at both 09:28:00 and 09:28:44. This proves the interaction has been projected outside its causal turn order; it is not a composer-positioning or scroll-only symptom.                                                                                                                                                                                                                                                                                                |
| Sources read               | `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel-reactivity.md`; `specs/current/architecture/12-overlay-card-system.md`; the sparse Chat composer record; `timeline/order.ts`; `question/index.ts`; `protocol/session-mirror.ts`; `engine/interaction.ts`; `engine/interaction-request.ts`; `engine/model.ts`; `engine/store.ts`; `workbench/board.ts`; `overlay/store/board.ts`; `overlay/utils/interaction.ts`; `overlay/services/tree-writer.ts`; `ChatBubble.tsx`; `Card.tsx`; the direct tree-writer, session-mirror, board-order, interaction-model, interaction-writer, Mission browser, and chronological-message browser tests. |
| Whole-repository search    | Searches covered every `questionOrderKey`, `Question.Event.Replied`, `Question.Event.Rejected`, `viewInteraction`, `Interaction.shape`, `TaskBoard`, `interactionToCardSeeds`, `partitionInteractions`, `board.interactions`, `time.resolved`, interaction status fixture, `rebuildTopLevelOrder`, `regroupTimelineSegments`, `sessionTurnCardAtOrBefore`, and interaction/session conversation route caller. The single production Task read model is `viewInteraction`; the single standalone Mission bridge is `session-mirror.ts`; the single Overlay conversion is `interactionToCardSeeds`; and the single rendered tree writer is `tree-writer.ts`.       |
| Independent agent feedback | None. The user did not request sub-agents, and current policy forbids unrequested delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Git baseline               | The clean branch `work-v0.0.9beta-yr-0718` and `legacy-remote/work-v0.0.9beta-yr-0718` both pointed to `201907f89c6a795bced6088ba8a8b6a7cb5a3c81`. A no-diff pre-change push entered the repository hook and exceeded the command runner's 120-second window during typecheck without reporting a code failure; the remote already contained the same commit.                                                                                                                                                                                                                                                                                                          |

## Causal chain

The visible symptom is a 09:28:44 human answer appearing above the Mission flow
that causally preceded it. The direct trigger is in
`interactionToCardSeeds`: both the request seed and the resolved response seed
use `interaction.orderKey`, even though the response has a later
`time.resolved`.

The deeper contract defect exists in both backend paths:

1. persisted Task interactions expose only their creation `orderKey` from
   `viewInteraction`, despite storing `time_resolved`;
2. standalone Mission `question.replied` and `question.rejected` events are
   mapped by `session-mirror.ts` to the original request identifier's order
   key, and `handleStandaloneQuestion` retains no response-specific order key;
3. `regroupTimelineSegments` considers only messages when deciding whether
   adjacent messages can share one card. A question between two Mission
   messages therefore does not split the card, so the renderer cannot insert
   the interaction between those messages: `ChatBubble` renders child
   interactions only after the complete parent card body.

The existing top-level sorter is already correct: it sorts every surfaced card
by backend `orderKey`. Previous message-card chronology coverage proves ordinary
messages but contains no resolved interaction between otherwise-adjacent
messages. Consequently, changing CSS, scroll behavior, or the final sort would
not root-correct the defect; the missing response identity and segment boundary
must be repaired before rendering.

## Call-site disposition

| Surface                                 | Decision                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `timeline/order.ts`                     | Add one canonical interaction-response order-key constructor so persisted Task interactions and standalone Mission question replies cannot invent parallel identifier suffixes.                                                                                                                                                                                    |
| `question/index.ts`                     | Stamp one positive `timeResolved` at the actual answer/reject publication boundary, including automatic rejection, and carry it on `Question.Event.Replied` / `Rejected`.                                                                                                                                                                                          |
| `engine/interaction.ts`                 | Persist the exact question-event `timeResolved`; permission resolution retains its existing single writer and still projects a response key from its persisted resolution time.                                                                                                                                                                                    |
| `protocol/session-mirror.ts`            | Keep ask events on the request order key; map reply/reject events to the canonical response order key derived from the source-stamped `timeResolved`. No frontend clock or alternate replay store is introduced.                                                                                                                                                   |
| `engine/model.ts` and `engine/store.ts` | Project optional `responseOrderKey` only for resolved interactions from `time_resolved`; pending interactions continue to expose only their request `orderKey`. Regenerate OpenAPI and SDK artifacts.                                                                                                                                                              |
| `overlay/store/board.ts`                | Require resolved/rejected interactions to carry both positive `time.resolved` and canonical `responseOrderKey` as one data-integrity contract.                                                                                                                                                                                                                     |
| `overlay/utils/interaction.ts`          | Keep request seeds on `orderKey`; require response seeds to use `responseOrderKey`. Preserve current System presentation and response text.                                                                                                                                                                                                                        |
| `overlay/services/tree-writer.ts`       | Retain the standalone request order key, store the response event's key separately, and treat every visible request/response key as a message-segment boundary. Existing `sessionTurnCardAtOrBefore` then attaches each interaction to the correct preceding turn without a new renderer or placement source.                                                      |
| Unit/server tests                       | Cover canonical response-key construction, source-stamped reply/reject time, Task read-model projection, OpenAPI shape, standalone Mission reply projection, interaction segment splitting, negative missing-key data, and unchanged pending behavior.                                                                                                             |
| Browser acceptance                      | Add a focused desktop Mission conversation fixture with a preceding Mission turn, a question, a human response, and a subsequent Mission turn. Assert exact Document Object Model (DOM) vertical order, response timestamp ownership, no merged cross-interaction Mission card, clean console/network state, and capture the current-goal conversation screenshot. |
| Spec indexes/current architecture       | Index this record and update the current panel-reactivity ordering contract to state that visible interaction request/response keys break message-card adjacency.                                                                                                                                                                                                  |

## Verification plan

1. Commit and push this Recall/plan before source implementation.
2. Add focused failing tests that reproduce the shared request key and merged
   Mission segment, then implement the canonical backend response projection.
3. Regenerate the SDK/OpenAPI artifacts and run the interaction, question,
   session-mirror, tree-writer, board-route, API inventory, and typecheck groups.
4. Build the current Overlay production bundle, run the focused browser test
   through the repository's Node browser runner, inspect its screenshot at
   original resolution, and iterate until the exact chronological layout is
   visually correct.
5. Run the required historical-links, product-docs single-source, document
   health, Overlay internationalization, `git diff --check`, and independent
   source/diff review. Record exact results below, commit with the
   `dsw-33987` prefix, and push `legacy-remote/work-v0.0.9beta-yr-0718` without
   bypassing hooks.

## Result

Implemented the single-source chronological contract end to end:

- `Question.Event.Replied` and `Question.Event.Rejected` now carry the exact
  positive resolution time produced by the question owner. The engine persists
  that same value instead of sampling a second clock.
- `timelineInteractionResponseOrderKey` is the only constructor for response
  positions. Persisted Task interaction views expose `responseOrderKey`, while
  standalone session-mirror reply/reject events use the same constructor.
- Overlay board validation rejects a resolved interaction without its backend
  response key. `interactionToCardSeeds` keeps the request at creation order and
  puts the answer at response order.
- Visible interaction request and response keys now split otherwise-adjacent
  message segments. The existing owner lookup therefore attaches both items to
  their exact preceding Mission turn, and the later Mission message renders in
  a new card below them.
- OpenAPI and the JavaScript SDK were regenerated. The current panel
  architecture records the independent request/response placement contract.

Verification completed:

- Timeline order tests: 2 passed.
- Session mirror tests: 16 passed with a 15-second per-test ceiling; the first
  default-ceiling run exposed one environment-duration overrun at 5.36 seconds,
  and the unchanged case passed on the isolated rerun.
- Question, server route, Task Board, and interaction-model tests: 20 passed.
- Project bootstrap interaction-bridge tests: 3 passed, including equality
  between the source rejection timestamp and the persisted interaction
  resolution timestamp.
- Board invariant and full tree-writer hierarchy tests: 62 passed.
- Conversation hydrate/view and tree-writer performance tests: 26 passed. The
  10,000-delta case remained below its guard and the 500-session case completed
  in approximately 1.06 seconds.
- The focused real desktop browser test passed through the repository Node
  runner with Bun absent. It proves two distinct Mission cards and the exact
  vertical sequence: preceding Mission content, question, `overall` response,
  then the subsequent Mission content. It also verifies that the rendered child
  identities own the ask and resolution timestamps independently and that the
  page has no unexpected console or network errors.
- The current-goal screenshot
  `.scratch/interaction-response-chronology/mission-question-response.png` was
  inspected at original resolution after moving the Work Ledger tooltip away.
  The visual sequence matches the required conversation flow.
- SDK generation and typecheck passed; API route inventory passed across 31
  files; the full 12-package workspace typecheck passed; Overlay panel
  internationalization passed.
- Historical links, document health, and product documentation single-source
  tests passed: 84 tests and 1,333 assertions.
- `git diff --check` passed before final commit. A concurrent, separately owned
  right-Dock repair commit (`0a4c20979`) landed on the same branch during this
  work and was preserved; the final fetch confirmed no local/remote history
  divergence before delivery.
