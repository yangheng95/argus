# 2026-06-17 network proxy webfetch runtime fix

## Request

Investigate why WebFetch still fails in the OpenCorvus container after a proxy is configured, and fix the implementation if the proxy transport is not actually enforced.

## Existing Plan Recall

- `2026-06-10-config-proxy-overlay-entry.md` introduced one `network.proxy` config source.
- `2026-06-12-proxy-auth-scope-settings.md` replaced `enabled` with scoped `llmProvider` and `webResearch`, plus `username` and `password`.
- `2026-06-17-overlay-proxy-test-button.md` added `POST /config/proxy/test` and explicitly requires no direct-fetch fallback when a proxy test fails.
- Active contract: `network.proxy` remains the single OpenCorvus proxy configuration source. WebFetch must use `network.proxy.webResearch`.

## Grep Findings

| Area | Evidence | Decision |
| --- | --- | --- |
| Config schema | `packages/opencorvus/src/config/config.ts` owns `Config.NetworkProxy` with `url`, `username`, `password`, `llmProvider`, and `webResearch`. | Keep the schema; no env-var proxy source for WebFetch. |
| Shared helper | `packages/opencorvus/src/util/network-proxy.ts` owns `resolveNetworkProxy()`, `authenticatedProxyUrl()`, and `proxiedFetchInit()`. | Fix runtime proxy enforcement here as the single transport helper. |
| WebFetch | `packages/opencorvus/src/tool/webfetch.ts` calls `resolveNetworkProxy(await Config.get(), "webResearch")` and `proxiedFetchInit()` for both initial and challenge retry fetches. | Keep WebFetch code on the shared helper. |
| WebSearch | `packages/opencorvus/src/tool/exa-mcp.ts` calls the same helper with `webResearch`. | Helper fix covers Exa MCP transport too. |
| Provider traffic | `packages/opencorvus/src/provider/provider.ts` calls the same helper with `llmProvider`. | Preserve provider behavior while tightening tests around the helper. |
| Existing tests | `packages/opencorvus/test/tool/webfetch.test.ts`, `test/util/network-proxy-test.test.ts`, and `test/provider/provider.test.ts` only assert that `init.proxy` is present on a mocked fetch. | Add tests for the full runtime init shape and avoid a test that passes when the proxy field is ignored. |
| Container runtime | `packages/opencorvus/Dockerfile` runs `/opt/opencorvus/opencorvus`, a Bun-compiled binary, through `script/opencorvus-container-entrypoint.sh`. | A Bun path must continue to receive Bun's proxy option. Any Node sidecar/source path must also receive an enforced dispatcher rather than silently direct-fetching. |
| Browser runtime | `packages/opencorvus/src/browser/runtime/index.ts` and tests derive Chromium proxy args from browser/environment variables. | Browser launch proxy is a separate path and not the WebFetch root cause. |

## Root Cause

`proxiedFetchInit()` currently adds only Bun's non-standard `RequestInit.proxy` field. That works only when the active fetch implementation honors Bun's proxy extension. Any Node/Undici fetch path ignores that field and silently attempts a direct request. Existing tests miss this because they mock `fetch` and inspect the object shape instead of requiring a runtime-supported proxy transport.

Runtime evidence added during implementation: the packaged Docker entrypoint runs the Bun-compiled `/opt/opencorvus/opencorvus` binary, and a local HTTP proxy probe confirms Bun fetch honors `RequestInit.proxy` and sends `Proxy-Authorization` for credentials. Therefore a packaged-container WebFetch failure after this fix is more likely to be a config/scope/container-network/target-blocking issue than Bun ignoring the proxy field.

## Implementation

- Keep `network.proxy` as the only OpenCorvus proxy source.
- Keep all callers using `proxiedFetchInit()`.
- Make `proxiedFetchInit()` attach Bun's proxy option in Bun, and a Node/Undici dispatcher in Node, from the same authenticated proxy URL.
- Add tests that assert a configured proxy produces the Bun transport in Bun, the Undici transport in Node, and no transport fields when the scope is disabled.
- Do not add direct-fetch retry or environment-variable fallback.

## Acceptance

- WebFetch with `network.proxy.webResearch=true` receives an enforced proxy transport.
- WebSearch/Exa MCP with `network.proxy.webResearch=true` receives the same enforced proxy transport.
- Provider traffic with `network.proxy.llmProvider=true` receives the same enforced proxy transport.
- Disabled scopes produce no proxy transport.
- Tests cover the helper-level transport shape so mocked fetch tests cannot hide the ignored-proxy bug.
