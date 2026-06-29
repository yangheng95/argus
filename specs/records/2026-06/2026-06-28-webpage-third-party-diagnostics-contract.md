# Webpage Third-Party Diagnostics Contract

Date: 2026-06-28

## Problem

TradingView world-economy capture fails before producing task-scoped webpage
evidence even though the primary document is reachable. The observed failures
are third-party advertising and telemetry requests such as
`securepubads.g.doubleclick.net/tag/js/gpt.js` closing the connection.

The current browser evidence scripts treat nearly every non-image subresource
failure, console diagnostic, or page error as a fatal acquisition failure. That
collapses three different facts into one error:

- primary document or same-origin application resource is unavailable
- rendered evidence is blank or unusable
- third-party diagnostics failed while the page still rendered

## Recall

- `2026-06-09-task-scoped-browser-evidence-runner-consensus.md` requires
  task-scoped backend evidence and forbids alternate evidence authorities.
- `2026-06-26-webpage-evidence-2k-viewport.md` defines the shared desktop
  webpage evidence viewport.
- `2026-06-27-frontend-design-reference-artifact-role-repair.md` separates
  source reference artifacts from local rendered screenshots.
- Live TradingView re-test after the third-party request repair exposed a
  second non-fatal diagnostic: `Provider's accounts list is empty.` was emitted
  through `console.error` while the primary document was still reachable.

## Callpoint Audit

Command:

```powershell
rg -n "requestfailed|assertNoBrowserFailures|pageerror|console error|webpage_extract|captureRuntimeState|captureReferenceManifest" packages/opencorvus/src packages/opencorvus/test -S
```

Relevant product paths:

| Surface | Current behavior | Repair |
| --- | --- | --- |
| `browser/webpage/extract.ts` | Fails on any non-image/media request failure and most console/page errors. | Fatal only for primary navigation, same-origin critical resources, and same-origin page runtime errors; console diagnostics do not block usable evidence. |
| `browser/webpage/runtime-state.ts` | Fails runtime-state capture on any request failure or console/page error. | Apply the same fatal/diagnostic split so interaction-state evidence is not blocked after extraction succeeds. |
| `frontend-design/capture-gate.ts` | URL screenshot capture fails on every request failure and every console/page error before screenshot. | Apply the same split while preserving blank/no-signal capture rejection. |
| `browser/webpage/render.ts` | Uses the same broad browser failure model for rendered screenshots. | Apply the same split for consistency across webpage evidence tools. |

## Contract

The single acquisition contract is:

- Primary navigation HTTP failures remain fatal.
- Same-origin document, script, stylesheet, fetch, XHR, and image failures remain fatal.
- Same-origin page errors remain fatal when source information proves they belong to the captured page.
- Browser launch, screenshot, serialization, and blank/no-signal evidence failures remain fatal.
- Console errors are diagnostics for external webpage acquisition. A console
  error does not prove the DOM, screenshot, or runtime-state artifact is
  unusable; subresource HTTP/request failures and `pageerror` events carry the
  fatal signal instead.
- Third-party request failures and page errors without same-origin evidence are
  diagnostics. They must not prevent DOM, screenshot, runtime-state, or source
  handoff artifacts when the primary evidence is usable.

This is not a domain allowlist and not a fallback path. The page still has one
evidence path; the path now distinguishes source-critical acquisition failures
from non-authoritative third-party diagnostics.

## Acceptance

- A successful page with a third-party failing script still produces webpage
  extraction evidence.
- A successful page with a same-origin failing script still throws
  `UrlExtractError`.
- URL screenshot capture still rejects blank pages and same-origin failed
  assets, but it accepts usable pages with third-party diagnostics.
- Runtime-state evidence still rejects same-origin runtime failures before
  writing snapshots, but it accepts usable pages with third-party diagnostics.
- Console diagnostics do not block extraction, runtime-state capture, render
  capture, or URL screenshot capture when the primary evidence is usable.
- The fix does not add URL/domain-specific whitelists and does not introduce a
  second capture path.
