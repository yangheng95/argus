# 2026-06-22 default network proxy

## Request

Set the packaged software's internal default proxy to the authenticated HTTP proxy used for TradingView acquisition, then package in WSL and verify TradingView access through the software proxy without relying on system proxy environment variables.

## Existing Plan Recall

- `2026-06-12-proxy-auth-scope-settings.md` defines `network.proxy` as the single proxy config source with `url`, `username`, `password`, `llmProvider`, and `webResearch`.
- `2026-06-17-network-proxy-webfetch-runtime-fix.md` requires web research traffic to use `network.proxy.webResearch` through `resolveNetworkProxy()` / `proxiedFetchInit()`, with no direct-fetch fallback.
- `2026-06-18-frontend-design-authenticated-browser-proxy.md` requires browser evidence acquisition to resolve the same `network.proxy.webResearch` config and pass credentials through the Playwright context proxy object, not Chromium launch args.

## Grep Findings

| Area | Evidence | Decision |
| --- | --- | --- |
| Config schema/default merge | `packages/opencorvus/src/config/config.ts` owns `Config.NetworkProxy`, `Config.Info`, and the `Config.state` merge order. | Add `Config.DEFAULT_NETWORK_PROXY` and materialize it only when no explicit `network.proxy` exists after all config sources, including managed config, have merged. |
| Proxy transport | `packages/opencorvus/src/util/network-proxy.ts` owns authenticated proxy URL construction and runtime fetch transport. | Do not add env/system proxy logic; default config flows through the existing helper. |
| Web research validation | `packages/opencorvus/test/config/config.test.ts` already covers proxy config shape. | Add a test that no project/global config resolves the default authenticated scoped proxy without auto-writing a project config. |
| Packaged verification | `packages/opencorvus/dist/binary/.../opencorvus` exposes the CLI and compiled runtime. | After WSL packaging, run the packaged binary with a temp home/project and fetch `https://www.tradingview.com/markets/world-economy/` through `Config.get()` + `resolveNetworkProxy()`. Clear `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` env vars for the probe. |

## Acceptance

- No explicit config resolves `network.proxy` to:
  - `url: "http://10.217.133.185:30100"`
  - `username: "hexin"`
  - password stored in the config object
  - `llmProvider: true`
  - `webResearch: true`
- Existing explicit config still overrides the default.
- TradingView probe succeeds using `resolveNetworkProxy(config, "webResearch")` from the packaged WSL binary with system proxy env vars removed.
