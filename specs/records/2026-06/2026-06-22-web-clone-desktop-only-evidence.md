# Web Clone Desktop-Only Evidence

Date: 2026-06-22

## Problem

The webpage clone evidence path still creates and requires non-desktop evidence:

- `webpage_extract` captures `reference-mobile.png` at `390x844`.
- `web-clone-source` manifests and integrity checks require
  `reference-mobile.png`.
- frontend-design and build handoffs tell agents to inspect mobile references
  even when the clone task is desktop-only.

This adds runtime cost and makes desktop clone tasks carry unnecessary
tablet/mobile obligations.

## Recall

- `2026-06-19-browser-preview-region-comparison-failure-repair-plan.md` states
  the World Economy clone acceptance needs the desktop page and mobile/tablet
  evidence must not block comparison.
- `2026-06-20-reference-comparison-evidence-chain-root-repair.md` preserves
  generic mobile viewport support, but explicitly says the cited TradingView
  desktop task has no mobile parity requirement.
- The browser-preview viewport work is separate; this change is scoped to the
  webpage clone evidence/source package path.

## Decision

- Make webpage clone evidence desktop-only by default.
- Remove `reference-mobile.png` from required/generated clone artifacts.
- Remove mobile viewport parameters, manifest rows, prompt lines, and integrity
  requirements from the clone source package path.
- Keep generic browser preview viewport capability untouched.

## Acceptance

- `webpage_extract` produces only `reference.png` for the clone evidence visual
  reference.
- `web-clone-source` no longer copies, requires, or manifests
  `reference-mobile.png`.
- frontend-design/web-clone prompt text no longer instructs downstream agents to
  validate against `reference-mobile.png`.
- Focused web-clone/frontend-design tests and typecheck pass.
