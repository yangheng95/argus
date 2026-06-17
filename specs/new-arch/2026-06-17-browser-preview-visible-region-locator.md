# Browser Preview Visible Region Locator

## Problem

Region comparison implementation capture accepted a matching DOM node as a valid
region even when the node was hidden or had a zero-size rectangle. The sidecar
used `querySelector().getBoundingClientRect()` for selector-like locators and
coerced width/height with `Math.max(1, ...)`, so hidden or collapsed nodes could
be persisted as completed visual evidence.

## Call Points

| Surface | File | Decision |
| --- | --- | --- |
| Region sidecar locator resolution | `packages/opencorvus/src/browser-preview/evidence-runner.ts` | Use Playwright locators, require `isVisible()`, and require non-zero bounding boxes before returning a region. |
| Region comparison orchestration | `packages/opencorvus/src/browser-preview/region-comparison.ts` | Keep failed sidecar regions as failed comparison evidence; do not materialize crops for hidden implementation regions. |
| Region comparison tests | `packages/opencorvus/test/browser-preview/region-comparison.test.ts` | Add real browser coverage for hidden and zero-size implementation nodes. |

## Implementation

1. Replace DOM-only selector lookup in the region comparison sidecar with a
   single `locatorFor(page, binding.locator)` helper.
2. Return `null` unless the locator is visible and `boundingBox()` has positive
   width and height.
3. Remove `Math.max(1, ...)` from the region box conversion path so zero-size
   elements cannot become 1px completed evidence.
4. Add tests for `display:none` and zero-size regions.

## Verification

- `bun test packages/opencorvus/test/browser-preview/region-comparison.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check` on the changed files.
