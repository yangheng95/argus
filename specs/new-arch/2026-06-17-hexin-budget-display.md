# 2026-06-17 Hexin Budget Display

## Request

Show the Hexin gateway key balance below the composer model selector when the OpenCorvus model dropdown selection is a Hexin model.

The live upstream request verified on 2026-06-17 returns:

```json
{
  "max_budget": 4435.3,
  "spend": 2980.312612080029,
  "remaining": 1454.9873879199713,
  "over_budget": false
}
```

The bearer token is not part of this spec or source code. Runtime auth must reuse the existing Hexin provider credential sources.

## Call Point Inventory

| Area                   | Evidence                                                                                                                                                            | Decision                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Hexin endpoint source  | `packages/opencorvus/src/provider/models.ts` defines `ModelsDev.HEXIN_GATEWAY_URL` as `https://aimemodeldev.myhexin.com/litellm/v1`.                                | Derive the budget URL from this single source by replacing `/v1` with `/key/budget`; do not add a second base URL constant. |
| Hexin key source       | `packages/opencorvus/src/provider/provider.ts` already resolves Hexin auth from `HEXIN_API_KEY`, `config.provider.hexin.options.apiKey`, then saved `Auth` API key. | Reuse the same ordered key resolution for budget lookup; do not hardcode or expose the bearer token.                        |
| Provider routes        | `packages/opencorvus/src/server/routes/provider.ts` owns `/provider/hexin/refresh` and provider test/discovery routes.                                              | Add `GET /provider/hexin/budget` before `/:providerID/...` routes.                                                          |
| OpenAPI / SDK          | `packages/opencorvus/script/check/routes.ts` checks runtime routes against `packages/sdk/openapi.json` and generated SDK routes.                                    | Regenerate SDK artifacts after adding the route.                                                                            |
| Overlay model selector | `packages/overlay/src/components/ExecutorSelector.tsx` owns the composer OpenCorvus model picker and `openCorvusModel()`.                                           | Render a compact budget row under the dual chip bar only when the current OpenCorvus model provider is `hexin`.             |
| Overlay API layer      | `packages/overlay/src/services/config.ts` already exposes model-context API helpers consumed by the selector.                                                       | Add a typed `getHexinBudget()` helper using the existing `apiJson` client.                                                  |
| Existing visual tests  | `packages/overlay/test/browser/executor-selector-redesign.test.ts` exercises the real selector in a browser fixture.                                                | Extend it to assert the budget row appears for Hexin and is absent for non-Hexin.                                           |
| Static selector tests  | `packages/overlay/test/executor-selector-dualbar.test.ts` locks the selector structure and CSS ownership.                                                           | Extend static assertions for the budget API call, conditional rendering, CSS, and i18n keys.                                |

## Contract

- Route: `GET /provider/hexin/budget`
- Success response:

```json
{
  "ok": true,
  "budget": {
    "maxBudget": 4435.3,
    "spend": 2980.312612080029,
    "remaining": 1454.9873879199713,
    "overBudget": false
  }
}
```

- Error response is HTTP 200 with `ok: false` and a concrete `error` string so the UI can show the real provider failure without fabricating a balance.
- The route must throw no implicit provider discovery and must not mutate provider state.
- The UI must not request the budget endpoint unless `splitModelID(openCorvusModel()).provider === "hexin"`.

## Verification

- `bun test packages/opencorvus/test/server/provider-hexin-budget.test.ts`
- `bun test packages/overlay/test/executor-selector-dualbar.test.ts`
- `node packages/overlay/test/browser-runner.mjs executor-selector-redesign`
- `bun run --cwd packages/overlay build:vite`
- `bun run api:routes-check`
- Visual screenshot of the real overlay selector with a Hexin model selected.
