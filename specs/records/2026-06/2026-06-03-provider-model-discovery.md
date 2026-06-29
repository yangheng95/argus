# Provider Model Discovery

## Context

The Settings provider form currently requires operators to manually enter
provider id, display name, API URL, API key environment variable, API key, and
model mappings. OpenAI-compatible gateways already expose `/models`, so asking
operators to hand-type `modelID:name` creates a false configuration problem.

## Evidence

Full-repo grep before design:

| Surface                                                       | Evidence                                                                                                        | Decision                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/overlay/src/components/settings/ProvidersPanel.tsx` | Owns the add/edit form, parses `modelID:name`, writes `PATCH /config`, stores API key through `PUT /auth/{id}`. | Replace manual-only model entry with explicit discovery action. |
| `packages/opencorvus/src/server/routes/provider.ts`           | Owns provider-related live operations: registry refresh, hexin refresh, provider test, auth.                    | Add a provider route for OpenAI-compatible model discovery.     |
| `packages/opencorvus/src/server/routes/config.ts`             | Validates provider sub-shapes on `PATCH /config`.                                                               | Keep existing config validation; discovery returns data only.   |
| `packages/opencorvus/src/config/config.ts`                    | `Config.Provider` schema accepts `api`, `env`, `models`, and `options.apiKey`.                                  | No schema change.                                               |
| `packages/opencorvus/src/provider/provider.ts`                | Config providers default to `@ai-sdk/openai-compatible`; provider models are explicit metadata.                 | Do not add implicit startup discovery or fallback.              |
| `packages/overlay/src/services/config.ts`                     | `updateConfig` handles JSON Merge Patch writes.                                                                 | Reuse existing save path.                                       |
| `packages/overlay/src/services/api.ts`                        | Shared API JSON helper.                                                                                         | Reuse for discovery call.                                       |

## Design

Add `POST /provider/discover-models` with body:

```ts
{
  api: string
  apiKey?: string
}
```

The route normalizes a base URL to `<base>/models`, sends `Authorization:
Bearer <apiKey>` when a key is supplied, validates the OpenAI-compatible
response shape `{ data: [{ id: string }] }`, and returns sorted model ids.

This is an explicit operator action from the form. It is not a fallback, not a
startup fetch, and not a provider runtime branch.

Update `ProvidersPanel`:

- Add a "Discover models" button beside the model field.
- Disable it until API URL is present.
- Use the pasted form API key for discovery; if editing an already-authenticated
  provider and no key is pasted, the server still attempts unauthenticated
  discovery for public gateways and returns the upstream error otherwise.
- Fill the model textarea with one model id per line. Existing parser already
  treats plain ids as `{ name: id, tool_call: true }`.
- Surface discovery failures in the existing form error region.

## Tests

- Server route unit test with a local Hono/Bun test server returning OpenAI
  model data and asserting the Authorization header.
- Overlay source/layout tests assert the discover button and i18n keys exist.

Live OpenToken probe on 2026-06-03:

| URL                                     | Result                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `https://cn2.gw.opentoken.io/v1/models` | `401 {"error":{"message":"无效的 API Key","type":"auth_error","code":"401"}}` |
| `https://cn2.gw.opentoken.io/models`    | `404 Not Found`                                                               |
| `https://cn2.gw.opentoken.io/`          | `404 Not Found`                                                               |

Therefore the correct base URL for OpenToken CN2 is
`https://cn2.gw.opentoken.io/v1`.
