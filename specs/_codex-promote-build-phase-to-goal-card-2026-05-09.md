# Promote Build Phase To Goal Card - 2026-05-09

## Recall

- `specs/new-arch/12-overlay-card-system.md` says `CardHeader.tsx` is the single card header implementation and card placement/render policy should stay centralized.
- `tree-writer.ts` routes goal-scoped `build` sessions into the `step:<goalID>:build:phase:build` phase card. That phase card is the data owner for build parts, usage, status, and `phaseSessionID`.
- `Card.tsx` currently renders every `childID` as a nested card, so the user sees a parent goal/step card plus a nested `Build` card with its own header, reply box, usage chips, and tool stats.
- User requirement: move the visible build attributes to the parent `GoalWorkflowGroup`/goal card; the nested build card itself must not show input, tool usage data, or its own shell.

## Target

- Keep the build phase card as the single data source in `cardTreeStore`.
- Render build phase body parts inline inside the parent step/goal card.
- Render build phase header metrics (status, usage, context token hints, terminal reason) on the parent step/goal card header.
- Route direct replies/cancel actions for the build session through the parent step/goal card.
- Filter the build phase out of recursive child card rendering so it has no visible nested card shell.

## Acceptance

- `step:<goalID>:build:phase:build` still exists in `cardTreeStore` and still owns build session parts.
- The visible card tree does not render a nested build phase card under the step/goal card.
- Build text/tool parts remain visible under the parent step/goal card body.
- Build usage/status/session controls surface on the parent step/goal card, not on a child `Build` card.
- Tests cover the render policy and existing tree-writer phase absorption invariants still pass.
