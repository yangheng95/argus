# Settings Info Stale Projection Removal

## Problem

Settings-only config refresh uses `Promise.allSettled()` and replaces failed
provider or prompt requests with existing `appStore` values. That keeps stale
providers, auth state, or prompt rows visible when the current backend request
has failed, creating a hidden second source beside `configLoadErrors`.

## Call Points

| Surface                       | File                                                                                    | Decision                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider catalog/auth refresh | `packages/overlay/src/services/init.ts` `settledProviderInfo()`                         | On a failed provider route, record `configLoadErrors` and clear that projection (`providerCatalog` or `providerAuth`) instead of reusing old store data. |
| Prompt refresh                | `packages/overlay/src/services/init.ts` `loadConfigInfo(... includeSettingsData: true)` | On `config/prompt` failure, record the error and clear `promptEntries` to `[]`.                                                                          |
| Startup config refresh        | `loadConfigInfo(... includeSettingsData: false)`                                        | Keep provider/prompt fields untouched because startup mode does not request settings-only data.                                                          |
| Core config/channel routes    | `loadConfigInfo()`                                                                      | Keep the existing fail-fast behavior for `config` and `channel`; this change is only about settings-only stale projections.                              |
| Provider panel consumers      | `ProvidersPanel.tsx`, `AgentModelsPanel.tsx`, `ExecutorSelector.tsx`, `llm.ts`          | Continue reading only `appStore.providerCatalog` / `providerAuth`; a failed refresh now exposes absence rather than stale rows.                          |
| Prompt consumers              | `PromptCatalog.tsx`, prompt config helpers                                              | Continue reading only `appStore.promptEntries`; a failed refresh now exposes an empty list plus `configLoadErrors`.                                      |
| Tests                         | `packages/overlay/test/config-load-timeout.test.ts`                                     | Replace the stale-preservation test with a stale-clearing assertion for provider and prompt failures.                                                    |

## Implementation

1. Split the generic settled helper into a failure-recording helper plus
   explicit fresh defaults for settings-only routes.
2. Use `null` for failed provider catalog/auth and `[]` for failed prompt
   entries.
3. Keep successful sibling route results, so a provider catalog timeout does
   not discard a fresh `provider/auth`, channel, config, or prompt response.

## Verification

- `bun test packages/overlay/test/config-load-timeout.test.ts`
- `bun run --cwd packages/overlay typecheck`
