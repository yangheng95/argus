# Trace Panel i18n Source

## Recall

- `2026-06-18-card-trace-action-button-owner.md` moved TracePanel header actions onto the shared Button primitive.
- `2026-06-18-trace-event-head-focus.md` and `2026-06-19-trace-event-disclosure-controls.md` made event rows keyboard-visible and connected disclosure bodies with `aria-controls`.
- `i18n-discipline-round2.test.ts` currently guards selected TracePanel action labels only, while `TracePanel.tsx` still owns title, loading, empty, and diagnostic copy.

## Problem

TracePanel mixed localized action buttons with hard-coded English panel text. In `zh-CN`, the panel could still show English title/status/diagnostic copy such as "Session trace", "Trace fetch failed", and "Auto-refreshes every 4s".

## Design

- Move TracePanel title, empty, loading, error, diagnostics, and fixed headline fragments to `trace.*` locale keys.
- Keep protocol identifiers such as event kinds and environment variable names as data/code, not translated prose.
- Do not add string fallback paths; missing locale keys remain caught by the existing i18n runtime and catalog parity tests.

## Verification

- Extend `i18n-discipline-round2.test.ts` so TracePanel chrome keys are required in both locale catalogs.
- Add a TracePanel source guard that rejects the previous hard-coded English UI strings.
- Run `check:i18n`, the i18n discipline test, the TracePanel primitive test, and a browser TracePanel focus screenshot after implementation.
