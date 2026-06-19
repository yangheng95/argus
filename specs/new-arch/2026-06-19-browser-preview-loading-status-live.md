# Browser Preview Loading Status Live

## Recall

- `BrowserPreviewPanel.tsx` renders four loading spinner surfaces: target status row, evidence status row, target-loading empty stage, and live-loading empty stage.
- `loading-spinner-motion-browser.test.ts` already holds `/task/:id/browser-preview` open long enough to inspect the real target-loading Browser Preview UI and screenshot it.
- `browser-preview-panel.test.ts` is the existing architecture guard for this component and service boundary.

## Problem

The Browser Preview loading surfaces relied on spinner motion and visible text only. Assistive technology did not have a status/live-region contract for the async state changes, so the same UI that looked alive visually could be silent to screen-reader users.

## Design

- Keep the service and evidence runner as the single source for target/capture/live state.
- Use `role="status"` and `aria-live="polite"` only on loading state containers that own a loading message.
- Keep spinner elements decorative; the visible translated loading text remains the accessible content.
- Do not add fallback timing, polling, or host-side gates.

## Verification

- Extend the real browser spinner test to assert loading status/live attributes on the rendered Browser Preview target-loading state.
- Add source guards for the evidence capture loading and live snapshot loading branches because they are separate async surfaces.
- Re-run targeted browser screenshot verification and overlay typecheck after the code change.
