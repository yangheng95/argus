# Expert Squad card lifecycle and Details simplification

## Recall

### User request

- Replace the passive Expert Squad market-card installation state with an `Install` button for uninstalled squads and an `Uninstall` button for installed squads.
- Remove the Details metadata block highlighted in the supplied screenshot, including directory, scope, project/session activation summary, effective selection, selected squad, and active projection summary.

### Acceptance criteria

1. Every uninstalled market card exposes a visible `Install` button. The button uses the shared dropdown-menu primitive to preserve the existing explicit all-projects versus current-project installation choice.
2. Every installed market card exposes a visible destructive `Uninstall` button. It reuses the existing exact-scope uninstall service and confirmation dialog.
3. Card actions operate independently from card selection, retain keyboard focus and accessible labels, and refresh the canonical market/catalog projections after success.
4. The selected-market detail remains the capability and version source, but no longer duplicates install or uninstall actions already owned by the card.
5. The Details page no longer renders the `expert-squad-overview` metadata block or its directory/scope/activation/projection rows. Activation and session-override controls in the selected squad detail remain available.
6. Source tests, localized copy, typecheck, Node-launched browser interaction tests, fresh desktop screenshots, documentation health, and `git diff --check` pass.

### Hard constraints

- Keep `ExpertSquadPanel` and `services/expert-squad.ts` as the single Overlay owners. Do not add another catalog, installation state, lifecycle service, route, compatibility branch, state machine, or host gate.
- Keep Registry/Manager-backed `/expert-squad/install-payload` and `/expert-squad/uninstall` as the only package lifecycle paths.
- Installation scope must remain explicit. The new `Install` card button opens the canonical shared `DropdownMenu` with the existing global and project choices; it must not silently select a scope.
- Reuse the shared `Button`, `DropdownMenu`, `Icon`, `Badge`, Settings, and app-dialog primitives.
- Desktop-only scope. Do not add tablet/mobile/responsive deliverables.
- Do not restart, refresh, close, or interfere with the user's running OpenCorvus/Overlay. Visual validation uses the isolated Node browser fixture and the in-app Browser inspection surface.
- Preserve unrelated dirty files, including the concurrent macOS keyboard, sidebar, Work Ledger, and Environment Popover work. Do not reset, stash, or create another worktree.

### Sources read

- `AGENTS.md`
- The supplied market-card and Details screenshots at original resolution.
- `specs/README.md`, `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-18-expert-squad-explicit-install-scope-actions.md`
- `specs/records/2026-07/2026-07-17-expert-squad-uninstall-reference-convergence.md`
- `specs/records/2026-07/2026-07-22-workbuddy-expert-squad-settings-parity.md`
- `specs/records/2026-07/2026-07-22-expert-squad-card-gallery-redesign.md`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/components/ui/DropdownMenu.tsx`
- `packages/overlay/src/components/ProjectLedgerGroup.tsx`
- `packages/overlay/src/services/expert-squad.ts`
- `packages/overlay/src/services/expert-squad-scope.ts`
- `packages/overlay/src/styles/surfaces/settings.css`
- Focused Expert Squad source and Node browser tests under `packages/overlay/test/**`.

### Whole-repository search evidence

| Search / owner cluster | Complete disposition |
| --- | --- |
| `ExpertSquadGalleryCard`, `selectedMarketItem`, `expert-squad-market-install`, `expert-squad-market-uninstall` | One shared card component renders both Install and Details cards. Extend it with an optional sibling action surface; only market callers supply lifecycle actions. Remove the selected-market detail's duplicate install/uninstall controls. |
| `installExpertSquadMarketPackage`, `/expert-squad/install-payload` | The only Overlay caller is `installMarketItem`; the service maps to the existing project-scoped route and server Manager path. Retain it unchanged and call it from explicit dropdown items. |
| `uninstallExpertSquadPackage`, `/expert-squad/uninstall` | `uninstallInstalledSquad` is the shared confirmation/refresh owner used by market and Details callers. Retain it unchanged and invoke the market caller from the card button. |
| `expert-squad-overview` and `data-kind="directory|scope|project-active|session-override|effective-active|selected|projection"` | The only production renderer is the Details block in `ExpertSquadPanel`; CSS ownership is one contiguous `settings.css` block. Delete both. Update source sizing/navigation tests and all browser assertions that sampled these removed rows. |
| `activeProjection`, `squadNameByID`, `selectedSquadLabel`, `scopeLabel` | These derived values are used only by the removed overview block. Delete them rather than retaining dead compatibility logic. |
| `expert_squad.directory`, `scope`, `selected`, `active_projection`, `scope_session`, `scope_unavailable` | These localized keys are referenced only by the removed overview projection. Remove them from both catalogs; retain keys still used by errors, recovery states, cards, activation badges, and lifecycle controls. |
| `DropdownMenu.Root/Trigger/Portal/Content/Item` | The shared Kobalte-backed primitive is the existing mature menu owner. Reuse it for explicit installation scope selection instead of creating a custom popover or default-scope shortcut. |
| Expert Squad source/browser tests | Update existing owners in place. Browser coverage must assert available/installed filters expose the correct button, global/project menu selection reaches the real mocked route body, uninstall cancellation and confirmation remain exact-scope, removed metadata is absent, and activation still changes canonical card/action state. |
| Specs indexes and document-health tests | Add this record to both canonical indexes and run historical-links, document-health, and product-docs single-source validation. |

### Independent agent feedback

None. The user did not request sub-agents, and the active collaboration policy prohibits unsolicited delegation.

## Design decision

Market-card installation state is an action, not descriptive metadata. The card therefore keeps one large selection button for browsing and gains one sibling lifecycle control in the trailing header position. An uninstalled card uses a text `Install` dropdown trigger whose two menu items preserve the explicit installation-scope contract. An installed card uses a text `Uninstall` button and the existing destructive confirmation. The selected-market detail remains useful for full capability and version information, but duplicated install/uninstall controls are removed.

The Details metadata block is a second presentation of directory, scope, and active-selection facts already embodied by the page context, selected card status, and activation controls. It is removed completely, along with its exclusive derived helpers and styles. Canonical catalog fields and activation behavior remain unchanged.

## Implementation plan

1. Extend the shared gallery card with an optional action slot and add a market-card install dropdown/uninstall button using existing lifecycle functions.
2. Remove duplicated selected-market install/uninstall controls while preserving installed-version/update information and Agent/capability detail.
3. Delete the Details overview renderer, exclusive derived helpers/styles, and exclusive localized labels.
4. Update focused source, sizing, navigation, and Node browser interaction assertions.
5. Run targeted tests, typecheck, i18n, documentation health, and `git diff --check`.
6. Launch the isolated real page with Node, capture and personally inspect Install and Details screenshots in the in-app Browser, correct discrepancies, and repeat.
7. Perform a second ownership/diff review, record results here, then commit and push only task-owned changes to `legacy-remote/work-v0.0.16beta-yr-0723`.

## Result

- `ExpertSquadGalleryCard` now owns a sibling lifecycle action slot outside its selection button. Available market packages render one visible `Install` dropdown trigger; installed packages render one visible destructive `Uninstall` button.
- The install dropdown keeps the existing explicit `global` and `project` choices and calls the existing `installMarketItem` owner. Uninstall keeps the existing exact-scope confirmation and `uninstallMarketItem` owner.
- The selected-market detail no longer duplicates install or uninstall. It retains installed-version/scope information and the built-in update action.
- The Details `expert-squad-overview` renderer, its exclusive derived values, its exclusive styles, and its dead localized labels were removed. Squad cards, activation controls, session override controls, Agent access, and recovery states remain canonical and functional.
- No service, route, package identity, catalog projection, lifecycle state, or active-squad source was added.

## Verification

- `bun run --cwd packages/overlay typecheck` — passed.
- `bun run --cwd packages/overlay check:i18n` — passed (`overlay panel i18n ok`).
- `bun test packages/overlay/test/expert-squad-settings-surface.test.ts packages/overlay/test/expert-squad-settings-navigation.test.ts packages/overlay/test/config-panel-sizing.test.ts packages/overlay/test/expert-squad-scope.test.ts packages/overlay/test/expert-squad-lifecycle-service.test.ts --timeout 180000` — 58 passed, 0 failed, 740 assertions.
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-panel.test.ts` — 4 passed, 0 failed. The real browser fixture covered card-action counts and geometry, focusability, global/project menu bodies, exact lifecycle request bodies, uninstall cancellation and confirmation, state refresh, overview absence, activation, session override clearing, pending scope, and catalog recovery.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 180000` — 87 passed, 0 failed, 1,415 assertions.
- `git diff --check -- <task-owned files>` — passed.
- Fresh Node/browser screenshots were personally inspected:
  - `.scratch/expert-squad-market-current.png`: installed cards show `Uninstall`; available cards show `Install`; action labels do not collide with identity text.
  - `.scratch/expert-squad-market-installed-current.png`: installing MirrorWatch immediately replaces its card action with `Uninstall` while MirrorTest remains installable.
  - `.scratch/expert-squad-settings-details-current.png`: the removed directory/scope/activation/projection overview is absent and the catalog/detail hierarchy closes the vacated space.
- The in-app Browser inspected the isolated screenshots; the Browser session and isolated static server were finalized afterward. No running OpenCorvus/Overlay process was restarted or refreshed.

## Second review

- Whole-repository ownership recheck found one `ExpertSquadPanel` market renderer, one shared gallery-card action slot, one `installMarketItem` caller path, one `uninstallMarketItem` caller path, and the existing service/route owners unchanged.
- No production `expert-squad-overview`, overview-item selector, removed metadata row, retired market install-action group, or removed localized key remains.
- Card actions are siblings of the card-selection button, so the implementation does not introduce invalid nested buttons. Both action variants use the shared `Button`; the scope chooser uses the shared Kobalte-backed `DropdownMenu`.
- Browser evidence confirms the available/installed projection changes after lifecycle calls and Details activation/session behavior still updates canonical cards without the removed metadata block.
- The task diff contains no compatibility path, fallback, state machine, host gate, duplicated scope inference, or unrelated source edit.
