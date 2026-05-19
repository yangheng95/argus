# Decision - integrity owns final acceptance review

Date: 2026-05-19

## Problem

Disabling the `deliver` workflow gate is not enough. The retired delivery path
still owns the acceptance prompt, runtime/visual verification tools,
`submit_verdict` schema, overlay review card, and notification semantics. That
leaves two conflicting surfaces: `integrity` can complete the workflow while
the actual acceptance-review contract still lives under `delivery`.

## Decision

Promote `integrity` into the final acceptance reviewer. The post-build
integrity session must own both:

- the existing multi-dimension requirement / graph / hallucination / solution
  integrity review; and
- the delivery-style acceptance review: startup/runtime/frontend/visual
  evidence, tool-call evidence, deferred checks, and actionable rejection
  details.

`deliver` remains disabled as a runtime workflow tool. New workflow runs must
not emit `delivery.review.completed` as the final review surface. The overlay
should render acceptance-review details inside the integrity card produced by
`integrity.review.completed`.

## Hard Boundaries

- No replacement host gate. No pre-session runtime/script guessing, no host
  arbiter, no hidden rejection outside the integrity session.
- Integrity does not edit files. Delivery's old narrow repair lane is not
  inherited. Rejections produce evidence for orchestrator-directed build,
  modify_goal, architect, restart, fail_task, or question.
- Every final acceptance claim must be supported by evidence generated or read
  from inside the integrity session tool transcript.
- Legacy delivery artifacts may remain readable for history/debugging, but
  they are not the new acceptance authority.

## Required Implementation Shape

- Factor the delivery acceptance prompt into an integrity-owned acceptance
  prompt fragment with delivery identity and host-arbiter language removed.
- Add a structured integrity acceptance verdict carrying:
  `accepted/rejected`, summary, startup verification, frontend check, deferred
  checks, tool-call evidence, and rejection details.
- Extend `IntegrityResult`, persisted `integrity_attempt`, and
  `integrity.review.completed` with the acceptance verdict.
- Reuse/genericize delivery verification tools only as integrity-session tools;
  exclude `edit_file`, `write_file`, and `run_integrity_review`.
- Merge delivery review UI into the integrity card; do not create a new
  delivery-review card for the final path.
- Make `integrity.review.completed` notify as urgent/badged for non-pass or
  rejected acceptance, and informational for full pass/accepted.

## Test Expectations

- `deliver` and `publish_delivery` remain disabled.
- Integrity cannot accept without the required acceptance verdict.
- Accepted integrity requires acceptance verdict `accepted`; rejected
  acceptance forces aggregate `needs_correction`.
- Overlay renders acceptance details from `integrity.review.completed`.
- Overlay no longer requires `delivery.review.completed` for the final review
  path.
