# 2026-05-24 - Overlay Integrity Card Readability and Performance

## Evidence

- `packages/overlay/src/components/IntegrityCard.tsx` renders
  `teamReportMarkdown` as an always-mounted `<pre>`. Large integrity team
  reports therefore enter layout and paint on initial card render, even when
  the operator only needs the verdict and reviewer summaries.
- The reviewer team is currently one flat `<ul>` where each row is just
  `reviewerID: summary`. The data already carries `reviewerID`, `scope`,
  `verdict`, `evidence`, `findings`, and `openQuestions`, but the UI does not
  give each reviewer a stable visual identity.
- Normal conversation message grouping is already owned by
  `regroupTimelineSegments` in `packages/overlay/src/services/tree-writer.ts`
  and follows the existing message-turn agent-card design. This change does
  not alter general message card identity.

## Decision

- Keep integrity as one real `stage="integrity"` agent card.
- Render each integrity reviewer as a compact reviewer card inside that
  integrity agent card, keyed by the backend reviewer payload.
- Keep the full team report available, but do not mount the long report body
  until the user opens the report detail.
- Do not introduce a second integrity data source or synthetic messages.

## Validation

- Add a static regression test that prevents the full report from returning
  to an always-mounted `<pre>` and verifies reviewer-card rendering.
- Run the targeted overlay tests for integrity rendering and hierarchy.
