# 2026-06-22 retire default network proxy

## Request

Remove OpenCorvus' software-internal default network proxy. Proxy traffic must only happen when `network.proxy` is explicitly configured by the operator or a managed config source.

## Existing Plan Recall

- `2026-06-12-proxy-auth-scope-settings.md` defines `network.proxy` as the single proxy config source with `url`, `username`, `password`, `llmProvider`, and `webResearch`.
- `2026-06-17-network-proxy-webfetch-runtime-fix.md` requires web research traffic to use `network.proxy.webResearch` through `resolveNetworkProxy()` / `proxiedFetchInit()`, with no direct-fetch fallback.
- `2026-06-18-frontend-design-authenticated-browser-proxy.md` requires browser evidence acquisition to resolve the same `network.proxy.webResearch` config and pass credentials through the Playwright context proxy object, not Chromium launch args.
- The previous version of this file requested `Config.DEFAULT_NETWORK_PROXY` and automatic `network.proxy` materialization. That conflicts with the current request and with the explicit-config single source principle.

## Grep Findings

| Area                        | Evidence                                                                                                                                                       | Decision                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Config schema/default merge | `packages/opencorvus/src/config/config.ts` owns `Config.DEFAULT_NETWORK_PROXY` and `Config.state` auto-materializes it when `result.network?.proxy` is absent. | Delete the constant and the auto-materialization block. Keep the `NetworkProxy` schema.                                  |
| Config tests                | `packages/opencorvus/test/config/config.test.ts` asserts no-config loads `Config.DEFAULT_NETWORK_PROXY` and has a dedicated default-proxy test.                | Replace those assertions with tests that no config leaves `network.proxy` unset and does not write project config files. |
| Explicit proxy callers      | `Provider.resolveFetchProxy()`, `resolveNetworkProxy()`, WebFetch, Exa MCP, proxy test route, and frontend-design capture consume explicit `network.proxy`.    | Leave these paths intact; they remain the single proxy transport path once config is explicit.                           |
| Historical index            | `specs/records/2026-06/2026-06-29-spec-consolidation.md` links the previous default proxy note.                                                                                             | Update the entry to this retirement note so future recall does not reintroduce the default.                              |

## Acceptance

- With no project/global/managed proxy config, `config.network?.proxy` resolves as `undefined`.
- No default proxy credentials or endpoint remain in production config code.
- Explicit `network.proxy` config still loads and validates.
- Existing proxy transport tests remain scoped to explicit config.
