# 2026-06-17 Card Header Action Rhythm

## Problem

The card header action rail can render model label, context estimate, actual usage,
inspect, and rewind as one flat inline row. When all five are present, textual
metadata and icon actions share the same visual weight and spacing. The result is
an unbalanced right edge: icons look detached from the labels, while the metadata
competes with the title row.

## Call Point Inventory

| Area                         | Evidence                                                                                                                                                                       | Decision                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Non-message card headers     | `packages/overlay/src/components/CardHeader.tsx` renders `.card__actions`, `.card__model-hint`, `.card__token-hint`, `.card__usage-hint`, `.card__trace`, and `.card__rewind`. | Group textual metadata separately from icon controls in the same header source.                               |
| Message/agent bubble headers | `packages/overlay/src/components/ChatBubble.tsx` renders the same metadata and control classes inside `.chat-bubble__actions`.                                                 | Apply the same grouping so agent bubbles keep the same rhythm.                                                |
| Shared card chrome CSS       | `packages/overlay/src/styles/surfaces/card.css` owns metadata and icon button visual treatment.                                                                                | Add shared `.card__meta-actions` and `.card__control-actions` rules without raw colors or a second token set. |
| Bubble header layout CSS     | `packages/overlay/src/styles/surfaces/chat-bubble.css` owns `.chat-bubble__actions` wrapping behavior.                                                                         | Reuse the shared groups and keep bubble-specific alignment only.                                              |
| Static tests                 | `packages/overlay/test/card-header-chrome.test.ts` and `packages/overlay/test/chat-bubble.test.ts` pin header structure.                                                       | Add assertions for grouped meta/control rails.                                                                |
| Browser visual stress        | `packages/overlay/test/browser/rewind-visual-stress.test.ts` already verifies no header/rewind overlap and produces screenshots.                                               | Extend DOM checks to ensure meta/control groups stay separated and bounded.                                   |

## Fix Plan

- Keep one visible header rail.
- Split the rail into:
  - `.card__meta-actions`: model, context token estimate, usage.
  - `.card__control-actions`: inspect, session model settings, cancel, rewind.
- Give the control group a subtle inline divider sourced from existing tokens, so
  actions read as controls rather than another metadata chip.
- Use flex wrapping only at the group boundary. Text metadata may wrap before icon
  controls overlap or drift outside the viewport.
- Do not add raw colors, `--tv-*`, or parallel visual tokens.

## Acceptance

- Static tests prove both header implementations use the grouped structure.
- Browser visual stress confirms no overflow and no control overlap.
- Real screenshot evidence is produced from the overlay browser fixture.
