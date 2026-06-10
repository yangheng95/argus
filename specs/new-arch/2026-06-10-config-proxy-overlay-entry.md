# 2026-06-10 config proxy overlay entry

## Request

Add proxy settings to `opencorvus.jsonc` and expose an Overlay entry.

## Grep Findings

| Area | Evidence | Decision |
| --- | --- | --- |
| Config schema | `packages/opencorvus/src/config/config.ts` owns `Config.Info`, `Config.update`, JSONC patching, OpenAPI schema. | Add one `network.proxy` object to `Config.Info`; no parallel env-only source. |
| Provider HTTP | `packages/opencorvus/src/provider/provider.ts` wraps every provider SDK `fetch` in `getSDK`. | Inject proxy at that single fetch wrapper so all bundled and installed AI SDK providers share behavior. |
| Existing provider fetch options | `provider.options.fetch` is preserved as `customFetch`, `options.fetch` adds timeout/error normalization. | If provider already supplies custom fetch, leave it as the transport owner; config proxy applies to the default fetch path. |
| Overlay config writes | `packages/overlay/src/services/config.ts` has `patchConfig` and `updateConfig`; tests guard no redundant refetch. | New panel uses `patchConfig({ network: ... })` only. |
| Overlay settings tabs | `packages/overlay/src/store/dialog.ts` is the single source for settings sections; `ConfigDialogHost.tsx` maps icons/panels. | Add `network` tab there and render a small dedicated panel. |
| Existing UI primitives | Settings panels use `SurfaceHeader`, `Button`, `.field`, `.config-toggle-list-item`. | Reuse these primitives; no hand-rolled interaction framework. |

## Contract

`network.proxy` shape:

```jsonc
{
  "network": {
    "proxy": {
      "url": "http://127.0.0.1:7890",
      "enabled": true
    }
  }
}
```

Empty URL or disabled proxy means direct fetch. Bun 1.3.13 fetch supports `http://` and `https://` proxy URLs, so the configured URL is limited to those schemes.

## Tests

- Backend unit coverage:
  - schema accepts valid `network.proxy`;
  - invalid proxy URL is rejected;
  - provider wrapper injects Bun fetch `proxy` when enabled and not when disabled.
- Overlay static/service coverage:
  - settings sections include `network`;
  - panel writes only `network.proxy` merge patches.
