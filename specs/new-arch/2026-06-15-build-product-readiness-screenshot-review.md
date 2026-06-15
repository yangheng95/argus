# Build Product Readiness Screenshot Review (2026-06-15)

## Problem

Build already requires frontend screenshot review, but the current wording is
mostly engineering QA: layout, spacing, runtime errors, and visual mismatch. It
does not explicitly require the Build agent to judge the screenshot like a
product manager before reporting success.

That leaves room for premature code and premature design: a page can compile,
render, and even have a screenshot, while still looking like an unfinished draft,
fake data sketch, low-fidelity placeholder, or incomplete generated handoff.

This must be fixed in the Build agent's own execution contract. The fix is not a
host gate and does not replace Visual QA or integrity. Build owns its own
product-readiness self-review before `report_build_result(status="passed")`.

## Call Point Inventory

| Surface | Current behavior | Change |
| --- | --- | --- |
| `packages/opencorvus/src/prompt/core/build-core.txt` | Requires frontend screenshot inspection but not an explicit product-manager readiness verdict. | Add a product-readiness review section: inspect screenshots as a product manager, reject premature code/design, and fail or keep iterating when the deliverable is not product-grade. |
| `packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts` | Tests visual evidence loop and random ports. | Add regression assertions for product-manager screenshot review, product-grade deliverables, and premature implementation/design blockers. |

## Acceptance

- Build prompt explicitly requires product-manager screenshot review for
  frontend/browser-visible work.
- Build prompt states that product-grade deliverables cannot look like
  unfinished generated drafts.
- Build prompt instructs Build to block `status="passed"` for premature code,
  premature design, fake/placeholder visuals, missing primary workflows, or
  unshippable first-viewport/product surfaces.
- Tests pin the new language.
