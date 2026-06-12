# Integrity Verdict Findings Layout

Date: 2026-06-11

## Problem

Integrity verdict findings render severity, title, description, repair text, and manifest metadata as sibling inline
items. Long finding text can shrink the description column until words wrap vertically, making the verdict unreadable.

## Repository Survey

| Surface                     | File                                                        | Decision                                                                                                               |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Integrity verdict component | `packages/overlay/src/components/IntegrityCard.tsx`         | Keep the existing integrity payload contract, but render each finding as a severity tag plus a vertical content block. |
| Integrity CSS owner         | `packages/overlay/src/styles/surfaces/inspector.css`        | Move finding text, repair, and manifest metadata into the content column so long text owns the available width.        |
| Static rendering tests      | `packages/overlay/test/integrity-card-rendering.test.ts`    | Assert the finding content wrapper exists and carries description, repair, and manifest metadata.                      |
| Surface ownership tests     | `packages/overlay/test/overlay-architecture-guards.test.ts` | Add the new finding wrapper class to the inspector-surface ownership guard.                                            |

## Intended Behavior

Integrity findings must remain flat rows with the existing left verdict rail, but their body must stack readable text
vertically:

- Severity tag stays in a fixed-width leading column.
- Title and description use the remaining row width.
- Repair text and manifest metadata appear under the finding text, not as additional flex siblings.

No backend verdict schema or integrity event contract changes are required.
