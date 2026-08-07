# Trace Event Disclosure Controls

## Context

Independent browser-evidence review found that TracePanel event rows already
have visible keyboard focus and `aria-expanded`, but the disclosure button does
not identify the raw JSON payload region it controls.

## Recall

| Source                                   | Constraint                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-trace-event-head-focus.md`   | Trace event heads are disclosure rows with visible keyboard focus, not generic action buttons.                                  |
| `ProjectLedgerGroup` disclosure controls | When controlled content is conditionally mounted, expose `aria-controls` only while expanded and give the body a matching `id`. |
| `TracePanel.tsx`                         | The raw JSON payload is the source-of-truth detail body for each trace event.                                                   |

## Evidence

| File                                     | Finding                                                                               | Decision                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `TracePanel.tsx`                         | `.trace-event-head` has `aria-expanded={open()}` only. `.trace-event-body` has no id. | Add a stable body id per row and connect it with `aria-controls` while expanded. |
| `trace-event-head-focus-browser.test.ts` | Browser fixture verifies focus and keyboard toggle, but not control relationship.     | Extend the fixture to assert `aria-controls` points to the mounted body.         |
| `primitives-panel-section.test.ts`       | Static guard already owns TracePanel row focus contract.                              | Add static assertions for the controls/body id contract.                         |

## Implementation

- Build a deterministic trace body id from event kind, timestamp, and session id.
- Add `aria-controls={open() ? bodyElementID() : undefined}` to the event head.
- Add `id={bodyElementID()}` to `.trace-event-body`.

## Acceptance

- Static guard requires `aria-controls` and body id in TracePanel.
- Browser focus fixture verifies Enter expands the row and `aria-controls`
  resolves to the visible `.trace-event-body`.
