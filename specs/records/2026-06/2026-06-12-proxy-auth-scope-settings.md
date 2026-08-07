# 2026-06-12 proxy auth and scoped settings

## Request

Add username/password fields to OpenCorvus proxy settings, and allow the operator to choose independently whether the proxy applies to LLM provider traffic and websearch/webfetch traffic.

## Existing Plan Recall

`specs/records/2026-06/2026-06-10-config-proxy-overlay-entry.md` introduced a single `network.proxy` entry:

```jsonc
{
  "network": {
    "proxy": {
      "url": "http://127.0.0.1:7890",
      "enabled": true,
    },
  },
}
```

That implementation only affects provider SDK fetches via `Provider.getSDK`.

## Grep Findings

| Area               | Evidence                                                                                                                                                                                                               | Decision                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Config schema      | `packages/opencorvus/src/config/config.ts` owns `Config.NetworkProxy` and OpenAPI schema generation.                                                                                                                   | Replace the single `enabled` switch with scoped booleans: `llmProvider` and `webResearch`; add `username` and `password`.                        |
| Provider traffic   | `packages/opencorvus/src/provider/provider.ts` has the single SDK fetch wrapper and current `resolveFetchProxy`.                                                                                                       | Move proxy URL construction to a shared helper and call it with scope `llmProvider`.                                                             |
| Web fetch traffic  | `packages/opencorvus/src/tool/webfetch.ts` directly calls `fetch` twice.                                                                                                                                               | Use shared proxy fetch init with scope `webResearch` for both initial and challenge retry requests.                                              |
| Web search traffic | `packages/opencorvus/src/tool/websearch.ts`, `packages/opencorvus/src/agent/context-tools.ts`, and `packages/opencorvus/src/tool/codesearch.ts` all share `exaMcpCall` from `packages/opencorvus/src/tool/exa-mcp.ts`. | Apply proxy once inside `exaMcpCall` with scope `webResearch`; this also covers external code search because it uses the same Exa MCP transport. |
| Overlay UI         | `packages/overlay/src/components/settings/NetworkPanel.tsx` currently edits `enabled` and `url` only.                                                                                                                  | Render URL, username, password, LLM provider toggle, and websearch/webfetch toggle; write only `network.proxy` patches.                          |
| Tests              | Existing coverage in `test/config/config.test.ts`, `test/provider/provider.test.ts`, `test/tool/webfetch.test.ts`, `overlay/test/dialog-service-single-source.test.ts`.                                                | Update config/provider tests; add webfetch proxy init assertion; keep Overlay static single-source test aligned.                                 |
| SDK/OpenAPI        | `packages/sdk/openapi.json` and `packages/sdk/js/src/gen/types.gen.ts` already contain generated `NetworkProxyConfig` from the previous proxy change.                                                                  | Regenerate or update generated API artifacts after schema change; no parallel hand-maintained type source.                                       |

## Contract

`network.proxy` shape:

```jsonc
{
  "network": {
    "proxy": {
      "url": "http://10.217.133.185:30100",
      "username": "hexin",
      "password": "hx300033",
      "llmProvider": true,
      "webResearch": true,
    },
  },
}
```

- `llmProvider: true` routes bundled/default provider SDK requests through the proxy unless a provider explicitly owns a custom fetch implementation.
- `webResearch: true` routes `webfetch` and `websearch` through the proxy.
- `username` and `password` are encoded into the proxy URL at the transport boundary. The stored config keeps them as separate fields so the Overlay can edit them without parsing credentials out of `url`.
- `url` must use `http://` or `https://`.
- If either scope is enabled, `url` is required.
- `password` without `username` is invalid.

## Acceptance

- Config accepts authenticated scoped proxy settings and rejects invalid URL schemes.
- Provider fetch init receives an authenticated proxy URL only when `llmProvider` is enabled.
- Webfetch receives an authenticated proxy URL only when `webResearch` is enabled.
- Websearch uses the same `webResearch` transport through `exaMcpCall`.
- Overlay settings expose URL, username, password, LLM Provider toggle, and Web Search/Web Fetch toggle, and writes only `network.proxy`.
