# Expert Squad Settings Information Architecture

Date: 2026-08-06

Status: Implemented and visually reviewed; independent parent review pending.

## Recall

| Item                       | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Redesign the Expert Squad area of Settings because the current surface has no coherent design philosophy, imposes excessive cognitive load, and mixes unrelated font sizes and heavy type. The user asked the implementation agent to complete the change first and have the parent Agent independently review it afterward.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Acceptance criteria        | The desktop Squad Market and Installed Agent Squads pages use stable master-detail layouts. A market list row shows only icon, name, one-line purpose, and install state/action; the selected detail is the only owner of the full description, source/version, capability summary, Agent roster, installation scope, and lifecycle actions. An installed list row shows only icon, name, and effective state; its detail header is the only identity surface, uses readable text actions for project/session selection, and moves update/export/uninstall to the existing dropdown menu. Overview and Agents tabs do not repeat their tab/header titles or count badges. Typography has only title/body/meta roles and regular/medium emphasis; monospace is limited to technical identifiers and paths; badges express status rather than ordinary counts. Real desktop pages are opened, interacted with, captured, and manually reviewed.                                                                                                                                                  |
| Hard constraints           | Desktop-only delivery. Preserve `prompt_profile.active` and the existing Registry/Manager/Resolver/catalog/installation contracts. Do not add a fallback, second source, gate, state machine, hard-coded design token, custom popover, or UI-only identity logic. Reuse `SettingsRow`, `Button`, `Badge`, `Tabs`, `DropdownMenu`, and `Disclosure`. Do not create, edit, update, or run UI automation tests; UI tests discovered in the touched component/style surface must be removed without running them. Use Node, never Bun, for Playwright interaction. Do not restart, close, refresh, or otherwise interfere with an existing OpenCorvus/Overlay process; visual review must use an isolated real page. Preserve all unrelated concurrent worktree changes. Commit only task-owned paths with a `dsw-33987` subject and push the current `v0.0.31beta` branch to legacy remote if shared-worktree ownership remains safe.                                                                                                                                                                  |
| Sources read               | Root `AGENTS.md` and `CLAUDE.md`; `specs/current/architecture/07-panel.md`; `2026-08-01-base-default-expert-squad.md`; `2026-07-22-workbuddy-expert-squad-settings-parity.md`; `2026-07-23-expert-squad-card-lifecycle-and-detail-simplification.md`; the current `ExpertSquadPanel.tsx`, Settings layout composites, Button/Badge/Tabs/DropdownMenu/Disclosure primitives, `ConfigDialogHost.tsx`, and the Expert Squad block in `settings.css`; existing screenshots `expert-squad-market-dual-scope-final-ui.png`, `base-default-expert-squad-catalog.png`, and `base-default-expert-squad-agents.png`, inspected at original resolution.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Whole-repository grep      | `ExpertSquadPanel` has one Settings host with two pages in `ConfigDialogHost`; no second production renderer exists. `ExpertSquadGalleryCard` has exactly two callers, the market list and installed list, and both are replaced rather than retained. `selectedMarketItem`, market/catalog filters, Agent capability groups, projection rows, installation/activation/update/export/uninstall handlers, and the existing service/route contracts remain single owners. Expert Squad CSS is one contiguous `settings.css` block. Search of touched paths found existing UI source/style assertion tests: `disclosure-primitive.test.ts`, `field-label-typography.test.ts`, `log-viewer-primitive.test.ts`, `memory-panel-detail-dialog.test.ts`, `provider-search-clear-primitive.test.ts`, `provider-settings-layout.test.ts`, `settings-button-format.test.ts`, and `tools-settings-surface.test.ts`; policy requires deleting them without running them. Historical records that describe the retired gallery-card presentation remain immutable historical evidence and are not rewritten. |
| Independent agent feedback | The parent Agent supplied the redesign direction and will independently review the completed implementation, real-page screenshots, and final diff. This implementation sub-Agent must not delegate further.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Root cause and design decision

The observable visual noise is produced by a structural duplication: both list
and detail surfaces render identity, description, version, capability counts,
status, and actions. `ExpertSquadGalleryCard` encodes that duplication through
mandatory identity, description, and tag props. Local CSS then tries to recover
hierarchy with five font tiers, repeated bold text, badges, nested cards,
alternating Agent columns, and structural selectors. The typography problem is
therefore downstream of an information-architecture problem.

The replacement uses one master-detail grammar on both pages. The master is a
quiet `SettingsRow` list optimized only for choosing an object. The detail is
the sole understanding and management surface. Status badges are reserved for
installed/effective/update state. Ordinary counts are plain metadata. The
installed detail header owns identity plus the two high-frequency selection
actions; the existing `DropdownMenu` owns low-frequency package operations.
Technical package material remains in Package Details and keeps monospace only
for identifiers, references, hashes, and paths.

## Call-point disposition

| Surface                           | Disposition                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExpertSquadGalleryCard`          | Delete. Do not retain compatibility props such as `class`, `buttonClass`, `tags`, or action-position escape hatches.                                                                                                                                                                                                 |
| Market list caller                | Replace with one interactive `SettingsRow`: stable icon, name, one-line purpose, status or explicit install action. It selects the adjacent detail without repeating version/count metadata.                                                                                                                         |
| Market selected detail            | Make this the sole owner of namespace/ID, available version, complete description, plain capability summary, Agent list, installed scope/version state, update and uninstall actions. Use one calm surface instead of a card below a two-column gallery.                                                             |
| Installed list caller             | Replace with one interactive `SettingsRow` containing icon, display name, and only the effective-active status. Remove description, version, source, and counts.                                                                                                                                                     |
| Installed detail header           | Make this the sole identity block. Render project default and session override as text buttons. Put configure/update/export/uninstall in the existing Kobalte-backed dropdown menu, with destructive uninstall visually separated.                                                                                   |
| Overview tab                      | Keep only management/runtime facts in a flat definition layout; remove projected-Agent count and repeated identity/source tiles.                                                                                                                                                                                     |
| Agents tab                        | Render the Agent disclosure list directly. Remove `Agents and access`, explanatory copy, and the count badge already implied by the tab and rows. Capability section counts become plain metadata, not badges.                                                                                                       |
| Package tab                       | Keep README, selector, and projection content, while replacing ordinary count badges with metadata and preserving monospace only for package refs/IDs/hashes.                                                                                                                                                        |
| `settings.css` Expert Squad block | Replace gallery/card nesting with one master-detail layout and row recipes. Delete `nth-child` avatar coloring, odd/even Agent columns, `:not()` structure selection, and local `strong`/`small`/`span` type ladders. Keep only layout, spacing, scroll, truncation, state placement, and technical monospace rules. |
| Backend/service contracts         | Preserve unchanged. The refactor consumes the same catalog, market, selection, configuration, and lifecycle actions.                                                                                                                                                                                                 |
| Touched-path UI tests             | Delete the discovered source/style assertion tests without running them, per the repository-wide UI automation ban. Do not replace them with screenshot baselines or automated visual assertions.                                                                                                                    |

## Validation plan

1. Review the complete diff and verify no service, backend identity, resolver,
   route, or catalog contract changed.
2. Run Overlay typecheck/build and repository documentation checks, excluding
   every UI automation test.
3. Start an isolated source Overlay/page without touching an existing running
   OpenCorvus process. Drive the real desktop page with Node-launched
   Playwright or the Browser preview, covering Market, Installed, Overview,
   Agents, Package Details, status/action menus, and keyboard focus.
4. Capture task-bound screenshots at desktop dimensions, inspect them at
   original resolution, correct visual hierarchy or clipping issues, and repeat
   until the rendered result matches this decision.
5. Ask the parent Agent to perform the required independent review. Record any
   correction in this plan before final delivery.

## Implementation result

- Replaced the two `ExpertSquadGalleryCard` callers with the same quiet
  master-detail grammar built from existing Settings primitives, then deleted
  the obsolete gallery-card component and its styling.
- Made Market rows selection-oriented and Installed rows state-oriented. The
  adjacent detail pane is now the only owner of descriptions, package identity,
  metadata, Agent rosters, and management actions.
- Consolidated low-frequency package operations into the existing
  `DropdownMenu`; project/session activation stays visible as text actions.
- Flattened Overview, removed repeated Agents headings and count badges, and
  limited monospace styling to technical values.
- Deleted the eight touched-path UI source/style assertion tests named in the
  Recall section without running them, as required by the UI automation ban.

## Validation evidence

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run check:i18n` in `packages/overlay`: passed after removing four locale
  keys whose duplicate surfaces were deleted.
- `bun run build:vite` in `packages/overlay`: passed; only existing third-party
  `use client` and bundle-size warnings remained.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`,
  `document-health.test.ts`, and `product-docs-single-source.test.ts`: passed.
- A fresh isolated OpenCorvus backend and source Overlay were opened at
  `127.0.0.1:7878` and `127.0.0.1:5197`. The live Settings dialog was exercised
  at 1440 x 900 through Installed, Market, Agents, Package Details, package
  actions, and arrow-key-plus-Enter tab navigation.
- Original-resolution captures were manually inspected and the master column
  was widened after the first Market capture exposed overly aggressive purpose
  truncation. Final evidence:
  - `../../artifacts/expert-squad-settings-installed-master-detail.png`
  - `../../artifacts/expert-squad-settings-market-master-detail.png`
  - `../../artifacts/expert-squad-settings-agents.png`
  - `../../artifacts/expert-squad-settings-package-details.png`
  - `../../artifacts/expert-squad-settings-package-menu.png`
- Browser diagnostics contained no page errors. Three early connection warnings
  predated the isolated backend startup; the connected page subsequently showed
  Online on port 7878 and all catalog/detail data rendered from that backend.
