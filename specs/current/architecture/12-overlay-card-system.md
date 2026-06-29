# 12 — Overlay Card System

> 对应代码（真源）：`packages/overlay/src/store/card-tree.ts` ·
> `packages/overlay/src/services/tree-writer.ts` · `packages/overlay/src/components/Card.tsx` ·
> `packages/overlay/src/components/CardHeader.tsx` ·
> `packages/overlay/src/utils/card-tree.ts` · `packages/overlay/src/utils/card-color.ts` ·
> `packages/opencorvus/src/workbench/board.ts`

Overlay cards are plain store-backed data projected by the tree writer and
rendered by shared card components. Current code uses a `CardNode` data
protocol rather than frontend class instances.

## Current Contract

| Surface                   | Responsibility                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `store/card-tree.ts`      | Defines the card tree store and current `CardNode` shape.                                            |
| `services/tree-writer.ts` | Creates, updates, nests, orders, and removes store-backed cards from backend events and board state. |
| `Card.tsx`                | Renders the common card shell, parts, payload-specific body sections, and nested children.           |
| `CardHeader.tsx`          | Owns shared header layout, status/accent affordances, and card actions.                              |
| `utils/card-tree.ts`      | Provides active render helpers and type re-exports used by components/tests.                         |
| `utils/card-color.ts`     | Owns deterministic accent/color helpers.                                                             |

## Card Identity

Cards must use stable IDs derived from backend ownership facts:

- session cards use session IDs;
- goal containers use goal IDs;
- goal step and phase cards use backend workflow step/phase IDs;
- interaction and synthetic cards use message/request IDs.

Render code must not generate identity from transient DOM state or array
position. Any new store-backed card type must be projected by
`tree-writer.ts`.

## Rendering Rules

- `Card.tsx` is the root recursive renderer for store-backed cards.
- `CardHeader.tsx` remains the shared title/action/status surface.
- Tool-call cards may be constructed as transient render objects inside a
  parent card body; they do not enter `cardTreeStore` unless a backend event
  explicitly promotes them.
- Payload-specific UI must be keyed by typed payload fields already present on
  the `CardNode`; it must not create a second card model.

## Writer Rules

`tree-writer.ts` is the single mutation surface for `cardTreeStore`.

It owns:

- message and session materialization;
- goal/step/phase hierarchy;
- interaction placement;
- synthetic pending entries;
- top-level order rebuilds;
- cleanup when backend state changes.

Components may read the store and dispatch user actions. They must not mutate
store-backed card structure directly.

## Constraints

- No unknown-card fallback renderer is allowed for store-backed cards.
- No second `CardNode` truth source is allowed.
- No component-local placement or sorting policy is allowed.
- No future Shell/Variant/Payload redesign is documented here as current unless
  code implements it.

## Verification

- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts`
- `bun test packages/overlay/test/tree-writer-hierarchy.test.ts`
- Browser visual/stress tests under `packages/overlay/test/browser/**`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
