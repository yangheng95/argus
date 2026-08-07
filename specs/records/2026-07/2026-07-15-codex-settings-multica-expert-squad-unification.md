# Codex Settings and Multica Expert-Squad Visual Unification

## Recall

### User requirement

- Change the current project's left-rail background to match the supplied Codex reference.
- Rework the current Settings page around the current Codex desktop Settings layout.
- Rework the Expert Squads settings page around the already-open Multica desktop client's Squads layout.
- Make the Codex-derived settings shell and Multica-derived expert-squad page read as one OpenCorvus visual system rather than two copied products.

### Acceptance criteria

- The light-theme left rail uses the pale blue-grey material visible in the supplied Codex task view and the current Codex Settings client, while the conversation canvas remains white and the existing single rail token still owns sidebar, titlebar, settings navigation, and panel body backing.
- Settings keeps one resizable navigation rail but adopts Codex's centered, narrower content column, larger page title, quiet search/navigation rows, restrained grouped settings rows, and generous vertical breathing room.
- Expert Squads uses the same content width, title rhythm, settings primitives, borders, and typography as every other Settings page.
- The expert-squad catalog follows Multica's flat squad directory: count-bearing section header, compact filter chips, circular team glyph, title plus description rows, subtle row selection, and a detail region below the catalog instead of a separate side-by-side dashboard.
- Existing directory/scope/projection data, import/export actions, project/session activation, technical disclosure, keyboard semantics, and single catalog service remain unchanged.
- Focused source tests, Overlay TypeScript/i18n, Node-launched browser tests, real desktop screenshots, and documentation-health checks pass.

### Hard constraints

- Desktop-only delivery; no tablet/mobile/responsive expansion.
- Reuse existing `Dialog`, `Tabs`, `Button`, `SettingsPanel`, `SettingsGroup`, `SettingsRow`, `SettingsPill`, and `Icon` primitives.
- Preserve `--rail-surface` as the only rail material source and preserve `ExpertSquadPanel` plus `services/expert-squad.ts` as the only catalog/action owners.
- Do not create a second settings shell, expert-squad catalog, selection state, active-squad source, or compatibility path.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process. Visual validation uses the existing isolated Node/Playwright fixture.
- Do not create a worktree or bypass hooks. Commit subjects start with `dsw-33987`; delivery pushes to the configured legacy remote.

### Visual evidence

- Supplied Codex task-view screenshot: `C:/Users/10132/AppData/Local/Temp/codex-clipboard-f4c43e51-e5c3-4489-ada2-49f4006a4726.png`.
- Current Codex desktop Settings capture: `.scratch/codex-settings-reference.png`.
- Current Multica desktop Squads capture: `.scratch/multica-squads-reference.png`.
- Current OpenCorvus captures: `.scratch/settings-general-light.png`, `.scratch/settings-expert-squad-light.png`, and `.scratch/overlay-sidebar-project-actions.png`.
- Measured empty rail samples: supplied Codex task view approximately `rgb(236, 245, 249)` to `rgb(239, 244, 247)`; Codex Settings approximately `rgb(240, 244, 245)`; Multica approximately `rgb(243, 243, 244)`; current OpenCorvus `rgb(247, 247, 247)`.

### Sources read

- `packages/overlay/src/components/ConfigDialogHost.tsx`
- `packages/overlay/src/components/settings/{primitives,ExpertSquadPanel,GeneralPanel,AppearancePanel,ProvidersPanel,AgentModelsPanel}.tsx`
- `packages/overlay/src/styles/cascade/light.css`
- `packages/overlay/src/styles/surfaces/{settings,sidebar,titlebar,header}.css`
- `packages/overlay/src/utils/config-sidebar-resizer.ts`
- Settings, expert-squad, palette, sidebar continuity, sizing, and browser visual tests under `packages/overlay/test/**`.
- `specs/records/2026-07/{2026-07-15-codex-sidebar-search-environment-parity,2026-07-14-overlay-neutral-codex-chrome-repair,2026-07-11-settings-detail-gui-remediation,2026-07-09-codex-reference-light-theme,2026-07-05-overlay-expert-squad-settings-redesign}.md`.

### Whole-repository search evidence

| Owner / call site | Decision |
| --- | --- |
| `light.css --rail-surface` | Replace the current neutral `247` value with the measured Codex pale blue-grey opaque material; keep `body-bg` and `panel-body-bg` pointing to it. |
| `sidebar.css`, `titlebar.css`, `header.css`, `settings.css` rail backgrounds | Keep their existing `var(--rail-surface)` references; no local color override is added. |
| `ConfigDialogHost` shell/nav/title/panel mount | Keep the one fullscreen Dialog/Tabs structure and resizable navigation; no parallel Settings route or shell. |
| `settings.css .config-content`, `.config-page-title`, `.config-tab-panel` | Introduce one centered settings content-width contract and remove the expert-squad max-width exception. |
| `settings.css` non-expert `.s-*` overrides | Reduce the oversized special-case rows so ordinary settings and expert squads share the primitive rhythm instead of two density systems. |
| `ExpertSquadPanel` catalog/layout | Retain all signals and actions; add catalog header/filter presentation and a shared circular squad glyph, then stack catalog and details vertically. |
| `expert-squad-overview` | Keep canonical directory/scope/active/projection values but present them as a quieter context summary inside the shared column. |
| `expert-squad-panel.test.ts` | Update geometry assertions from side-by-side layout to catalog-then-detail order and add Multica list-row/icon/filter evidence. |
| `config-panel-sizing.test.ts`, `theme-palette-intent.test.ts`, expert-squad source tests | Replace stale `1240px`/expert exception and `rgb(247,247,247)` assertions with the new single-source contracts. |
| `script/snap-settings.ts` and Node-launched browser fixtures | Reuse for real light/dark settings captures; Playwright continues to run through Node, never Bun. |

### Independent agent feedback

- None. The user did not request sub-agents; this task has one tightly coupled theme/settings/expert-squad visual owner.

## Root cause

The shell already resembles Codex structurally, but its content contract is still a wide `1240px` form sheet and ordinary pages receive separate oversized row rules. Expert Squads then opts out of the shared width entirely and renders an overview dashboard plus a side-by-side master/detail card. The result is three visual systems: neutral-grey application rail, wide Codex-like Settings chrome, and dense expert-squad administration UI. The mismatch is caused by local sizing exceptions, not missing product primitives.

## Implementation

1. Correct the one light rail palette token from neutral grey to the measured Codex blue-grey material and update its regression.
2. Define one centered Settings content-width and typography rhythm for all tabs; remove the expert-squad width/density exemptions.
3. Reshape only ExpertSquadPanel's presentation around a Multica-like flat squad directory and vertically ordered detail region while retaining every existing service/action/state boundary.
4. Update source and browser regressions, render isolated desktop screenshots, visually compare the left rail, General Settings, and Expert Squads regions, then iterate until the evidence matches the intended hierarchy.

## Result

Implemented and visually accepted on the desktop delivery surface.

- The single `--rail-surface` source now uses `rgb(241, 245, 247)`, matching the measured Codex blue-grey rail while leaving the conversation canvas white.
- General Settings and Expert Squads now share one centered `880px` content contract, page-title rhythm, primitive spacing, and quiet neutral selection treatment; the former expert-squad full-width exception was removed.
- Expert Squads retains its existing catalog, activation, import/export, projection, and diagnostic ownership, but presents the catalog as a Multica-inspired vertical directory with a count header, circular squad glyphs, descriptive rows, and the detail region below it.
- Real Node-launched browser screenshots were inspected at `packages/overlay/.scratch/config-dialog-general-1440.png`, `packages/overlay/.scratch/expert-squad-settings-collapsed.png`, `packages/overlay/.scratch/expert-squad-settings-page.png`, and `packages/overlay/.scratch/neutral-chrome-wash.png`. The rail color, centered Settings geometry, catalog hierarchy, row density, selection wash, and catalog-to-detail order match the intended unified system.

### Verification

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- Focused palette, settings sizing, expert-squad surface, typography, and sidebar continuity tests: 42 passed, 0 failed.
- `node test/browser-runner.mjs test/browser/config-dialog-resizer.test.ts`: 1 passed.
- `node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts`: 4 passed.
- `node test/browser-runner.mjs test/browser/neutral-chrome-wash-browser.test.ts`: 1 passed.
- The browser runner rebuilt the production Vite bundle successfully before exercising the rendered pages.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 53 passed; `product-docs-single-source.test.ts`: 4 passed.
- `historical-docs-links.test.ts`: 18 passed and 2 failed on pre-existing generated `packages/opencorvus/src/expert-squad/payload.ts` references to retired `docs/merge/**`, `docs/todos/**`, and `packages/opencode/specs/**` paths. The failing source is outside this UI change and was not hidden with an ignore or gate.
