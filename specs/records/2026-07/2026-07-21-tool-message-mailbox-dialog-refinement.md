# Tool, Message, Mailbox, and Dialog Refinement

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request                     | Align Tool names (`bash` / `read` / `glob`) with their details; reveal Tool duration only on hover like start time; place each message-run timestamp on the final message line and suppress it after a Tool; add Mailbox delete and batch delete; increase dialog rounding once in the shared primitive.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Acceptance criteria              | Tool title/detail typography has one font size and vertical rhythm. Tool start and duration are absent at rest and appear together on hover or keyboard focus. Each narrative message timestamp occupies its final text line as an overlay without reserving space; later Tool rows do not inherit or relocate that timestamp, and Tool-only messages render none. Mailbox supports confirmed single deletion and selected multi-item deletion through one project-scoped backend projection, with deleted rows absent from active/archived counts. Every Dialog consumer inherits the larger non-fullscreen radius from the shared primitive. Focused unit/server tests, generated API/docs checks, a Node-launched real browser fixture, task-scoped screenshots, and visual review pass. |
| Hard constraints                 | Preserve persisted Tool `state.time.start/end` as the only timing source; do not add a frontend timer or second renderer. Preserve protocol source events and express Mailbox deletion as the existing append-only acknowledgement projection, not physical task/history deletion. Keep Kobalte Accordion/Dialog and the canonical Checkbox/Button primitives. Desktop-only. Do not restart or alter the user's running OpenCorvus/Overlay. Start Playwright with Node. Preserve concurrent landing-page, Settings-plan, and Tool-tooltip-removal worktree changes and stage only this task's files/hunks.                                                                                                                                                                                  |
| Sources read                     | `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel-reactivity.md`; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-20-desktop-left-rail-and-mailbox-refinement.md`; `2026-07-20-left-sidebar-mailbox-mark-all-read.md`; `2026-07-21-tool-tooltip-removal.md`; Tool/Card/Mailbox/Dialog production sources and their focused unit/server/browser tests.                                                                                                                                                                                                                                                                                                                                                                                               |
| Whole-repository search evidence | Production Tool rows are rendered only through `CardParts -> toolToCardNode -> Card -> CardHeader/CardHeaderChrome`; Tool title/detail geometry is owned by `styles/surfaces/card.css`. Message boundaries/timestamps are owned only by `utils/card-message-run.ts`, `CardParts.tsx`, and the `.card-message-*` rules. Mailbox transport, folding, routes, UI, and styles are owned by `services/mailbox.ts`, `engine/mailbox.ts`, `server/routes/mailbox.ts`, `MailboxPanel.tsx`, and `mailbox.css`; API generation owns SDK/OpenAPI/API docs. Every feature dialog adopts `components/ui/Dialog.tsx`, whose shared `.dialog-form` rule in `styles/surfaces/dialog.css` owns the radius. The disposition table below lists each affected call site.                                        |
| Independent agent feedback       | None. The user did not request sub-agents, and current collaboration policy does not authorize unrequested delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Git baseline                     | Initial inspection observed clean `4a853f623`. A concurrent workflow then rewound the branch to `d657bf323`, left landing-page changes dirty, and advanced/pushed `3fbfda7f3` while adding Settings and Tool-tooltip plans. Reflog/diff evidence was captured. This task will not reset, restore, overwrite, or stage those unrelated changes and will re-fetch/reconcile before delivery.                                                                                                                                                                                                                                                                                                                                                                                                  |

## Causal findings

The Tool mismatch is one CSS ownership defect: the Tool title forces
`--ui-font-small` while the adjacent monospace detail derives from the larger
`--card-sub-size`, and only the detail declares its line height. The timing
source is already correct; only presentation differs because Tool start uses a
hover/focus display rule while `.card__duration` remains visible at rest.

Message timestamps already use absolute positioning, so no durable data-model
change is needed. Their negative bottom offset places them below the content
line, while rendering the timestamp after the whole flattened run lets later
Tool-only messages relocate it. The message-run partition knows the exact
boundary and final narrative text owner; projecting that part ID lets `TextPart`
host the absolute, non-reserving timestamp on its own final line. Tool rows never
receive or relocate it.

Mailbox archive is not deletion: archived items remain in a second view and in
its count. The durable projection already folds append-only acknowledgement
events, so deletion belongs as a terminal acknowledgement action that excludes
the source row from both views while leaving task/protocol evidence intact. A
single DELETE and one atomic multi-ID DELETE route share the same engine method;
the frontend selection model submits exact canonical message IDs once.

Real-browser batch selection exposed a shared primitive defect: `Checkbox`
forced the Kobalte Root to a native `label`, so clicking its Control performed
one Kobalte toggle followed by the label's implicit input click and immediately
reversed the value. The canonical primitive now uses Kobalte Root and
`KobalteCheckbox.Label` as intended, fixing every existing consumer rather than
adding Mailbox-specific click handling.

Dialog rounding is duplicated by neither hosts nor feature dialogs. The shared
`.dialog-form` shell is the canonical primitive presentation point; changing its
radius once updates all non-fullscreen consumers while the fullscreen override
remains square.

## Whole-repository call-site disposition

| Call site                                                              | Disposition                                                                                                                                                          |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles/surfaces/card.css` Tool title/subtitle rules                   | Use one font-size and line-height; reveal Tool duration with the existing start-time hover/focus contract.                                                           |
| `CardHeaderChrome.tsx`, `utils/card-timing.ts`                         | Preserve canonical duration calculation and persisted timestamps; absorb concurrent tooltip retirement if it lands before implementation.                            |
| `utils/card-message-run.ts`                                            | Project the exact final narrative text part that owns each boundary timestamp.                                                                                       |
| `CardParts.tsx`, `TextPart.tsx`, and `.card-message-time`              | Render the timestamp inside its owning text body and place it on the final content line as a non-reserving overlay.                                                  |
| Tool/message focused unit tests and message chronology browser fixture | Cover matching computed typography, rest/hover/focus timing visibility, overlay geometry, and absence of timestamps inside Tool rows.                                |
| `engine/model.ts`, `engine/mailbox.ts`                                 | Add terminal `delete` acknowledgement folding and one atomic multi-ID deletion method; deleted source rows leave both views/counts but task history remains.         |
| `server/routes/mailbox.ts`                                             | Add documented `DELETE /mailbox/:messageID` and `DELETE /mailbox` batch routes before the dynamic update route where relevant.                                       |
| `services/mailbox.ts`                                                  | Add strict single/batch delete transport; retain existing read/archive/restore transport.                                                                            |
| `MailboxPanel.tsx`                                                     | Add shared Checkbox selection, select-visible control, confirmed single delete, confirmed selected delete, pending/error handling, and scope-safe selection cleanup. |
| `styles/surfaces/mailbox.css`, Mailbox unit/browser tests              | Preserve compact desktop density while adding selection/actions; exercise real delete requests, keyboard semantics, confirmation dialog, and screenshots.            |
| i18n English/Chinese                                                   | Add Mailbox selection/delete/confirmation labels only.                                                                                                               |
| generated SDK/OpenAPI/API docs                                         | Regenerate from route source; do not hand-edit contracts.                                                                                                            |
| `styles/surfaces/dialog.css`, Dialog primitive tests                   | Change the one shared non-fullscreen shell radius to `--oc-radius-xl`; keep fullscreen at zero.                                                                      |
| current architecture and spec indexes                                  | Record Tool/message presentation and durable Mailbox deletion semantics; update both indexes and health tests.                                                       |

## Implementation and verification plan

1. Add focused failing assertions for Tool typography/timing and message-run timestamp eligibility/geometry, then update the shared card owners.
2. Add backend deletion-fold and route tests for single, atomic batch, idempotency, foreign namespace rejection, count removal, and preserved source/task evidence.
3. Add frontend transport/selection/delete contracts using Checkbox/Button/Dialog primitives and localized confirmation copy.
4. Increase the shared Dialog primitive radius and assert every non-fullscreen consumer inherits it.
5. Regenerate OpenAPI, SDK, and API docs; update current architecture and spec indexes.
6. Run focused tests, typecheck, i18n, route/docs/document-health checks, build, and Node browser scenarios. Inspect task-scoped Tool/message/Mailbox/Dialog screenshots and iterate until visually correct.
7. Re-fetch git-cc, reconcile any concurrent commits without overwriting dirty work, review the complete scoped diff, commit only task-owned files/hunks with `dsw-33987`, push `myhexin`, and verify local/remote equality.

## Progress

- [x] Read constraints and relevant architecture/history.
- [x] Enumerated production, test, generated-contract, and documentation call sites.
- [x] Implemented Tool/message presentation behavior with regression coverage.
- [x] Implemented durable single/batch Mailbox deletion with regression coverage.
- [x] Updated the shared Dialog primitive radius with regression coverage.
- [x] Completed generated artifacts, focused/full checks, real browser screenshots, visual review, and second review.
- [x] Commit the scoped diff, push it to git-cc, and verify local/remote equality.
