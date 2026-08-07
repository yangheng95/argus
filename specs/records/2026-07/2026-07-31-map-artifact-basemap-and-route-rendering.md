# Map Artifact Basemap and Route Rendering

## Recall

### User request

- Diagnose why the real `map@1` Artifact for the Wuhan to Hangzhou driving-route comparison shows only floating markers on a blank surface.
- Repair the product rather than explaining the limitation as accepted behavior.

### Acceptance

- The same persisted Artifact renders recognizable geographic context, including roads, place labels, and administrative geography.
- Both persisted `LineString` route features are visibly rendered and distinguishable.
- Map controls and provider/data attribution remain visible.
- The Artifact is not marked ready until the inline GeoJSON source has completed loading.
- Compact and fullscreen surfaces keep MapLibre pan, zoom, resize, theme, and cleanup behavior.
- A real page is opened and manually inspected in compact and fullscreen modes with screenshots. No UI automation test, fixture, snapshot, assertion file, or baseline is added, modified, or run.

### Hard constraints

- `map@1` payloads continue to own only inline Geographic JavaScript Object Notation (GeoJSON). They cannot inject style URLs, tile URLs, scripts, or another renderer.
- The Overlay owns one explicit basemap configuration and one MapLibre renderer. No empty-style fallback or payload-selected provider is retained.
- The basemap provider, style endpoint, and attribution are declared outside the component rather than hard-coded across rendering branches.
- Provider attribution is always visible.
- Preserve all parallel work. Commit only task-owned paths with the `dsw-33987` prefix and push the current main delivery branch to `legacy-remote`.

### Materials read

- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-29-interactive-artifact-rendering-completeness.md`
- `packages/opencorvus/src/interactive-artifact/schema.ts`
- `packages/opencorvus/src/prompt/fragments/interactive-artifact-guidance.ts`
- `packages/overlay/src/components/InteractiveArtifactPart.tsx`
- `packages/overlay/src/components/interactive-artifact/MapArtifact.tsx`
- `packages/overlay/src/components/interactive-artifact/theme-color.ts`
- `packages/overlay/src/styles/surfaces/messages.css`
- Official MapLibre source, data-event, map-event, and MapOptions documentation
- Official OpenFreeMap quick-start documentation and live Liberty style
- Official OpenStreetMap tile usage policy, used to reject direct use of the community raster endpoint

### Full-repository grep

The following searches enumerated the schema, generated Software Development Kit (SDK) transport, prompt guidance, Work producer, Overlay dispatcher, sole Map renderer, CSS owner, architecture statements, historical renderer audits, and obsolete UI source-string test:

- `rg -n "map@1|MapArtifact|empty local style|remote tiles|basemap|base map|底图|tile(s)?" packages specs`
- `rg -n "interactive-artifact|interactive_artifact|artifactID" packages/opencorvus/src packages/overlay/src`
- `rg -n "msg-artifact-map|maplibregl" packages/overlay/src`

Call-site decisions:

| Path | Decision |
| --- | --- |
| `packages/opencorvus/src/interactive-artifact/schema.ts` and generated SDK | Keep the V1 inline GeoJSON payload unchanged; the model cannot select a remote provider. |
| `packages/opencorvus/src/prompt/fragments/interactive-artifact-guidance.ts` | Keep the remote-source prohibition as a payload boundary. |
| `packages/overlay/src/components/InteractiveArtifactPart.tsx` | Keep the single lazy `map@1` dispatch. |
| `packages/overlay/src/components/interactive-artifact/MapArtifact.tsx` | Replace the empty style with the platform basemap configuration, add visible attribution and product-owned feature colors, and wait for the GeoJSON source. |
| `packages/overlay/src/styles/surfaces/messages.css` | Add only renderer-owned attribution and legend composition needed by the real surface. |
| `packages/overlay/test/message-interactive-artifact.test.ts` | Delete the obsolete UI source-string test under the repository UI-test prohibition; do not run it. |
| `specs/current/architecture/07-panel.md` | Replace the obsolete empty-map contract with the explicit platform-owned basemap and attribution boundary. |
| SDK/OpenAPI files | No shape change; do not regenerate. |

### Independent agent feedback

No independent Agent was requested. The primary Agent owns the diagnosis, implementation, and visual review.

## Evidence and causal chain

1. The persisted Artifact `art_fb696c8db001l70yLfLSkk5nf5` contains two valid `LineString` features with thirteen and nine positions plus eight `Point` features.
2. `MapArtifact.tsx` initializes MapLibre with `sources: {}` and one background layer, so missing roads, labels, and administrative geography are deterministic product behavior rather than missing conversation data.
3. Every line uses one accent-colored layer, so a route comparison has no product-owned visual distinction.
4. The component sets `data-ready` on the first generic `render` event. MapLibre documents source `idle` / `isSourceLoaded` and map `idle` as the completion signals for loaded source content; the current marker-only frame can therefore be exposed before GeoJSON drawing completes.
5. The exact payload and current layer expression render both lines in isolated Chromium and WebKit. The data and filter are valid; the product lifecycle and empty-style contract are the defects.

## Design

1. Add one Overlay-owned basemap configuration containing the OpenFreeMap Liberty style endpoint and declaring the style/TileJSON chain as the sole attribution owner. OpenFreeMap documents this endpoint for MapLibre and provides a public production-quality vector-tile service.
2. Keep the provider outside the persisted payload. This preserves a strict data-only Artifact contract while making the network dependency deliberate, inspectable, replaceable in one configuration file, and visible through attribution.
3. Initialize MapLibre from that style, then add the existing inline GeoJSON source and product layers after `load`.
4. Assign line colors by stable generated feature identity from the existing semantic Artifact palette. Do not accept model-authored colors or create route-name keyword rules.
5. Show a compact legend for named linear features using the same generated identity/color mapping.
6. Mark the renderer ready only after the `artifact` source reports loaded and the map reaches `idle`. Surface MapLibre errors as a renderer error instead of silently treating an empty frame as complete.
7. Retain the existing ResizeObserver, navigation controls, feature bounds, marker cleanup, theme observation, and one mounted renderer tree.

## Validation

### Non-UI

- `bun test packages/overlay/test/mcp-app-payload-contract.test.ts`: 2 passed, 0 failed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed; Vite retained its existing third-party directive and chunk-size warnings.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun test --timeout 120000 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`: 72 passed, 0 failed.
- `bun run docs:check`: passed with 311 operations over 24 groups.
- `git diff --cached --check`: passed.

### UI

- Started an isolated real OpenCorvus/Vite surface without disturbing the running packaged Overlay and opened the exact persisted Wuhan to Hangzhou Artifact.
- Direct screenshot review confirmed road/place context, blue and green route lines, eight markers, a two-row legend, compact geometry, and one provider/data attribution chain. The first render exposed duplicate attribution; visual review caught it and the component was corrected to let style/TileJSON metadata remain the sole owner before the final screenshot.
- A real click on MapLibre's zoom control visibly changed the geographic viewport; a second click restored it.
- A real click on the Artifact `Open` control reached `ArtifactFrame.requestFullscreen`, but the controlled Chrome host rejected the browser permission with `TypeError: not granted`. No fullscreen screenshot can be claimed from this environment. The shared fullscreen owner was not changed by this map repair, and the packaged Overlay was intentionally not restarted or manipulated.
- No UI test, browser fixture, screenshot baseline, or pass/fail visual script was created, modified, or run.
