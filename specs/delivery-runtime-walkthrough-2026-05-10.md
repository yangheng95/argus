# Delivery Runtime Walkthrough Spec

Date: 2026-05-10

## Purpose

Delivery runtime evidence must verify that browser-delivered work is not only
buildable, but also starts, renders, and satisfies acceptance scenarios through
real browser walkthroughs. This closes the gap where a chat/login surface could
render a blank shell while deterministic command checks still passed.

## Implementation Surface

- `packages/opencorvus/src/delivery/checks/runtime-evidence.ts` maps runtime
  capture layers into explicit violations and records scenario walkthrough
  evidence.
- `packages/opencorvus/src/delivery/checks/walkthrough/*` translates Gherkin
  acceptance scenarios into a small executable browser DSL and runs those steps
  with Puppeteer.
- `packages/opencorvus/src/delivery/checks/project-gate.ts` turns walkthrough
  results into separate runtime flow entries keyed by acceptance spec id.
- Delivery prompt, agent, surface detection, and orchestrator handoff use
  `acceptance_scenarios` as the single source for scenario-driven runtime work.

## Arbitration Decisions

- A.1: click waits for possible navigation with a bounded Puppeteer
  `waitForNavigation` started before the click, so submit/login flows can settle
  before the next assertion.
- A.2: `assertPath` uses substring matching. The DSL contract is intentionally
  scenario-level path containment, so `/chat` matches `/chat/abc123`.
- A.3: `fill` focuses the field, selects existing content with Control+A,
  clears it with Backspace, and then types the requested value.
- A.4: `assertSelector` supports optional `present: false`; omitted `present`
  still means the selector must exist.
- A.5: translation prompt includes worked examples for login-to-chat and
  negative selector assertions.
- B.1: rejection details now carry optional `check_id`, and advisory-only
  rejection detection uses only that structured field.
- C.1: empty `walkthrough_park/` was dead workspace residue and was removed.
- C.2: this file restores the missing spec record and includes the second-round
  arbitration decisions.
- D: commit strategy is three semantic commits for runtime layer evidence,
  scenario walkthrough runtime gating, and advisory verdict semantics.

## Validation

Targeted tests must cover:

- Runtime capture layer violation mapping and failed walkthrough evidence.
- Walkthrough DSL navigation, path containment, field clearing, negative
  selectors, prompt examples, and runner evidence.
- Delivery output handling for `advisory_failed`, structured `check_id`
  attribution, and retry feedback preservation.
