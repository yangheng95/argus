# Trace Panel Icon Guard Retirement

Date: 2026-06-18

## Problem

The icon coverage guard still excludes `TracePanel.tsx`, even though
`TracePanel` now renders its action and disclosure icons through
`components/Icon.tsx`. The same guard also carried an
`EvaluationCriteriaPanel.tsx` exclusion in the current working tree history, but
that component file no longer exists.

Keeping either exception weakens the single icon source promised by
`2026-06-17-icon-html-single-source.md`: future character-icon regressions in
TracePanel could bypass `flat-redesign-icon-coverage.test.ts`, and a dead file
exception makes the guard look broader than it actually is.

## Recall

- `2026-06-17-icon-html-single-source.md` made `components/Icon.tsx` the only
  icon registry and extended `flat-redesign-icon-coverage.test.ts` to reject
  character-icon callsites.
- The current `TracePanel.tsx` uses `<Icon name="caret-down" />`,
  `<Icon name="chevron" />`, `<Icon name="copy" />`, `<Icon name="refresh" />`,
  and `<Icon name="close" />`.

## Call Points

| Surface                               | Evidence                                                                 | Required action                                                               |
| ------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `flat-redesign-icon-coverage.test.ts` | `EXCLUDED` still keeps `TracePanel.tsx` out of the character-icon sweep. | Remove the exclusion so the existing forbidden glyph guard covers TracePanel. |
| `TracePanel.tsx`                      | Current controls already use the Icon primitive.                         | No production code change; keep the component covered by the guard.           |
| `EvaluationCriteriaPanel.tsx`         | The file does not exist.                                                 | Do not preserve dead exclusions for nonexistent components.                   |

## Acceptance

- `flat-redesign-icon-coverage.test.ts` scans `TracePanel.tsx`.
- The icon guard passes without component exclusions for TracePanel or the
  nonexistent EvaluationCriteriaPanel.
- A deliberate `>x</button>`-style character icon in TracePanel would be caught
  by the existing forbidden-pattern loop.
- Overlay typecheck remains clean.
