# Browser Preview Target Evidence Binding

Date: 2026-06-15
Status: implementation plan

## Acronyms

- UI: User Interface, the overlay panel visible to the operator.
- URL: Uniform Resource Locator, the persisted preview address.
- E2E: End-to-End, a browser test covering the operator-visible flow.

## Problem

The browser preview panel keeps the latest verification resource after the user
selects a different saved preview target. The live frame reloads with the new
target, but the evidence summary and rendered evidence can still come from the
previous target because `renderedEvidence()` prefers `verification()` without
checking that the verification request belongs to the current target.

## Call Point Sweep

| Surface | Call point | Decision |
| --- | --- | --- |
| Overlay panel | `packages/overlay/src/components/BrowserPreviewPanel.tsx` `verificationRequest` | Keep the existing request shape and use it as the ownership key. |
| Overlay panel | `BrowserPreviewPanel.tsx` `renderedEvidence()` | Only use `verification()` when request `taskID` and `targetID` match the current resolved target. |
| Overlay panel | `BrowserPreviewPanel.tsx` evidence status block | Display loading/result/error only for the current target request; old target results must be ignored after candidate selection. |
| Overlay panel | `BrowserPreviewPanel.tsx` capture button and auto-capture effect | Avoid coupling current target availability to an unrelated old verification request. |
| Overlay service | `packages/overlay/src/services/browser-preview.ts` | No contract change; target selection and capture requests already carry explicit `targetID`. |
| Browser E2E | `packages/overlay/test/browser/browser-preview-evidence.test.ts` | After selecting an alternate target, assert the stale desktop capture summary disappears before the alternate target gets new evidence. |

## Acceptance

- Switching candidates cannot show stale verification text from the old target.
- Switching candidates keeps live preview reload behavior unchanged.
- The fix is covered by Node-driven Playwright E2E through `test:browser` runner.
