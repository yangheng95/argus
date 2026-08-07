# Mailbox Evidence Locator Contract Repair

## Recall

### User requirement

Repair the Mailbox surface that shows `Cannot read properties of undefined
(reading 'length')` instead of loading its messages.

### Acceptance criteria

- A canonical Mailbox page containing messages renders without entering the
  Overlay error boundary.
- The Overlay consumes the backend `evidenceLocators` field directly and does
  not retain the retired `evidenceRefs` field or add a compatibility fallback.
- Focused unit, type, real Vite browser, screenshot, documentation, second
  review, commit, and legacy remote push checks pass.

### Hard constraints

- Keep `/mailbox` as the single list source and `/mailbox/events` as change
  notification only.
- Preserve all concurrent worktree changes.
- Do not restart, refresh, close, or otherwise interfere with the user's
  running OpenCorvus or Overlay process.
- Use the existing Node browser runner for the isolated Vite acceptance.

### Sources read

- Root `AGENTS.md` supplied in the task context and the Browser control skill.
- `specs/current/architecture/07-panel-reactivity.md`.
- `2026-07-25-mailbox-notification-count-and-hover-lifecycle.md`.
- Current backend Mailbox schema/projector/routes, generated Software
  Development Kit response type, Overlay service/component/projector, and
  Mailbox unit/browser fixtures.
- The supplied failure screenshot.

### Whole-repository grep

| Surface | Call sites and disposition |
| --- | --- |
| Backend `MailboxItem.evidenceLocators` | `engine/mailbox.ts` is the canonical schema and row projector; preserve the in-progress structured-evidence conversion. |
| Generated `MailboxListResponse` | The Software Development Kit already projects the exact route response including structured evidence locators; use it as the Overlay page/item type instead of a hand-maintained duplicate. |
| Overlay `MailboxItem` | `services/mailbox.ts` owns the former duplicate interface; replace it with indexed generated response types. |
| Mailbox evidence count | `MailboxPanel.tsx` is the only production `.length` consumer; switch it to `evidenceLocators.length`. |
| Mailbox fixtures | Notification projector, concurrency, left-sidebar, and titlebar browser fixtures are the only Overlay Mailbox response constructors; update every one to the canonical field. |

No sub-agent is used because the user did not request delegation.

## Causal chain

Observable symptom: the Mailbox header and counts load, but its body is replaced
by the error boundary and Retry action.

Direct trigger: the first returned row evaluates
`item.evidenceRefs.length`; `evidenceRefs` is absent from the new route response,
so Solid rendering throws before the list can paint.

Deep cause: the backend Mailbox contract was converted from untyped string
references to catalog-backed `evidenceLocators`, while the Overlay kept a
hand-maintained response interface and renderer. The duplicate interface let
the route and consumer drift.

Why the prior path did not prevent it: the backend route tests and Overlay
fixtures validated their own independently written shapes. They did not bind
the Overlay item type to the generated `/mailbox` response, so compilation
could not expose the contract mismatch.

## Implementation plan

1. Replace the Overlay Mailbox page/item/cursor duplicates with types derived
   from the generated `MailboxListResponse`.
2. Render the canonical structured locator count and update all response
   fixtures, without a legacy-field fallback.
3. Run focused unit/type checks and the real Node/Vite Mailbox browser fixture;
   inspect the resulting screenshot and browser diagnostics.
4. Run documentation health and second-review the complete task diff.
5. Commit only task-owned paths with the `dsw-33987` prefix, fetch legacy remote, and
   push the current main delivery branch through normal hooks.

## Progress

- [x] Failure evidence, causal chain, and full call-site inventory recorded.
- [x] Contract repair and regression fixtures implemented.
- [x] Focused and visual verification complete.
- [x] Second review complete.
- [ ] Commit and legacy remote push complete.

## Verification evidence

- `bun test packages/overlay/test/mailbox-panel.test.ts
  packages/overlay/test/agent-mailbox-notification-projection.test.ts
  packages/overlay/test/mailbox-change-stream.test.ts` passes 36 tests with 258
  expectations.
- The Overlay production Vite build passes. The isolated Node browser run for
  `mailbox-concurrency-browser.test.ts` passes with 24 rendered canonical
  messages, pagination, exact-directory replacement, strict stream events, and
  no unexpected browser errors.
- `.scratch/mailbox-concurrency-browser/mailbox-launcher-count-and-hover.png`
  was inspected at 1280 by 720 pixels. The Mailbox shows message subjects,
  bodies, categories, agents, counts, and scrolling instead of the Retry error.
- The broader `mailbox-left-sidebar-browser.test.ts` loads and screenshots all
  ten messages but remains blocked by its existing hover-action opacity wait
  after the focused-open screenshot. That visual interaction assertion is
  outside the evidence-locator contract repaired here and is not reported as a
  pass.
- Overlay type checking reaches an unrelated concurrent error at
  `ChannelsPanel.tsx:414`: a callback accepting an optional boolean is supplied
  where a dialog-element callback is required. No task-owned Mailbox type error
  is reported before that blocker.
- The staged snapshot passes all 92 historical-link, document-health, and
  product-document single-source tests with 1,446 expectations.
- `git diff --check` passes, and the second review confirms no `evidenceRefs`
  fallback or parallel response interface remains in the task-owned Overlay
  Mailbox path.
