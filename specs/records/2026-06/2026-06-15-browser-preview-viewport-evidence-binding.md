# Browser preview viewport evidence binding

## Problem

Browser preview persisted evidence is viewport-specific, but the target response
exposes only one `latestEvidenceID` for the whole target. When mobile evidence
is the newest persisted artifact, reopening the overlay on the default desktop
tab can load and display mobile evidence under the desktop tab.

## Call-point sweep

| Call point                                         | Decision                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/browser-preview/persist.ts`                   | Replace target-only latest evidence lookup with a viewport-keyed latest evidence map.                                                             |
| `src/browser-preview/target.ts`                    | Replace `latestEvidenceID` with `latestEvidenceIDs`. Target resolution passes a per-viewport map.                                                 |
| `src/browser-preview/verification-core.ts`         | Capture responses return `target.latestEvidenceIDs` for every captured viewport.                                                                  |
| `src/server/routes/browser-preview.ts`             | Existing target route returns the updated target schema; no new route.                                                                            |
| `packages/overlay/src/services/browser-preview.ts` | Replace target type field with `latestEvidenceIDs`.                                                                                               |
| `BrowserPreviewPanel.tsx`                          | Load persisted evidence for the selected viewport only and ignore stale evidence whose `targetID` or `viewportID` does not match the current tab. |
| `packages/sdk/openapi.json` and generated SDK      | Regenerate after schema change.                                                                                                                   |

## Design

Persisted evidence remains a task-scoped artifact. The target response now
contains:

```ts
latestEvidenceIDs?: Partial<Record<"desktop" | "tablet" | "mobile", string>>
```

Overlay resource loading uses `latestEvidenceIDs[viewportID()]` as the resource
key. Auto-capture runs only when at least one configured viewport lacks persisted
evidence for the current target.

## Verification

- Server route test: persist desktop and mobile evidence where mobile is newer;
  assert target resolution returns both IDs in the correct viewport slots and no
  single `latestEvidenceID`.
- Overlay browser test: provide different persisted desktop/mobile evidence and
  assert the default desktop tab renders desktop evidence, then switching tabs
  renders mobile evidence.
- Existing browser preview verification tests updated to assert the per-viewport
  map.
