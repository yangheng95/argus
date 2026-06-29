# 2026-06-17 overlay proxy test button

## Request

Add a test button to the Overlay network proxy settings so the operator can verify whether the currently edited proxy is reachable and see the HTTP status code.

## Existing Plan Recall

- `2026-06-10-config-proxy-overlay-entry.md` created the single `network.proxy` config entry and the Overlay Network settings tab.
- `2026-06-12-proxy-auth-scope-settings.md` replaced the old `enabled` switch with `llmProvider` / `webResearch` scopes and separate `username` / `password` fields.
- Active rule: `network.proxy` remains the only configuration source. No environment-variable fallback, direct-fetch fallback, or second proxy source is allowed.

## Grep Findings

| Area                     | Evidence                                                                                                                                                       | Decision                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Overlay settings UI      | `packages/overlay/src/components/settings/NetworkPanel.tsx` owns URL, username, password, scope toggles, and `patchConfig({ network: { proxy: nextProxy } })`. | Add the test action here and keep save behavior unchanged.                                       |
| Overlay service boundary | `packages/overlay/src/services/config.ts` owns config-related API helpers; provider tests use typed service helpers rather than inline `apiJson` in panels.    | Add `testNetworkProxy()` in this service and call it from the panel.                             |
| Existing result UI       | `ProvidersPanel.tsx` renders provider test results with `Button` and `.provider-test-result`, backed by token CSS in `settings.css`.                           | Reuse the same primitive and result class instead of adding a parallel status component.         |
| Backend proxy helper     | `packages/opencorvus/src/util/network-proxy.ts` already owns authenticated proxy URL construction and `proxiedFetchInit()`.                                    | Add proxy probing beside this helper and reuse `authenticatedProxyUrl()` / `proxiedFetchInit()`. |
| Config route             | `packages/opencorvus/src/server/routes/config.ts` owns project-scoped config operations under `/config`.                                                       | Add `POST /config/proxy/test`; it requires project directory like the rest of `/config`.         |
| Route policy             | `packages/transport-protocol/src/index.ts` treats `/config/*` as project-scoped.                                                                               | No bypass entry. Add test coverage that Overlay injects `directory` for `/config/proxy/test`.    |
| i18n                     | `packages/overlay/src/i18n/en-US.json` and `zh-CN.json` already contain Network proxy labels.                                                                  | Add all user-visible strings there.                                                              |
| Current docs             | `packages/web/src/content/docs/network.mdx` still says there is no `opencorvus.jsonc` proxy field.                                                             | Update it to match the current `network.proxy` single source and the new test button.            |

## Contract

`POST /config/proxy/test`

Request:

```json
{
  "proxy": {
    "url": "http://127.0.0.1:7890",
    "username": "optional",
    "password": "optional",
    "llmProvider": true,
    "webResearch": true
  }
}
```

Response:

```json
{
  "ok": true,
  "status": "connected",
  "targetUrl": "https://www.gstatic.com/generate_204",
  "statusCode": 204,
  "durationMs": 123,
  "message": "Proxy is reachable."
}
```

Failure responses keep the same shape with `ok: false`, `status: "error"`, and either `statusCode` for HTTP failures or the thrown transport error message for connection failures.

## Implementation Notes

- The probe uses the submitted form proxy config directly, so users can test before saving.
- The probe sends exactly one proxied request through Bun `fetch` using the same authenticated proxy URL builder as provider and web research traffic.
- No direct fetch fallback is allowed when the proxy fails.
- The UI displays success/failure, HTTP code when present, elapsed milliseconds, and the backend message.

## Tests

- Backend util test: verifies authenticated proxy URL is injected into `fetch` and HTTP 204 returns connected.
- Backend route test: verifies `/config/proxy/test` returns HTTP code details and rejects missing URL.
- Overlay service test: verifies the request goes to `config/proxy/test` with project directory injection and preserves username/password fields.
- Static UI/i18n test: verifies NetworkPanel uses the service helper and renders the test button/result strings.
- Route policy test: verifies `/config/proxy/test` remains project-scoped.
