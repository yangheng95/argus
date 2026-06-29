# Coding Agent TUI Independent Plugin Spec - 2026-06-06

> **Status (2026-06-17): Superseded.** The embedded Coding Agent TUI plugin is
> retired by `specs/records/2026-06/2026-06-10-tui-removal-plan.md`. Current tests
> assert that `packages/coding-agent-tui`, `packages/tui-app`, and
> `/tui/embed/*` stay absent. This file is retained only as historical evidence
> of the plugin-extraction path that was later abandoned.

## Problem

The current Coding Agent TUI integration is not an independent plugin.

The overlay activity is located under `packages/overlay/src/plugins/coding-agent-tui`, but the backend embed target is still owned by OpenCorvus core:

| Current call point                                                      | Current responsibility                                               | Architectural problem                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/overlay/src/plugins/coding-agent-tui/index.tsx`               | Registers the right-side overlay activity.                           | This is only a frontend activity plugin.                           |
| `packages/overlay/src/plugins/coding-agent-tui/CodingAgentTuiPanel.tsx` | Renders captured OpenTUI spans and sends input/resize/poll requests. | Acceptable overlay adapter, but its backend target is core-owned.  |
| `packages/overlay/src/plugins/coding-agent-tui/embedded-target.ts`      | Calls `tui/embed/start`, `status`, `input`, `resize`, `stop`.        | Hardcodes a core route namespace for a plugin feature.             |
| `packages/overlay/src/main.tsx`                                         | Directly imports `codingAgentTuiPlugin`.                             | The overlay shell still knows the concrete plugin at compile time. |
| `packages/overlay/test/coding-assistant-panel.test.ts`                  | Asserts the direct overlay import.                                   | The frontend hardcoding is pinned by tests.                        |
| `packages/opencorvus/src/server/routes/tui.ts`                          | Imports `EmbeddedTui` and exposes `/tui/embed/*`.                    | Core directly owns the plugin service endpoint.                    |
| `packages/opencorvus/src/tui/embedded.ts`                               | Owns sidecar lifecycle and JSON-lines protocol.                      | Plugin-specific renderer lifecycle is in core.                     |
| `packages/opencorvus/src/tui/embedded-worker.tsx`                       | Imports `TuiRoot`, renders frames with OpenTUI test renderer.        | Plugin-specific worker is in core and imports internal app code.   |
| `packages/opencorvus/test/tui/embedded-renderer.test.ts`                | Asserts `TuiRoutes` calls `EmbeddedTui.start`.                       | The wrong architecture is pinned by regression tests.              |
| `packages/overlay/test/tui-host-service.test.ts`                        | Asserts overlay calls `/tui/embed/*`.                                | The wrong route namespace is pinned by regression tests.           |
| `packages/sdk/js/src/gen/*` and `packages/sdk/openapi.json`             | Contain generated `/tui/embed/*` routes.                             | Plugin-specific routes have leaked into the public core SDK.       |

This violates the intended plugin boundary: OpenCorvus core should not know that a coding-agent overlay TUI embed endpoint exists.

## Target Architecture

OpenCorvus core provides generic capabilities only:

1. Project-scoped plugin service routing.
2. Overlay plugin manifest loading.
3. Shared TUI app package consumed through a public package boundary.

The Coding Agent TUI package owns everything specific to the overlay TUI embed:

```mermaid
flowchart LR
  OverlayShell["Overlay shell"] --> OverlayRegistry["Generic overlay plugin registry"]
  OverlayRegistry --> OverlayPlugin["coding-agent-tui overlay plugin"]
  OverlayPlugin --> Contract["coding-agent-tui contract"]
  OverlayPlugin --> PluginRoute["/plugin/coding-agent-tui/embed/*"]
  PluginRoute --> Registry["Core plugin service router"]
  Registry --> BackendPlugin["coding-agent-tui backend plugin"]
  BackendPlugin --> Worker["Plugin-owned OpenTUI renderer worker"]
  Worker --> TuiApp["Shared TUI app package"]
  TuiApp --> SDK["OpenCorvus SDK and project APIs"]
```

Core OpenCorvus must not import `EmbeddedTui`, `embedded-worker`, or any coding-agent-tui module.

The overlay shell must not import `codingAgentTuiPlugin` directly. It imports a generic plugin registry only. Product packaging may generate that registry from plugin manifests, but feature code in `packages/overlay/src/main.tsx` must remain plugin-agnostic.

Completion requires backend and frontend plugin independence together. Moving only the backend service is not sufficient.

## Package Layout

### Shared TUI App Package

Create this package before moving the Coding Agent TUI worker:

```text
packages/tui-app/
  package.json
  src/
    app.tsx
    ...
```

Consumers:

| Consumer                       | New dependency                                               |
| ------------------------------ | ------------------------------------------------------------ |
| OpenCorvus CLI `tui` command   | Imports `TuiRoot` and `tui()` from `@opencorvus-ai/tui-app`. |
| Coding Agent TUI plugin worker | Imports `TuiRoot` from `@opencorvus-ai/tui-app`.             |

This is a hard precondition, not a later cleanup. The Coding Agent TUI package must not import from `packages/opencorvus/src`.

The extracted package must also be independent internally. `packages/tui-app/src` must not import `@/` or `packages/opencorvus/src`. Existing core-dependent calls from the current TUI tree must be split in one of two ways:

1. Move genuinely reusable types/utilities/config readers into public packages consumed by both `opencorvus` and `tui-app`.
2. Convert host-owned capabilities into explicit injected adapters passed through `TuiRootInput`.

Examples of injected adapters include config loading, instance directory/worktree data, event source, SDK client creation, local filesystem helpers, command execution hooks, and platform terminal helpers. The `tui-app` package may depend on `@opencorvus-ai/sdk`, `@opencorvus-ai/plugin/tui`, `@opencorvus-ai/util`, and OpenTUI packages, but not on private `opencorvus` source aliases.

### Coding Agent TUI Package

Create a workspace package:

```text
packages/coding-agent-tui/
  package.json
  src/
    contract.ts
    backend/
      plugin.ts
      server/
        embedded.ts
        embedded-worker.tsx
    overlay/
      index.tsx
      CodingAgentTuiPanel.tsx
      embedded-target.ts
      terminal-size.ts
```

Exports:

```json
{
  "./backend": "./src/backend/plugin.ts",
  "./contract": "./src/contract.ts",
  "./overlay": "./src/overlay/index.tsx"
}
```

Responsibilities:

| File                                     | Responsibility                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/contract.ts`                        | Shared route constants, request schemas, response types, and error formatting helpers used by backend and overlay. |
| `src/backend/plugin.ts`                  | Exports the backend plugin function that registers the plugin service routes.                                      |
| `src/backend/server/embedded.ts`         | Owns worker lifecycle, request queue, diagnostics, and start/status/input/resize/stop methods.                     |
| `src/backend/server/embedded-worker.tsx` | Owns frame capture, OpenTUI rendering, input injection, resize, and JSON-lines worker protocol.                    |
| `src/overlay/*`                          | Owns the overlay activity manifest, panel, API target, resize helper, and visual rendering adapter.                |

### Overlay Plugin Host

Move the concrete overlay adapter out of:

```text
packages/overlay/src/plugins/coding-agent-tui/
```

The overlay shell keeps only generic host code:

```text
packages/overlay/src/plugins/
  registry.ts
  right-activity.ts
```

`packages/overlay/src/main.tsx` imports only the generic registry. It must not import `@opencorvus-ai/coding-agent-tui/overlay` or any plugin-specific module directly.

The overlay shell must also remove static plugin DOM. `packages/overlay/src/index.html` must not contain `chatTuiPane`, `solidTuiHostMount`, or any coding-agent-tui-specific pane/mount ID. The shell owns generic outlets only, for example:

```text
rightActivityOutlet
chatPluginOutlet
```

Each overlay plugin contribution declares its own activity ID, label key, mount behavior, CSS bundle, i18n keys, and render function through the registry. The registry mounts plugin bodies into generic outlets at runtime. Shell CSS and i18n files must not contain coding-agent-tui-specific selectors or strings unless they are generated from the plugin manifest.

Product packaging owns the default plugin list. A generated registry file may import `@opencorvus-ai/coding-agent-tui/overlay`, but that generated file is packaging output, not feature logic. The generated registry must be the single source for default overlay plugins.

The overlay adapter may depend on `@opencorvus-ai/coding-agent-tui/contract`, but it must not know backend implementation details.

Required route namespace:

```text
plugin/coding-agent-tui/embed/start
plugin/coding-agent-tui/embed/status
plugin/coding-agent-tui/embed/input
plugin/coding-agent-tui/embed/resize
plugin/coding-agent-tui/embed/stop
```

`/tui/embed/*` must be deleted, not kept as a compatibility alias.

## Core Plugin Service API

The existing `@opencorvus-ai/plugin` backend API has hooks, tools, auth, config, and evaluation hooks, but no service route registration ability.

Add a route registration API using Hono rather than a hand-written router.

`packages/plugin/package.json` must add `hono` as a direct dependency because `Hono` becomes part of the public plugin API.

### Public Types

In `packages/plugin/src/index.ts`:

```ts
import type { Hono } from "hono"

export type PluginServiceRegistration = {
  id: string
  app: Hono
}

export interface Hooks {
  service?: () => Promise<PluginServiceRegistration | PluginServiceRegistration[] | void>
}
```

The service hook captures `PluginInput` from the plugin initializer closure. Do not add a second `PluginServiceInput` copy of `directory`, `worktree`, or `serverUrl`; that would create a drifting type source.

Rules:

| Rule                                                                    | Reason                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id` is required and must be stable.                                    | It becomes the route namespace under `/plugin/:id/*`.                                    |
| Duplicate `id` is an error.                                             | No route shadowing or fallback order.                                                    |
| Service apps are project-scoped.                                        | The existing directory guard remains the single source for project binding.              |
| Plugin services are not generated into the core SDK.                    | Dynamic plugin endpoints do not belong to the static core OpenAPI surface.               |
| Service registration errors are visible request errors.                 | Missing/broken plugins must not fall back to `/tui/embed/*`.                             |
| Registration diagnostics are stored by plugin specifier and service ID. | Requests must show the real load/register failure rather than a generic missing service. |

### Core Runtime

In `packages/opencorvus/src/plugin/index.ts`:

1. Preserve loaded plugin metadata instead of storing only raw hooks.
2. Add `Plugin.services()` that returns the project-scoped service registrations.
3. Validate duplicate service IDs.
4. Cache service registrations in `lazyInstanceState`, same as hooks.
5. Do not import the Coding Agent TUI plugin directly.
6. Store service diagnostics for install, load, duplicate ID, and registration failures.
7. Expose diagnostics to `PluginRoutes()` so `/plugin/:id/*` can return the real failure for a known-but-broken plugin.

In `packages/opencorvus/src/server/routes/plugin.ts`:

1. Add `PluginRoutes()`.
2. Register only an undocumented wildcard dispatch such as `all("/:id/*", ...)`.
3. Dispatch the suffix path to the registered Hono app for `id`.
4. Return `PluginServiceNotFoundError` when the service ID is unknown.
5. Return `PluginServiceRegistrationError` when the service ID is known but failed to load or register.
6. Do not implement any feature-specific behavior in this router.

Dispatch must clone the incoming request URL so the plugin app sees `/embed/status?x=1`, not `/plugin/coding-agent-tui/embed/status?x=1`. It must preserve method, headers, query string, body, and abort signal. Tests must cover path rewrite and body/header preservation.

In `packages/opencorvus/src/server/routes/app.ts`:

```ts
.route("/plugin", PluginRoutes())
```

Place it after project directory enforcement, so plugin services remain project-scoped.

In `packages/opencorvus/src/server/error-handler.ts`, add explicit status mapping:

| Error                            | Status |
| -------------------------------- | ------ |
| `PluginServiceNotFoundError`     | `404`  |
| `PluginServiceRegistrationError` | `500`  |
| `PluginServiceDuplicateIDError`  | `500`  |

The route inventory checker must understand that `/plugin/:id/*` is a dynamic raw dispatch entry. Plugin internals do not enter `Server.routeInventoryApp()`, OpenAPI, or the generated SDK. Because `Server.routeInventoryApp()` filters `ALL` routes and `api:routes-check` skips paths containing `*`, the implementation should add explicit tests that the wildcard route exists and that OpenAPI/SDK do not contain plugin internals. Do not add feature-specific plugin paths to OpenAPI/SDK.

## Coding Agent TUI Backend Plugin

The backend plugin exports a normal OpenCorvus plugin:

```ts
export const codingAgentTui = async (input: PluginInput): Promise<Hooks> => ({
  service: async () => ({
    id: "coding-agent-tui",
    app: CodingAgentTuiRoutes(input),
  }),
})
```

Its route app owns:

| Method | Path            | Responsibility                                            |
| ------ | --------------- | --------------------------------------------------------- |
| `POST` | `/embed/start`  | Validate start input and start the renderer worker.       |
| `GET`  | `/embed/status` | Return frame/status for the requested task-scoped target. |
| `POST` | `/embed/input`  | Send text/key input.                                      |
| `POST` | `/embed/resize` | Resize the renderer.                                      |
| `POST` | `/embed/stop`   | Stop the renderer.                                        |

### Contract

Schemas move from `packages/opencorvus/src/tui/embedded.ts` to `packages/coding-agent-tui/src/contract.ts`.

`contract.ts` must export one canonical path builder. Do not export both leading-slash and no-leading-slash path constants.

```ts
export const CODING_AGENT_TUI_SERVICE_ID = "coding-agent-tui"

export function codingAgentTuiPath(
  path: "embed/start" | "embed/status" | "embed/input" | "embed/resize" | "embed/stop",
) {
  return `plugin/${CODING_AGENT_TUI_SERVICE_ID}/${path}`
}
```

All service calls include a task-scoped preview target. The service must not keep one project-global latest frame.

```ts
export type CodingAgentTuiTarget = {
  kind: "task-preview"
  directory: string
  taskID: string
  targetID: string
}
```

Targets and evidence are persisted through the existing task artifact model, following `packages/opencorvus/src/browser-preview/persist.ts`.

Required artifact kinds:

```ts
export const CODING_AGENT_TUI_TARGET_KIND = "coding_agent_tui_target"
export const CODING_AGENT_TUI_FRAME_EVIDENCE_KIND = "coding_agent_tui_frame_evidence"
```

The backend service creates or resolves `CODING_AGENT_TUI_TARGET_KIND` before starting a renderer. `targetID` must be a persisted `EngineArtifactTable.id` for the same `taskID` and `directory`; caller-supplied target IDs are validated by lookup, not trusted. The renderer session key is the persisted `{ directory, taskID, targetID }`.

Each captured frame writes `CODING_AGENT_TUI_FRAME_EVIDENCE_KIND` with:

| Field                    | Source                                                 |
| ------------------------ | ------------------------------------------------------ |
| `task_id`                | Request target task ID.                                |
| `payload.target_id`      | Persisted target artifact ID.                          |
| `payload.frame_hash`     | Hash of serialized frame text/spans.                   |
| `payload.capture`        | Serialized frame or reference to stored frame payload. |
| `payload.diagnostics`    | Worker diagnostics visible to the UI.                  |
| `payload.time_completed` | Capture timestamp.                                     |

Start/status/input/resize/stop requests are keyed by `{ directory, target }`. Responses include the same persisted `target`, the latest persisted evidence ID, and evidence metadata:

```ts
export type CodingAgentTuiEvidence = {
  kind: "opentui-frame"
  directory: string
  taskID: string
  targetID: string
  evidenceID: string
  capturedAt: number
  frameHash: string
}
```

The overlay renders only the frame returned for the requested persisted target and evidence. It must not create local target IDs, use local signal/query overrides, or use a project-wide singleton frame to impersonate task-scoped evidence.

The worker lifecycle moves from `packages/opencorvus/src/tui/embedded.ts` to `packages/coding-agent-tui/src/backend/server/embedded.ts`.

The worker moves from `packages/opencorvus/src/tui/embedded-worker.tsx` to `packages/coding-agent-tui/src/backend/server/embedded-worker.tsx`.

## Default Availability

Default availability must not be implemented by a hardcoded core import or by separate backend/overlay enablement lists.

Use one plugin manifest as the single source for backend service, overlay contribution, resources, diagnostics, and packaging.

```ts
export type OpenCorvusPluginManifest = {
  packageSpecifier: string
  serviceID: string
  backendExport: string
  overlayExport: string
  resources: Array<{
    kind: "worker" | "asset" | "runtime"
    path: string
  }>
}
```

`ID` means identifier. Code adding `serviceID` or `PluginServiceDuplicateIDError` must include this abbreviation comment near the public type or error definition.

The backend config loader, overlay generated registry, service diagnostics, and packaging resource collector all read the same manifest. A package must not be enabled in overlay without the matching backend manifest entry, and the backend must not expose a plugin service whose overlay contribution is missing from the same packaged profile.

Acceptable options:

| Option                                                                  | Decision                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Project/global config references the plugin manifest package.           | Preferred for a real plugin.                                                     |
| Overlay packaging installs/enables the manifest in its managed profile. | Acceptable product packaging layer.                                              |
| `Plugin.INTERNAL_PLUGINS` imports the plugin directly.                  | Not acceptable for the final target because core would know the concrete plugin. |

For local development, use config-based enablement with the workspace package manifest specifier or a file URL generated by the package manager. Tests may use a fixture manifest path.

## Packaging And Sidecar Resolution

This refactor must cover the packaging path that caused the original missing executable failure. Moving files without packaging evidence is not sufficient.

Required package changes:

| File or area                                 | Required change                                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root `package.json` workspaces               | Include `packages/coding-agent-tui` and `packages/tui-app` through the existing workspace pattern and ensure package names are unique.                                     |
| `packages/opencorvus/package.json`           | Depend on `@opencorvus-ai/tui-app`; do not depend on `@opencorvus-ai/coding-agent-tui`.                                                                                    |
| `packages/overlay/package.json`              | Depend on the overlay plugin registry input or `@opencorvus-ai/coding-agent-tui` only through packaging-generated plugin manifest wiring.                                  |
| `packages/plugin/package.json`               | Add direct `hono` dependency if `Hono` remains the public service app type.                                                                                                |
| `script/package-local.ts`                    | Include plugin packages and manifests in local package output.                                                                                                             |
| `packages/overlay/script/build.ts`           | Stage plugin manifest/resources alongside the embedded opencorvus server dist before Tauri build.                                                                          |
| `packages/overlay/script/build-docker.ts`    | Mirror the local build resource staging for release builds.                                                                                                                |
| `packages/overlay/src-tauri/build.rs`        | Archive the plugin manifest, backend entry, overlay contribution, worker entry, shared TUI app runtime, and required node_modules files into the embedded sidecar payload. |
| `packages/overlay/src-tauri/src/main.rs`     | Verify extracted embedded payload completeness before spawning the sidecar.                                                                                                |
| `packages/overlay/src-tauri/tauri.conf.json` | Keep the resource pattern aligned with the staged embedded payload.                                                                                                        |
| Worker resolution                            | Resolve the worker entry from the plugin package location, not from `packages/opencorvus/src/tui`.                                                                         |

Verification must include inspecting the packaged artifact or generated resource list for:

1. `@opencorvus-ai/coding-agent-tui` backend plugin entry.
2. `@opencorvus-ai/coding-agent-tui/overlay` contribution entry.
3. The OpenTUI worker executable.
4. The shared `@opencorvus-ai/tui-app` runtime.
5. The plugin manifest.
6. Required runtime dependencies under deterministic relative paths.

Expected embedded archive relative paths include:

```text
plugins/coding-agent-tui/plugin.json
coding-agent-tui-worker.exe              # Windows
coding-agent-tui-worker                  # Linux/macOS
node_modules/@opencorvus-ai/coding-agent-tui/src/backend/server/embedded.ts
node_modules/@opencorvus-ai/coding-agent-tui/src/overlay/index.tsx
node_modules/@opencorvus-ai/coding-agent-tui/node_modules/@opencorvus-ai/tui-app/src/embedded.tsx
node_modules/@opencorvus-ai/coding-agent-tui/node_modules/@opencorvus-ai/tui-app/src/app.tsx
node_modules/@opentui/core/
node_modules/@opentui/solid/
node_modules/@opentui/keymap/
```

The current manifest-resource checkpoint uses source package files copied into the sidecar payload by `copyRuntimeNodeModules()` for backend, overlay, and shared TUI runtime files. The worker is no longer a source `src/backend/server/embedded-worker.tsx` runtime resource: `build.ts` and `build.local.ts` compile that source entry into `coding-agent-tui-worker(.exe)`, and the plugin backend resolves the manifest `embedded-worker` resource from `PluginInput.resources` before spawning it.

Exact file extensions may differ after final bundling, but the manifest must list the concrete paths and Rust completeness checks must validate every listed required resource. Missing resources must produce a visible startup error before attempting to spawn a sidecar process.

The packaged overlay must fail visibly when the plugin package is absent. It must not silently fall back to `/tui/embed/*` or a built-in core renderer.

## Migration And Deletion

Delete these core files after migration:

```text
packages/opencorvus/src/tui/embedded.ts
packages/opencorvus/src/tui/embedded-worker.tsx
packages/overlay/src/plugins/coding-agent-tui/
```

Remove these imports/routes:

| File                                                       | Required change                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/server/routes/tui.ts`             | Remove `EmbeddedTui` import and all `/embed/*` routes.                                       |
| `packages/opencorvus/src/server/routes/app.ts`             | Add generic `/plugin` route.                                                                 |
| `packages/overlay/src/main.tsx`                            | Remove direct `codingAgentTuiPlugin` import; load generic overlay plugin registry.           |
| `packages/overlay/src/index.html`                          | Remove static `chatTuiPane`, `solidTuiHostMount`, and coding-agent-tui-specific pane markup. |
| `packages/overlay/test/coding-assistant-panel.test.ts`     | Stop asserting a direct coding-agent-tui import from overlay main.                           |
| `packages/sdk/openapi.json`                                | Remove `/tui/embed/*` entries after route regeneration.                                      |
| `packages/sdk/js/src/gen/sdk.gen.ts`                       | Remove generated `/tui/embed/*` calls after SDK regeneration.                                |
| `packages/sdk/js/src/gen/types.gen.ts`                     | Remove generated `/tui/embed/*` types after SDK regeneration.                                |
| `packages/coding-agent-tui/src/overlay/embedded-target.ts` | Use the canonical contract path builder for `/plugin/coding-agent-tui/embed/*`.              |

No compatibility alias is allowed.

## Tests

### Core Plugin Service Tests

Add tests under `packages/opencorvus/test/plugin` or `packages/opencorvus/test/server`:

| Test                                    | Assertion                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Registers plugin service route          | A fixture plugin with `service.id = "fixture"` handles `/plugin/fixture/ping`.                                              |
| Wildcard dispatch rewrite               | `/plugin/fixture/ping?x=1` reaches plugin app as `/ping?x=1` with method, body, headers, and abort signal preserved.        |
| Unknown plugin service is visible error | `/plugin/missing/ping` returns a named error, not 404 from a hidden fallthrough.                                            |
| Unknown plugin status mapping           | `PluginServiceNotFoundError` maps to 404.                                                                                   |
| Registration failure status mapping     | `PluginServiceRegistrationError` maps to 500 with the stored diagnostic message.                                            |
| Duplicate service ID fails              | Two plugins registering the same `id` fail initialization visibly.                                                          |
| Project directory required              | `/plugin/fixture/ping` requires `?directory=` or `x-opencorvus-directory`.                                                  |
| Core route inventory stays clean        | Only the undocumented wildcard dispatch is exempted; plugin internals do not leak into generated SDK as static core routes. |
| OpenAPI and SDK stay clean              | Generated OpenAPI/SDK contain no plugin internals even when fixture plugin service exists.                                  |

### Coding Agent TUI Plugin Tests

Move and update renderer tests:

| Old test                                                 | New assertion                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/opencorvus/test/tui/embedded-renderer.test.ts` | No longer asserts `TuiRoutes` owns `EmbeddedTui`.                                     |
| Renderer probe                                           | Lives under `packages/coding-agent-tui/test` or uses the package worker path.         |
| Input test                                               | Calls plugin route `/plugin/coding-agent-tui/embed/input` with a task-scoped target.  |
| Resize test                                              | Calls plugin route `/plugin/coding-agent-tui/embed/resize` with a task-scoped target. |
| Stop test                                                | Calls plugin route `/plugin/coding-agent-tui/embed/stop` with a task-scoped target.   |
| Evidence test                                            | Status response includes `taskID`, `targetID`, `capturedAt`, and `frameHash`.         |

### Overlay Tests

Update:

```text
packages/overlay/test/coding-assistant-panel.test.ts
packages/overlay/test/tui-host-service.test.ts
packages/overlay/test/tui-host-panel.test.ts
packages/overlay/test/tui-host-panel-visual.test.ts
```

Required assertions:

| Test area                    | Assertion                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Service calls                | All requests use the canonical contract path builder for `plugin/coding-agent-tui/embed/*`.                        |
| No core embed route          | Tests must not contain `tui/embed`.                                                                                |
| No direct overlay import     | Overlay main imports only the generic plugin registry, not `codingAgentTuiPlugin`.                                 |
| No static plugin DOM         | Overlay HTML/source contains no `chatTuiPane`, `solidTuiHostMount`, or coding-agent-tui-specific body ID.          |
| Overlay contribution package | The coding-agent-tui overlay contribution is exported from `@opencorvus-ai/coding-agent-tui/overlay`.              |
| Visible failure              | Named plugin service errors render in the panel without leaking secret fields.                                     |
| Visual panel                 | Mock server uses plugin route namespace, task target, and evidence metadata while rendering a real captured frame. |

### Static Guards

Add guards:

| Guard                                                       | Assertion                                                                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Core must not import plugin implementation                  | `packages/opencorvus/src` contains no `coding-agent-tui` import.                                                        |
| Core must not contain embed renderer                        | `packages/opencorvus/src/tui` contains no `embedded.ts` or `embedded-worker.tsx`.                                       |
| Plugin must not import OpenCorvus source internals          | `packages/coding-agent-tui/src` contains no import from `packages/opencorvus/src` or `@/`.                              |
| TUI app package must not import OpenCorvus source internals | `packages/tui-app/src` contains no import from `packages/opencorvus/src` or `@/`.                                       |
| Overlay main must not import concrete plugin                | `packages/overlay/src/main.tsx` contains no `codingAgentTuiPlugin` or `coding-agent-tui` import.                        |
| Overlay static shell must not contain plugin DOM            | `packages/overlay/src/index.html` contains no `chatTuiPane`, `solidTuiHostMount`, or coding-agent-tui-specific body ID. |
| SDK must not expose `/tui/embed/*`                          | Generated SDK and OpenAPI contain no `/tui/embed`.                                                                      |
| Overlay must not call `/tui/embed/*`                        | Overlay source contains no `tui/embed`.                                                                                 |
| Contract path source is single                              | Overlay/backend use `codingAgentTuiPath`; no duplicate string builder exists.                                           |
| Manifest source is single                                   | Backend config, overlay registry generation, diagnostics, and packaging read the same plugin manifest.                  |
| Evidence source is persisted                                | Coding-agent-tui targets and frame evidence are stored in task artifacts, not overlay-local state.                      |

### Packaging Tests

Add tests or scripts that can run without a full Tauri bundle:

| Test                           | Assertion                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource manifest inspection   | Staged embedded payload contains manifest, backend entry, overlay entry, worker entry, `tui-app`, and required OpenTUI runtime dependencies. |
| Rust completeness source guard | `build.rs` emits required plugin resource entries and `main.rs` verifies them before sidecar spawn.                                          |
| Missing plugin package         | Packaged overlay profile surfaces plugin-service diagnostic error instead of spawning a missing executable or falling back to core embed.    |

## Verification Commands

Targeted verification:

```powershell
bun test packages/opencorvus/test/plugin packages/opencorvus/test/server/plugin-service.test.ts
bun test packages/coding-agent-tui/test
bun test packages/overlay/test/tui-host-service.test.ts packages/overlay/test/tui-host-panel.test.ts packages/overlay/test/tui-host-panel-visual.test.ts
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/overlay typecheck
bun run --cwd packages/coding-agent-tui typecheck
bun run --cwd packages/tui-app typecheck
bun run typecheck
bun run api:routes-check
bun run docs:check
bun run check:dead-code
bun test packages/overlay/test/embedded-plugin-resources.test.ts
```

Full pre-push verification remains the existing hook path.

## Implementation Phases

### Phase 1: Shared TUI App Extraction

1. Create `packages/tui-app`.
2. Move the reusable TUI app tree behind the public `@opencorvus-ai/tui-app` package boundary.
3. Replace private `@/` imports with public package imports or injected adapters.
4. Define the host adapter interface for config, SDK, event source, project paths, local filesystem helpers, command hooks, and terminal/platform helpers.
5. Update OpenCorvus CLI to import the TUI app package and provide the host adapters.
6. Add static guards that `packages/tui-app/src` and plugin packages cannot import from `packages/opencorvus/src`.

Exit criteria: OpenCorvus CLI still renders TUI through `@opencorvus-ai/tui-app`, and no consumer needs a private `packages/opencorvus/src/cli/cmd/tui/app.tsx` import.

2026-06-06 boundary correction status:

- OpenCorvus CLI TUI entrypoints must import `tui()` from `@opencorvus-ai/tui-app`; tests must reject any return to `./app`.
- `packages/tui-app` must expose a real OpenTUI render root that consumes the public `TuiRootInput` contract, host adapters, event source, args, directory, and terminal dimensions. A static title-only placeholder is not acceptable.
- The historical core TUI subtree is not yet fully migrated. The remaining work is to split the 134-file tree into public reusable TUI code plus injected host adapters for the private `@/` dependencies found under `packages/opencorvus/src/cli/cmd/tui/**`.
- Until that split is complete, review must treat Phase 1 as boundary-corrected but not extraction-complete. Tests must not assert that the core private `app.tsx` is the canonical embedded renderer.

### Phase 2: Generic Plugin Service Mount

1. Extend `@opencorvus-ai/plugin` types with `Hooks.service`.
2. Add `Plugin.services()` in core plugin runtime.
3. Add generic `/plugin/:id/*` router.
4. Add service diagnostics and NamedError status mappings.
5. Add fixture tests for registration, unknown ID, registration failure, duplicate ID, and project directory binding.

Exit criteria: core can route a plugin-owned Hono app without knowing any concrete plugin.

### Phase 3: Move Coding Agent TUI Backend To Plugin Package

1. Create `packages/coding-agent-tui`.
2. Move schemas, worker lifecycle, and worker implementation into the package.
3. Register routes from the package backend plugin.
4. Remove `/tui/embed/*` from `TuiRoutes`.
5. Key renderer sessions by task-scoped target, not project singleton.
6. Update tests to call `/plugin/coding-agent-tui/embed/*`.

Exit criteria: `rg "EmbeddedTui|tui/embed|embedded-worker" packages/opencorvus/src` returns no core implementation references, and plugin status responses include evidence metadata.

### Phase 4: Overlay Plugin Migration

1. Move the overlay adapter from `packages/overlay/src/plugins/coding-agent-tui` into `packages/coding-agent-tui/src/overlay`.
2. Add generic overlay plugin registry loading in `packages/overlay`.
3. Replace static plugin panes in `index.html` with generic plugin outlets.
4. Move coding-agent-tui-specific CSS and i18n ownership into the plugin contribution or generated manifest output.
5. Overlay main imports only the registry.
6. Overlay service imports route constants and types from `@opencorvus-ai/coding-agent-tui/contract`.
7. Overlay tests assert the plugin namespace, task target, evidence fields, no direct plugin import, and no static plugin DOM.
8. Visual tests use plugin route mocks.

Exit criteria: overlay has no hardcoded `/tui/embed/*` and no direct coding-agent-tui import from feature code.

### Phase 5: Packaging And Default Enablement

1. Wire the default plugin through the single manifest, not core import or separate backend/overlay lists.
2. Update `script/package-local.ts`, `packages/overlay/script/build.ts`, `packages/overlay/script/build-docker.ts`, and Tauri resource configuration.
3. Update `packages/overlay/src-tauri/build.rs` to archive manifest-listed resources.
4. Update `packages/overlay/src-tauri/src/main.rs` to verify manifest-listed resources before sidecar spawn.
5. Add resource manifest inspection tests.
6. Verify packaged resources include backend plugin, overlay contribution, worker entry, and `@opencorvus-ai/tui-app`.
7. Verify missing plugin package produces visible plugin-service error.

Exit criteria: packaged overlay can load the plugin without a core import and without missing sidecar/resource paths.

### Phase 6: SDK And Documentation Cleanup

1. Regenerate OpenAPI and SDK.
2. Remove `/tui/embed/*` from tracked generated files.
3. Update docs if any mention the core embed route.
4. Run `api:routes-check` and `docs:check`.

Exit criteria: core public API surface no longer lists plugin-specific embed routes.

## Acceptance Criteria

The refactor is complete only when all are true:

1. No `/tui/embed/*` route exists.
2. No `EmbeddedTui` implementation exists in `packages/opencorvus/src`.
3. OpenCorvus core does not import `coding-agent-tui`.
4. `packages/tui-app/src` does not import `packages/opencorvus/src` or `@/`.
5. `packages/coding-agent-tui/src` does not import `packages/opencorvus/src` or `@/`.
6. `packages/overlay/src/main.tsx` does not import a concrete coding-agent-tui module.
7. `packages/overlay/src/index.html` does not contain static coding-agent-tui pane/mount IDs.
8. A single plugin manifest drives backend loading, overlay contribution, diagnostics, and packaging.
9. The overlay calls `/plugin/coding-agent-tui/embed/*` through the canonical contract path builder.
10. The backend route is registered by the plugin service API.
11. The backend route is keyed by persisted task-scoped target and returns persisted evidence metadata.
12. The generated SDK and OpenAPI do not expose `/tui/embed/*` or plugin internals.
13. Visual overlay verification still shows a nonblank, readable OpenTUI frame from persisted task-scoped backend evidence.
14. Missing/broken plugin service produces a visible diagnostic error, not a fallback route.
15. Packaged overlay artifacts include the manifest, backend plugin, overlay contribution, worker entry, shared TUI app package, and required runtime dependencies.
16. Tauri extraction verifies manifest-listed resources before sidecar spawn.
17. Tests cover the new plugin route, old route deletion, overlay route migration, overlay registry loading, static DOM deletion, error status mapping, packaging resources, and persisted evidence metadata.

## Implementation Audit - 2026-06-06

Independent review after implementation found that the work is partially complete, not finished. Current status:

| Area                                     | Status                                 | Evidence / remaining work                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic plugin service routing           | Implemented                            | `/plugin/:id/*` dispatch, diagnostics, duplicate-ID handling, and old `/tui/embed/*` deletion are covered by `packages/opencorvus/test/server/plugin-service-routes.test.ts`.                                                                                                                                                                                                                                                                                                      |
| Coding Agent TUI backend package         | Implemented                            | Backend routes live in `packages/coding-agent-tui`; task target/evidence is persisted through plugin `taskArtifacts`; renderer worker resolution now comes from manifest-backed `PluginInput.resources` and spawns the compiled `coding-agent-tui-worker(.exe)` resource.                                                                                                                                                                                                          |
| Task-scoped target/evidence              | Implemented                            | Requests require `{ directory, target }`; target artifacts are directory-scoped; frame evidence artifacts include `directory`, `targetID`, `evidenceID`, `capturedAt`, and `frameHash`.                                                                                                                                                                                                                                                                                            |
| Overlay route migration                  | Mostly implemented                     | Overlay calls `plugin/coding-agent-tui/embed/*` through the contract path builder and visual tests render plugin evidence; remaining issue is CSS/i18n ownership still lives in shell files unless generated from manifest.                                                                                                                                                                                                                                                        |
| Default manifest / resource verification | Implemented for worker/backend payload | `packages/coding-agent-tui/plugin.json` lists OS-specific worker executable paths plus runtime resources; `packages/opencorvus/script/build.ts` and `build.local.ts` compile `coding-agent-tui-worker(.exe)` and validate manifest resources; real Windows `overlay-server --single` packaging produced the worker; `packages/overlay/src-tauri/build.rs` emits manifest-listed resources and fixture-backed `main.rs` tests verify resource inclusion and worker executable mode. |
| Shared `tui-app` extraction              | Not complete                           | CLI entrypoints import `@opencorvus-ai/tui-app`, and the package has no private `@/` imports, but the real 134-file TUI tree remains under `packages/opencorvus/src/cli/cmd/tui`. The current `packages/tui-app/src/app.tsx` is a minimal render root and must not be accepted as final extraction.                                                                                                                                                                                |
| Overlay manifest as single source        | Partially implemented                  | `packages/overlay/script/generate-overlay-plugins.ts` generates `src/generated/overlay-plugins.ts` from `packages/coding-agent-tui/plugin.json` before overlay typecheck/build; remaining issue is CSS/i18n ownership still lives in shell files unless generated from manifest.                                                                                                                                                                                                   |

The next implementation pass must prioritize the remaining P0 item: true shared TUI extraction. A review that treats the current minimal `tui-app` as complete is invalid.

## Independent Review Feedback

Codex independent review on 2026-06-06 found the first draft was still incomplete. This revision incorporates the review feedback:

| Review finding                                                                                                             | Revision                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Temporary dependency from `packages/coding-agent-tui` to `packages/opencorvus/src/cli/cmd/tui/app.tsx` kept core coupling. | `packages/tui-app` extraction is now Phase 1 and a hard precondition.                                           |
| Overlay adapter remained hardcoded in overlay source.                                                                      | Overlay adapter moved into `packages/coding-agent-tui/src/overlay`; overlay main loads only a generic registry. |
| `/plugin/:id/*` conflicted with static route inventory expectations.                                                       | Plugin route is now an undocumented wildcard dispatch; plugin internals stay out of OpenAPI/SDK.                |
| Plugin load failures would collapse into unknown service.                                                                  | Service diagnostics are now required by spec.                                                                   |
| NamedError status mapping was missing.                                                                                     | `PluginServiceNotFoundError`, `PluginServiceRegistrationError`, and duplicate-ID mapping are specified.         |
| Project-scoped latest frame did not satisfy task-scoped preview/evidence rules.                                            | Contract now requires task-scoped target and evidence metadata.                                                 |
| Packaging/default enablement was underspecified.                                                                           | Packaging, Tauri resources, worker resolution, and artifact verification are now explicit.                      |
| `PluginServiceInput` duplicated `PluginInput`.                                                                             | Service hook now captures `PluginInput`; no duplicate input type.                                               |
| Public `Hono` type lacked package dependency.                                                                              | `packages/plugin/package.json` must add `hono` if Hono remains public API.                                      |
| Route constants could drift.                                                                                               | Contract now exports one canonical path builder.                                                                |

Second independent review on 2026-06-06 found additional implementation blockers. This revision also incorporates that feedback:

| Review finding                                                                                      | Revision                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/tui-app` could still indirectly import core internals through existing `@/` dependencies. | `tui-app` now forbids `@/` and private opencorvus imports; Phase 1 requires public adapters or injected host capabilities.                     |
| Overlay shell still had static plugin DOM IDs.                                                      | Spec now requires generic plugin outlets and guards against `chatTuiPane`, `solidTuiHostMount`, and coding-agent-tui-specific shell DOM.       |
| Backend config and overlay registry could become separate default-enable sources.                   | Spec now requires one plugin manifest driving backend service, overlay contribution, diagnostics, and packaging.                               |
| Task evidence was response-only rather than persisted source of truth.                              | Spec now requires persisted task artifacts for coding-agent-tui targets and frame evidence, following browser-preview persistence.             |
| Packaging did not name the scripts/Rust checks that caused the original missing sidecar failure.    | Spec now names `build.ts`, `build-docker.ts`, `build.rs`, `main.rs`, `tauri.conf.json`, expected archive paths, and resource inspection tests. |
| Hono dispatch path rewriting was underspecified.                                                    | Spec now requires cloned request URL rewrite with method/body/header/query preservation tests.                                                 |
| Route inventory wildcard behavior was misdescribed.                                                 | Spec now requires explicit tests for wildcard existence and SDK/OpenAPI cleanliness instead of relying on route inventory reporting.           |

## Superseded Spec

This supersedes the backend ownership conclusion in retired root note
`specs/coding-agent-tui-overlay-plugin-decoupling-2026-06-06.md`.

That earlier spec correctly identified that a generic browser PTY terminal was not a valid OpenTUI embed, but it incorrectly accepted OpenCorvus core ownership of `/tui/embed/*`. This spec replaces that with a plugin-owned service route.

## Runtime Re-alignment Audit - 2026-06-06

The packaged coding-agent-tui worker must not render the minimal `packages/tui-app` root. That package remains a boundary probe and is not the acceptance target for the overlay TUI tab.

The active packaged chain is:

```text
overlay plugin -> /plugin/coding-agent-tui/embed/start -> manifest resource embedded-worker -> packages/opencorvus/src/cli/cmd/tui/embedded-worker.tsx -> packages/opencorvus/src/cli/cmd/tui/app.tsx TuiRoot -> OpenTUI captured frame
```

Packaging must compile `coding-agent-tui-worker(.exe)` from the opencorvus-owned embedded worker entrypoint, and the plugin manifest must also list `opencorvus-tui(.exe)` so the overlay-server payload validates the real TUI sibling artifact. A missing `embedded-worker` resource is a startup error with a visible diagnostic; it must not fall back to source TSX or `process.execPath`.
