# Browser Preview Glyph Render Robustness

Date: 2026-06-17
Status: implementation plan

## Acronyms

- API: Application Programming Interface, the backend route or module contract.
- CJK: Chinese, Japanese, and Korean text coverage; this plan focuses on visible unified ideograph glyphs that commonly render as tofu boxes when font coverage is missing.
- DOM: Document Object Model, the browser tree inspected by Playwright.
- PNG: Portable Network Graphics, the screenshot format persisted as browser preview evidence.
- UI: User Interface, the visible operator surface.

## Problem

The browser preview evidence runner can currently return a nonblank PNG and
healthy DOM/HTTP/asset/runtime layers while visible CJK text is painted as tofu
boxes. That is not a page-load failure and not a generic Playwright screenshot
algorithm failure; it is a missing glyph coverage problem that the evidence
contract does not diagnose.

Observed local isolation:

- A controlled page rendered through the same Node sidecar runtime, system
  Chrome, and `BrowserRuntime.defaultLaunchArgs()` produced readable Chinese
  text in `.scratch/render-cjk-sidecar/sidecar-cjk.png`.
- Therefore the local screenshot algorithm is capable of rendering CJK text.
- The product runner still lacks a layer that proves visible CJK text has glyph
  coverage before the screenshot is accepted as runtime evidence.

## Call Point Sweep

| Surface                    | File                                                               | Decision                                                                                             |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Runtime capture contract   | `packages/opencorvus/src/runtime/capture-contract.ts`              | Add a first-class `glyph` runtime layer instead of hiding missing glyphs under `pixel` or `dom`.     |
| Browser preview runner     | `packages/opencorvus/src/browser-preview/evidence-runner.ts`       | Collect visible CJK glyph diagnostics in the Node sidecar and fail `glyph` when coverage is missing. |
| Runtime visual page helper | `packages/opencorvus/src/runtime/visual-page.ts`                   | Keep the shared runtime capture contract aligned with browser preview captures.                      |
| Browser preview unit tests | `packages/opencorvus/test/browser-preview/evidence-runner.test.ts` | Pin layer semantics and summaries.                                                                   |
| Verification tests         | `packages/opencorvus/test/browser-preview/verification.test.ts`    | Update the shared passed layer fixture so old tests remain strict.                                   |

## Fix Shape

1. Add `glyph` to `RuntimeCaptureLayers`.
2. In each Playwright sidecar, scan visible text nodes for CJK characters.
3. For each visible sample, capture computed font data and verify glyph support
   with `document.fonts.check`.
4. Add a canvas-based missing-glyph comparison against a notdef sentinel so a
   text run that paints as tofu boxes is not accepted only because DOM text
   exists.
5. Treat `glyph` as a normal runtime layer in summaries, manifests, and failure
   lists. No fallback font injection and no page mutation.

## Acceptance

- Controlled sidecar rendering with system Chrome and default launch args
  renders CJK text legibly.
- A capture whose glyph layer fails produces `failed layers: glyph`.
- Existing browser preview evidence tests still pass.
- The fix does not add a second screenshot owner, iframe evidence path, Browser
  MCP evidence path, or any fallback rendering logic.
