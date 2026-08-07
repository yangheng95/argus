# Browser Preview Live Frame Application Role

Date: 2026-06-19

ARIA means Accessible Rich Internet Applications. GUI means Graphical User
Interface. DOM means Document Object Model.

## Recall

- `AGENTS.md` requires root-cause fixes, no fallback paths, and tests for code
  changes.
- `2026-06-17-browser-preview-visual-stress-benchmark.md` makes
  `BrowserPreviewPanel` the owner of task-scoped target loading, live screenshot
  frames, and live input routing.
- `2026-06-18-browser-preview-repair-tool-algorithm-pressure-benchmark.md`
  requires the browser preview repair toolchain to stay evidence-backed and
  task-scoped, with no iframe or local preview source.

## Evidence

| Surface                                 | Evidence                                                                                                                                                   | Decision                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserPreviewPanel.tsx`               | `.browser-preview-live-frame` is focusable with `tabIndex={0}` and has a visible focus state.                                                              | It needs an explicit interactive role.                                                                                          |
| `BrowserPreviewPanel.tsx`               | `handleLivePointerDown`, `handleLiveWheel`, and `handleLiveKeyDown` forward pointer, wheel, and non-Tab/Escape keyboard input to the live preview service. | Use `role="application"` because the focused region behaves as a remote browser input surface, not as a static image or figure. |
| `browser-preview-visual-stress.test.ts` | Existing stress coverage already focuses `.browser-preview-live-frame`, presses `A`, and asserts click/wheel/key live input routing.                       | Extend that real browser path to assert role, focus, and accessible name before key forwarding.                                 |

## Root Cause

The live frame gained keyboard input forwarding while retaining static
`figure` semantics. A keyboard user could focus the region, but assistive
technology would not be told that the region captures application-like input.

## Fix Plan

1. Add `role="application"` to `.browser-preview-live-frame`.
2. Keep the existing `aria-label` as the accessible name.
3. Add static and browser test coverage without changing live input routing,
   screenshot sources, target scope, or evidence capture.

## Acceptance

- The live frame remains focusable and named.
- The live frame exposes `role="application"`.
- Existing click, wheel, and keyboard live input routing still passes in the
  browser visual stress test.
