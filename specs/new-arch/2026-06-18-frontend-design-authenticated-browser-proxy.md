# 2026-06-18 frontend-design authenticated browser proxy

## Request

Frontend-design cannot acquire `https://www.tradingview.com/markets/world-economy/`
when the operator configures an authenticated proxy in Overlay.

## Existing Plan Recall

- `2026-06-10-config-proxy-overlay-entry.md` introduced one `network.proxy`
  source.
- `2026-06-12-proxy-auth-scope-settings.md` made proxy authentication explicit
  as `url`, `username`, and `password`, with `webResearch` owning web research
  traffic.
- `2026-06-13-browser-runtime-path-discovery.md` propagated process proxy
  variables into browser launch arguments.
- `2026-06-17-network-proxy-webfetch-runtime-fix.md` kept `network.proxy` as the
  single config source for web research fetch traffic.

## Grep Findings

| Area                       | Evidence                                                                                                                       | Decision                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Proxy config               | `packages/opencorvus/src/config/config.ts` owns `network.proxy.url`, `username`, `password`, `llmProvider`, and `webResearch`. | Keep the existing config object; treat frontend-design live webpage acquisition as `webResearch` traffic.         |
| Auth URL helper            | `packages/opencorvus/src/util/network-proxy.ts` owns `authenticatedProxyUrl()`.                                                | Reuse it to derive one authenticated proxy URL from config.                                                       |
| Browser runtime            | `packages/opencorvus/src/browser/runtime/index.ts` converts proxy env vars into Chromium `--proxy-server` args.                | Add a shared parser that strips credentials for launch args and exposes credentials for Playwright context proxy. |
| Frontend-design extraction | `packages/opencorvus/src/frontend-design/tools/webpage-extract.ts` calls `extractPage()` for desktop and mobile.               | Resolve `network.proxy.webResearch` once in the tool and pass it to both captures.                                |
| URL screenshot             | `packages/opencorvus/src/frontend-design/url-screenshot-tool.ts` calls `captureReferenceManifest()`.                           | Use the same `webResearch` proxy for screenshot acquisition.                                                      |
| Browser sidecars           | `browser/webpage/extract.ts` and `frontend-design/capture-gate.ts` create Playwright contexts without proxy options.           | Pass `proxy` into `browser.newContext()`; do not put credentials in Chrome launch args.                           |

## Root Cause

The authenticated proxy URL `http://user:secret@host:port` is passed through
`BrowserRuntime.defaultLaunchArgs()` as
`--proxy-server=http://user:secret@host:port`. Chromium rejects that form with
`net::ERR_NO_SUPPORTED_PROXIES`. Playwright requires credentials to be supplied
on the browser context proxy object instead.

## Implementation

- Add `BrowserRuntime.resolveBrowserProxyConfig()` as the single browser proxy
  parser for env/config proxy URLs.
- Keep `defaultLaunchArgs()` proxy-aware, but make it pass only the credential-
  free server URL to Chromium.
- Add `browserProxy` inputs to webpage extraction and URL screenshot capture,
  and forward them to the Node sidecar payload.
- In the Node sidecars, pass `proxy` to `browser.newContext()`.
- Frontend-design tools resolve `network.proxy.webResearch`; no direct retry,
  no second proxy source, and no unauthenticated fallback path.

## Acceptance

- Authenticated proxy URLs never appear in Chromium `--proxy-server` launch args.
- Browser context proxy receives `server`, `username`, and `password`.
- Frontend-design webpage extraction uses `network.proxy.webResearch` for both
  desktop and mobile captures.
- URL screenshot uses the same proxy source.
- Targeted tests pass.
