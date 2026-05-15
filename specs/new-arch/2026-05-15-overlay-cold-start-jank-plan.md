# Overlay Cold-Start Jank Plan

> Date: 2026-05-15
> Status: implementation plan

## Evidence

- Current WebView2 renderer consumed 5.56 CPU seconds over a 5 second sample
  while the overlay host process consumed 0 CPU seconds. The visible freeze is
  therefore inside the renderer, not the native host window.
- Startup project-scope probes showed:
  - `/provider`: 3.3 MB response
  - `/config/prompt`: 202 KB response
  - `/tasks`: 110 KB response
- `initApp()` calls `loadInitialData()`, which calls `loadConfigInfo()`.
  `loadConfigInfo()` currently fetches `/provider`, `/provider/auth`,
  `/channel`, and `/config/prompt` unconditionally.
- `ConfigDialogHost` is mounted after `initApp()` even when the settings dialog
  is closed, and its JSX mounts every settings panel at once. Hidden
  `ProvidersPanel`, `AgentModelsPanel`, and `PromptCatalog` still create memos,
  resources, and DOM subscriptions over the large provider/prompt data.

## Root Cause

Cold start is doing settings-page work before the operator asks for settings:

1. Heavy provider/prompt datasets are loaded during normal panel startup.
2. Closed settings UI still mounts heavy tab bodies.
3. The large provider catalog is pushed into Solid stores and re-read by hidden
   panels, burning renderer CPU even before a task stream becomes active.

This is separate from the selected-task stream pressure and from scroll
anchoring. Those can worsen the panel after startup, but they do not explain
"fresh launch already lags".

## Requirements

1. Startup must load only data required for the visible panel shell:
   config, tasks, meta/extensions, and executor descriptors.
2. Provider catalog, provider auth, and prompt catalog must not load during
   cold start unless a visible control needs them.
3. A closed settings dialog must not mount hidden settings tab bodies.
4. Opening model picker controls must explicitly load provider data before
   showing provider/model choices.
5. Opening settings must still refresh settings data through one source of
   truth; no stale compatibility path.

## Implementation

1. Split config bootstrap into a core mode and a settings-data mode.
   - Core mode loads `/config`, `/channel`, and provider auth only when needed
     by visible controls.
   - Settings-data mode additionally loads `/provider` and `/config/prompt`.
2. Use core mode from `loadInitialData()`, project reload, and SSE
   `config.changed` refreshes.
3. Use settings-data mode from `openConfigDialog()`.
4. Add a provider-data loader for visible executor model popovers.
5. Change `ConfigDialogHost` so:
   - the dialog body is rendered only while `dialogStore.config.open` is true;
   - only the active tab body is mounted.

## Validation

- Unit tests must assert startup config loading does not request `/provider` or
  `/config/prompt`.
- Unit tests must assert settings-data loading still preserves partial-failure
  semantics for provider/prompt routes.
- Static guard must assert `ConfigDialogHost` contains a lazy active-tab render
  path and no longer mounts all heavy tab bodies unconditionally.
- Typecheck must pass.
