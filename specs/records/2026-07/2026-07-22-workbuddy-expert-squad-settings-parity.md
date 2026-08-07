# WorkBuddy-style Expert Squad settings parity

## Recall

### User request

- Make the Settings `Install` and `Details` Expert Squad pages follow the WorkBuddy Expert Squad presentation.
- Add uninstall support directly to the installation page.
- Prefer icons for actions whose meaning is clear; icon actions must retain an explanatory `title` and accessible name.
- Preserve the desktop-only `Expert Squads -> Install / Details` navigation shown in the supplied screenshot.

### Acceptance criteria

1. `Install` uses one browsable Expert Squad directory and one selected-squad detail region, with capability counts and Agent membership visible before a lifecycle action.
2. Installed market rows expose exact-scope uninstall on the installation page, use the existing confirmation and Manager-owned uninstall service, and refresh both market and installed catalog after success.
3. Uninstalled rows retain explicit global/project install choices; installed rows expose update and uninstall without introducing another package state source.
4. `Details` uses the same directory/detail visual grammar and moves compact actions into an icon-led toolbar. Text remains visible only where an icon alone cannot communicate scope or state.
5. Every icon-only action has a localized `title` and `aria-label`, keyboard focus remains visible, and destructive uninstall remains visually distinct.
6. Local folder/ZIP import stays a secondary disclosure and all package identity, scope, activation, configuration, export, update, and uninstall contracts remain unchanged.
7. Focused source tests, i18n, typecheck, Node-launched browser interaction tests, current-worktree desktop screenshots, documentation health, and `git diff --check` pass.

### Hard constraints

- `prompt_profile.active` remains the only active Expert Squad source; the Registry/Manager and `/expert-squad/**` routes remain the only lifecycle owners.
- Reuse `ExpertSquadPanel`, `services/expert-squad.ts`, the shared `Button`, `Icon`, `Badge`, `SearchField`, `Disclosure`, and application-dialog primitives.
- No backend schema change, second catalog, compatibility branch, frontend-only installation state, status machine, or route bypass.
- Desktop-only delivery; no tablet/mobile/responsive scope.
- Do not restart, refresh, close, or interfere with the user's running OpenCorvus/Overlay. Visual validation uses the isolated Node browser fixture and the in-app browser surface.
- Preserve unrelated dirty files and do not create a worktree or reset/stash the repository.

### Sources read

- `AGENTS.md`
- `specs/README.md`, `specs/records/2026-07/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-16-expert-squad-settings-capability-redesign.md`
- `specs/records/2026-07/2026-07-17-global-model-squad-lifecycle-and-composer-stop.md`
- `specs/records/2026-07/2026-07-21-multica-import-confirmation-and-install-actions.md`
- `specs/records/2026-07/2026-07-22-settings-app-dialog-context-preservation.md`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/components/{ConfigDialogHost,ui/Button,ui/Icon}.tsx`
- `packages/overlay/src/styles/{primitives/button,surfaces/settings}.css`
- `packages/overlay/src/services/expert-squad.ts`
- Expert Squad unit and Node browser tests under `packages/overlay/test/**`.
- The supplied WorkBuddy navigation screenshot and current WorkBuddy public Expert Squad documentation. The public material confirms a browse-card -> capability detail -> action hierarchy; it does not define OpenCorvus package scope or lifecycle semantics.

### Whole-repository search evidence

| Search / owner cluster                                                                               | Evidence and disposition                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings navigation and `ExpertSquadPanel` references across Overlay source, tests, and July records | `store/dialog.ts` and `ConfigDialogHost` already provide exactly one Expert Squads group with Install/Details children, while one `ExpertSquadPanel` renders both pages. Retain the topology and change only the page projection.          |
| Install, uninstall, and update service calls across Overlay and OpenCorvus                           | The Overlay service and Manager-backed routes already own all lifecycle operations. Add an installation-page caller that reuses the same exact-scope uninstall operation and confirmation; do not add an endpoint or state source.         |
| Market install/update and Details uninstall selectors across Overlay source and tests                | Install and update lived in market rows, while uninstall existed only in Details. Converge them into one selected-market lifecycle area and preserve stable `data-ui` selectors for interaction coverage.                                  |
| Expert Squad CSS selectors in `settings.css`                                                         | `settings.css` is the sole Expert Squad visual owner. Replace the row-action-heavy market styling with the same flat directory/detail grammar used by Details; keep capability and technical-detail styles.                                |
| Icon-button contracts across Overlay source, tests, and current records                              | The shared `Button` primitive supports canonical icon sizing, and existing controls pair icon actions with `title` and `aria-label`. Reuse that contract for update, configure, activation, override reset, export, and uninstall actions. |
| Expert Squad action labels in both locale catalogs                                                   | Both locale catalogs already own action labels. Reuse them for accessible names and add only the missing not-installed state and revised introductory copy.                                                                                |
| Expert Squad source/browser tests and settings geometry tests                                        | Existing tests already cover market install/update, Details activation/export/uninstall, geometry, and screenshots. Extend these owners for install-page uninstall and icon-only accessibility rather than creating a second fixture.      |

### Independent agent feedback

None. The user did not request sub-agents, and the active collaboration policy prohibits unsolicited delegation.

## Design decision

WorkBuddy's useful pattern is the user-facing progression from discovering a team, to understanding its composition and capabilities, to taking one clear action. OpenCorvus keeps its stricter explicit installation scope and package provenance, but projects them through the same hierarchy:

1. a quiet, searchable directory with one selected row;
2. a selected-squad detail header with description, identity, scope/state, and compact lifecycle actions;
3. capability totals and Agent membership below the header;
4. secondary local import or technical diagnostics behind disclosures.

Scope choices (`global` / `project`) remain text-visible because their distinction is not communicated safely by an unlabeled glyph. Update, configure, activation, export, clear, and uninstall are recognizable operations and become icon-led controls with localized native titles and accessible names.

## Implementation plan

1. Extract the existing confirmed exact-scope uninstall sequence so Details and Install call one implementation.
2. Reshape Install rows into selection-only directory entries and move install/update/uninstall into the selected-squad detail header; retain explicit install scopes and add exact installed-scope uninstall.
3. Convert suitable Details lifecycle controls to shared icon buttons with `title` and `aria-label`; retain text where scope/state clarity requires it.
4. Update Expert Squad styles and both locale catalogs for the unified hierarchy and compact action geometry.
5. Extend focused source/browser tests for install-page uninstall, accessible icon labels, request scope, confirmation/cancel behavior, and stable directory/detail structure.
6. Run type/i18n/docs checks and the Node browser fixture, capture and personally inspect fresh Install and Details screenshots, correct visual issues, then repeat verification.

## Result

- Install now presents a selectable Expert Squad directory and a single selected-squad detail card. The detail header owns capability counts and lifecycle actions; rows only expose identity, Agent count, and installation state.
- Installed market packages now expose exact-scope update and uninstall icons. Uninstall reuses the same confirmation and backend service as Details, then refreshes both installed catalog and market projections.
- Details lifecycle actions now use the shared icon-button primitive with localized `title` and `aria-label` text. Global/project install choices remain explicit text buttons because installation scope must not depend on icon interpretation.
- Both pages retain the existing desktop navigation, Registry/Manager lifecycle ownership, application dialog behavior, configuration, activation, export, local import, and technical-detail contracts.
- WorkBuddy's browse-then-inspect hierarchy influenced the information layout. Visual review additionally replaced the selected row's accent fill with a quieter neutral surface and consolidated actions in the detail header so selection and mutation are not visually conflated.

## Verification

- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/overlay/test/expert-squad-settings-surface.test.ts packages/overlay/test/expert-squad-settings-navigation.test.ts packages/overlay/test/config-panel-sizing.test.ts` — 27 passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-panel.test.ts` with `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1` — 4 passed, including cancelled and confirmed installation-page uninstall.
- Fresh current-worktree screenshots were generated and inspected at `.scratch/expert-squad-market-current.png`, `.scratch/expert-squad-market-installed-current.png`, `.scratch/expert-squad-market-uninstalled-current.png`, `.scratch/expert-squad-settings-details-current.png`, and `.scratch/expert-squad-update-actions-current.png`.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` — 21 passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts` — 61 passed after the indexed record was staged.
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts` — 5 passed.
- `git diff --check` passed.

## Second review

- Rechecked every lifecycle caller and confirmed both uninstall entry points pass the package's actual installation scope to the one service, preserve confirmation, and refresh the two existing projections without frontend shadow state.
- Rechecked icon-only actions for non-empty localized `title` and `aria-label`, canonical icon size, disabled behavior, and destructive tone.
- Rechecked the browser fixture request payload: confirmed uninstall sends the selected package ID, exact `global` scope, and canonical `general` replacement; cancellation sends no uninstall request.
- No backend route, schema, persisted active-squad source, mobile behavior, compatibility branch, or unrelated dirty file was changed.
