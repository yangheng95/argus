# Provider Loading Failure Isolation

## Recall

### User request

- Fully audit the current Provider loading path.
- A small failure must not block refreshing Provider declarations, loading saved API keys, or loading model lists.
- Every failure must remain local to its owner, must not remove otherwise usable data, and must be visible in the Settings UI.

### Acceptance criteria

1. Project-scoped Provider and configuration recovery routes remain callable when full project bootstrap rejects a stale model reference or another unrelated runtime input.
2. Provider catalog, Provider authentication methods, scoped configuration, registry refresh, and live-model refresh are independently owned requests. One rejected request cannot suppress successful sibling responses.
3. A failing optional Provider projection or Provider-specific loader removes only that projection from the connected Provider set. Other catalog and configured Providers remain usable.
4. Every isolated failure is returned as structured diagnostic data and rendered in the Providers Settings panel.
5. A catalog or live-model refresh reports the refresh operation independently from later cache invalidation; unrelated Agent materialization cannot rewrite a successful refresh into an HTTP 400 response.
6. Runtime model selection stays strict. No model alias, silent replacement, compatibility catalog, or task-start fallback is introduced.
7. Non-UI behavior has focused contract tests. UI acceptance uses a real page, interaction, screenshot, and manual visual review; no UI automated test is added, changed, or run.

### Hard constraints

- Preserve all concurrent worktree changes; do not reset, stash, restore, broadly stage, or broadly format.
- Use the canonical Provider catalog and Auth owners; do not add a second cache or browser shadow source.
- Do not turn recovery availability into permissive task execution. Full runtime bootstrap and task model resolution retain strict validation.
- Do not add a gate, state machine, fallback, or keyword-based error suppression.
- Provider/catalog/config route contracts and generated OpenAPI or SDK outputs must stay synchronized.
- Commit subjects use the `dsw-33987` prefix and delivery pushes to `myhexin`.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/06-provider.md`
- `packages/opencorvus/src/project/bootstrap.ts`
- `packages/opencorvus/src/server/server.ts`
- `packages/opencorvus/src/server/project-route-context.ts`
- `packages/opencorvus/src/server/routes/provider.ts`
- `packages/opencorvus/src/server/routes/global.ts`
- `packages/opencorvus/src/server/routes/auth.ts`
- `packages/opencorvus/src/config/candidate-validation.ts`
- `packages/opencorvus/src/config/model-reference-validation.ts`
- `packages/opencorvus/src/provider/provider.ts`
- `packages/opencorvus/src/provider/models.ts`
- `packages/opencorvus/src/provider/hexin-discovery.ts`
- `packages/opencorvus/src/project/state.ts`
- `packages/overlay/src/services/config-load.ts`
- `packages/overlay/src/components/settings/ProvidersPanel.tsx`
- the user-provided Providers screenshot showing two `ProviderModelNotFoundError` HTTP 400 responses and an empty `0 Configured / 0 Catalog` projection.

### Whole-repository search evidence

The investigation used whole-repository searches for:

- `provider/refresh`, `provider/models/refresh`, `global/providers/refresh`, and their generated SDK/OpenAPI call points;
- `Provider.refreshCatalog`, `Provider.refreshModels`, `Provider.reset`, and native Agent registry reset owners;
- `ProviderModelNotFoundError`, `validateConfigModelReferences`, `validateConfigCandidate`, and `InstanceBootstrap`;
- `loadProviderInfo`, `providerCatalog`, `providerAuth`, and every Providers-panel refresh/error state;
- all Provider route definitions and `projectRouteUsesIdentityContext` consumers;
- all Provider loader phases in `Provider.buildState`, including catalog conversion, plugin model projection, Auth, plugin auth loaders, and custom loaders.

### Independent agent feedback

No independent Agent was requested by the user, so none was started.

## Evidence-led failure chain

1. Every project-scoped HTTP request normally enters `Instance.provide(..., init: InstanceBootstrap)`.
2. `InstanceBootstrap` validates every configured model reference before the requested route handler runs.
3. Therefore a stale model such as `hexin/claude-opus-5` blocks `GET /provider`, `POST /provider/refresh`, `POST /provider/models/refresh`, and `GET/PATCH /config`, even though these are the exact management surfaces needed to inspect and repair the stale reference.
4. Provider refresh routes additionally combine the durable refresh result with Provider and native-Agent cache invalidation. A failure while settling an already-running state can replace a successful durable refresh with a top-level request failure.
5. `Provider.buildState` is one rejecting promise. A catalog read failure, a single plugin model projection, an Auth read, a plugin auth loader, or one custom Provider loader can reject the full Provider state.
6. Overlay `loadProviderInfo` uses `Promise.all` for catalog/auth and, in global scope, config. A single rejection prevents every successful sibling payload from being committed.
7. `ProvidersPanel` automatically calls both network refresh actions whenever the panel or directory opens, multiplying one bootstrap failure into two visible errors before the stable saved catalog is read.
8. Real-page fault injection exposed a second shared-root expansion: `Config.loadState` synchronously reads the Auth store only to discover an optional well-known remote config URL. One corrupt credential file therefore blocked otherwise valid local config, while Provider plugin catalog/auth/loader phases reported the same underlying Auth failure repeatedly.

## Design

### Management routes use project identity, not runtime bootstrap

The existing project-identity context is the correct ownership primitive for control-plane operations that must repair bootstrap inputs. Exact Provider management routes and `GET/PATCH /config` join that context. Their handlers still load and validate their own required inputs. Runtime endpoints remain on full bootstrap.

This is not a validation bypass: candidate config writes still call `validateConfigCandidate`, model selection still calls `Provider.getModel`, and task execution still requires `InstanceBootstrap`.

### Provider state returns partial data plus diagnostics

`Provider.buildState` owns a structured issue list. Shared catalog failure is reported at catalog scope. Provider-specific projection/loader failures are tagged with the exact Provider ID and phase; the failed Provider is excluded from the connected Provider set while unaffected Providers remain. The Provider list response carries these issues next to `all/default/connected`.

There is no alternate Provider source. Partial results are the successfully materialized members of the same canonical catalog/config/Auth inputs.

### Read requests commit independently

Overlay Provider loading starts catalog, auth, and, for global scope, config concurrently, settles them independently, validates each successful payload, commits each successful owner, retains prior data for failed owners, and stores structured resource failures for display.

Opening the Providers panel performs read-only loading only. Registry refresh and live-model refresh remain explicit button actions. Each button reloads Provider information after its own operation and owns only its own progress/error state.

### Refresh completion is local

Durable refresh success remains the operation result. Cache invalidation is attempted after it and returned as structured issues rather than changing the refresh into an unrelated named error. Failed cache entries are removed by their lifecycle owner so the next read can rebuild them.

### Shared credential failure is reported once

Auth persistence read failures use a typed `Auth.ReadError`, preserving the private file path for server logs while exposing only a scoped, actionable message to clients. Config loading treats that failure as local to the optional well-known remote-config layer and continues with the same local/global config sources. Provider projection recognizes the typed root cause, emits one `auth.read` issue, and suppresses duplicate reports from plugin phases that failed for the same cause.

Plugin initialization remains strict inside the Plugin subsystem. Provider management does not weaken that contract; it isolates the failed plugin-owned Provider projection and keeps the rest of the canonical catalog usable.

## Call-point disposition

| Call point | Disposition |
| --- | --- |
| `projectRouteUsesIdentityContext` | Add exact Provider management and config repair methods. |
| `ProviderRoutes GET /` | Return catalog/connected data with Provider load issues. |
| `GlobalRoutes GET /providers` | Return the same issue contract for global Provider loading. |
| Provider catalog/model refresh routes | Keep separate writers; return cache-invalidation issues without rewriting durable success. |
| `Provider.buildState` catalog conversion | Record shared catalog failure; continue with config-defined Providers. |
| Plugin model projections | Catch per Provider, remove only the failed projection, record issue. |
| Auth loading and plugin auth loaders | Record shared or per-Provider issue; keep catalog availability. |
| Custom Provider loaders | Catch per Provider, remove only that connected projection, record issue. |
| `loadProviderInfo` | Replace fail-fast aggregation with independently settled resource commits and structured failures. |
| `ProvidersPanel` mount | Remove automatic catalog/model refresh; run read-only Provider load. |
| Provider Settings error surface | Render catalog/auth/config/load and refresh issues separately with localized context. |
| Task/runtime model resolution | Preserve strict existing behavior. |

## Verification plan

- Focused server route-context contract for exact management/recovery routes and unchanged runtime routes.
- Provider state contract proving one failing Provider-specific loader does not suppress unaffected Providers and returns the exact issue.
- Provider refresh route contract proving a stale configured model cannot block refresh handler reachability and that refresh writers stay independent.
- Overlay service contract proving catalog/auth/config successes commit independently and rejected resources remain visible as issues.
- Typecheck, route/OpenAPI drift checks, and relevant document-health checks.
- Real headed Providers page using Node-driven Playwright or the in-app browser, with a deliberately failing local resource and a screenshot proving usable Provider rows and a scoped visible error coexist.
- Manual second review of the diff and screenshot before commit/push.

## Verification results

- Focused Auth, Provider refresh, route-context, recovery-route, Auth-route, and Provider projection contracts passed.
- The Overlay Provider-loading service contract passed seven focused cases proving independent resource commits and visible structured issues.
- OpenCorvus and Overlay TypeScript checks passed; generated OpenAPI/SDK output and the route drift check are synchronized.
- Hexin discovery/config-load contracts passed, and the production Overlay build completed successfully.
- A real production Overlay build was served by an isolated OpenCorvus process with a deliberately corrupt `auth.json`. The Providers page retained 85 usable catalog entries and Configure/Connect controls while showing one scoped `auth.read` diagnostic. Explicit model refresh showed one local refresh error without clearing the catalog; Provider declaration refresh remained usable.
- Manual visual review confirmed that the final diagnostic does not expose the API request URL, query string, credential file path, or repeated root-cause prefixes.

## Second review

The first real-page screenshot revealed that one corrupt Auth source was still being amplified through optional well-known config discovery and multiple plugin projection phases. The implementation was revised to type the Auth read failure, isolate it from local config, deduplicate the shared root in Provider projection and Overlay resource loading, and sanitize the client-visible text. A second real-page interaction and screenshot confirmed the corrected one-error/usable-catalog behavior.
