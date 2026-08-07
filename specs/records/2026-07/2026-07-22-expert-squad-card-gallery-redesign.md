# Expert Squad card-gallery Install and Details redesign

## Recall

### User request

- Refactor the Expert Squad installation and details pages using the supplied desktop marketplace screenshot as the reference.
- Preserve the screenshot's information architecture: a prominent expert/team catalog, compact filters, restrained sorting or status controls, and a dense multi-column card gallery.

### Acceptance criteria

1. `Install` renders the canonical payload market as a desktop card gallery instead of a vertical administration list. Every card exposes identity, description, Agent membership, capability tags, and installed state without opening another source of truth.
2. Search and state filters operate on the loaded market projection. No popularity, publication-time, category, or ranking value is fabricated when the backend does not expose authoritative data for it.
3. Selecting a market card reveals one focused lifecycle region with the existing explicit global/project install actions or exact-scope update/uninstall actions.
4. `Details` reuses the same card grammar for the installed catalog, keeps selection visible, and retains project/session activation, configuration, export, uninstall, Agent capability, and technical-detail behavior.
5. The layout follows the reference's spacing rhythm, rounded white cards, circular visual identity, quiet background, compact tags, and dense desktop grid while continuing to use OpenCorvus primitives and iconography.
6. Keyboard focus, `aria-current`, `title`, destructive confirmation, empty/loading/error states, and stable lifecycle selectors remain covered.
7. Focused source tests, i18n, typecheck, Node-launched Playwright interaction tests, fresh current-worktree screenshots, documentation health, and `git diff --check` pass.

### Hard constraints

- `prompt_profile.active` remains the only active Expert Squad source; Registry, Manager, Resolver, Overlay service, and `/expert-squad/**` routes remain the only data/lifecycle owners.
- Keep exactly one `ExpertSquadPanel` and one `services/expert-squad.ts` client. Do not add a second catalog, frontend installation shadow state, compatibility path, route bypass, state machine, or backend gate.
- Reuse shared `Button`, `Icon`, `Badge`, `SearchField`, `Disclosure`, `Dialog`, and Settings primitives; do not hand-roll replacement controls.
- Desktop-only scope. No tablet/mobile/responsive deliverable is authorized.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay. Visual validation uses the isolated Node browser fixture.
- Preserve all unrelated dirty mailbox and architecture files; do not reset, stash, or create a worktree.

### Sources read

- `AGENTS.md`
- The supplied `codex-clipboard-856607cb-a9d8-464b-9de0-1314a5a23da3.png` reference at original resolution.
- `specs/README.md`, `specs/records/2026-07/README.md`
- `specs/current/architecture/04-extensions.md`, `07-panel.md`, `07-panel-reactivity.md`, and `99-principles.md`
- `specs/records/2026-07/2026-07-16-expert-squad-settings-capability-redesign.md`
- `specs/records/2026-07/2026-07-18-expert-squad-explicit-install-scope-actions.md`
- `specs/records/2026-07/2026-07-22-workbuddy-expert-squad-settings-parity.md`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/components/ConfigDialogHost.tsx`, `store/dialog.ts`, and shared UI primitives.
- `packages/overlay/src/services/expert-squad.ts`
- `packages/overlay/src/styles/surfaces/settings.css`
- Expert Squad source and Node browser tests under `packages/overlay/test/**`.
- Fresh baseline screenshots: `.scratch/expert-squad-market-current.png` and `.scratch/expert-squad-settings-details-current.png`.

### Whole-repository search evidence

| Search / owner cluster                                                                                                                         | Evidence and disposition                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExpertSquadPanel`, `expert-squad-install`, `expert-squad-market`, and `expert-squad-detail` across Overlay source/tests and July records      | `store/dialog.ts` owns the two Settings destinations, `ConfigDialogHost` renders one panel implementation, and `ExpertSquadPanel` owns both page projections. Retain this topology and refactor its presentation only.                                                              |
| `loadExpertSquadMarket`, `loadExpertSquadCatalog`, install/update/uninstall/activation/config/export call points across Overlay and OpenCorvus | Existing service and Manager-backed routes already provide every lifecycle operation. Keep request bodies, scope capture, refresh behavior, and confirmations unchanged.                                                                                                            |
| `ExpertSquadMarketItem` and `ExpertSquadOption` generated types                                                                                | Market data contains identity, version, description, selector summary, Agents, capability counts, source, and installation scope. It contains no popularity, timestamp, category, or publisher-avatar field, so the UI must not invent the screenshot's `popular/latest` semantics. |
| Expert Squad selectors in `settings.css`                                                                                                       | This file is the single visual owner. Replace vertical list geometry with shared gallery/card primitives used by both page projections, rather than creating parallel page-specific visual systems.                                                                                 |
| Expert Squad i18n keys in `zh-CN.json` and `en-US.json`                                                                                        | Existing lifecycle and capability copy remains canonical. Add only gallery filter/detail copy that is visible to users; keep both catalogs synchronized.                                                                                                                            |
| Expert Squad source/browser tests                                                                                                              | Existing tests cover search, two explicit install scopes, update, uninstall confirmation/cancel, activation, capability visibility, scope failure, and screenshot generation. Update these owners for grid geometry/filter semantics and retain the real request assertions.        |
| Specs index entries and document-health tests                                                                                                  | Add this record to both canonical indexes and run historical links, document health, and product-docs single-source tests because this task changes a product UI architecture record.                                                                                               |

### Independent agent feedback

None. The user did not request sub-agents, and the active collaboration policy prohibits unsolicited delegation.

## Design decision

The supplied page's durable pattern is not its brand assets; it is the catalog hierarchy: lightweight controls above a dense card field, each card carrying identity, a short promise, and compact tags. OpenCorvus will project only facts already owned by the market/catalog contracts. Install filters use `all / available / installed`; Details filters use `all / active / package / built-in`. These are deterministic projections of canonical state, unlike unsupported `popular / latest` rankings.

Both pages share one card component and one visual contract. Install cards summarize market Agents and capability counts. Details cards summarize installed squad identity, source, active state, and declared Agents. Selection opens the existing focused action/capability detail below the gallery, preserving all lifecycle semantics while making browsing resemble the reference.

## Implementation plan

1. Add derived filters and one shared card visual primitive inside `ExpertSquadPanel`; keep existing market/catalog signals and actions.
2. Replace Install's vertical rows with the card gallery and compact filter/search toolbar; restyle the selected lifecycle region to read as the gallery's detail continuation.
3. Replace Details' vertical catalog list and dashboard-like overview with the same gallery grammar and a compact canonical-context strip; retain the full Agent access and technical details below.
4. Update bilingual copy, shared Expert Squad CSS, and focused source/browser assertions.
5. Run focused verification and Node Playwright, inspect fresh desktop screenshots at original resolution, correct visual discrepancies, and repeat.
6. Perform a second diff/ownership review, update this record with results, then commit and push only task-owned files to `myhexin/v0.0.15beta`.

## Result

- `Install` now presents the authoritative payload market in a two-column desktop gallery with circular squad marks, identity/version, short description, Agent/Skill/Tool tags, installed scope, selection, search, and `All / Available / Installed` filters.
- `Details` uses the same card component and visual contract for the installed catalog, with `All / Active / Packages / Built-in` filters and explicit effective-active status. The existing overview, activation, configuration, update/export/uninstall, Agent access, and technical-detail regions remain downstream of the selected card.
- The implementation deliberately does not add popularity, recency, publisher avatars, or synthetic categories because those facts are absent from the canonical market/catalog contracts.
- The Node browser selector fixture now returns the required `pendingQuestions: []` member for standalone session conversation hydration. This fixes the strict fixture contract uncovered by the combined browser run without weakening product validation or adding a fallback.

## Verification

- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun test packages/overlay/test/expert-squad-settings-surface.test.ts packages/overlay/test/expert-squad-settings-navigation.test.ts packages/overlay/test/config-panel-sizing.test.ts packages/overlay/test/expert-squad-lifecycle-service.test.ts packages/overlay/test/expert-squad-scope.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 180000`
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-panel.test.ts` — four interaction/visual scenarios passed, including market state filters and two-column geometry.
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-selector-browser.test.ts` — three strict standalone-session selector scenarios passed after the fixture contract repair.
- Fresh original-resolution visual evidence was personally inspected and accepted: `.scratch/expert-squad-market-installed-current.png` and `.scratch/expert-squad-settings-details-current.png`. The first post-change inspection exposed a wrapped Install filter; constraining the shared SearchField to 280 px restored the intended single-row toolbar before the accepted captures.
- `git diff --check`

## Second review

- Ownership remains singular: `ExpertSquadPanel` derives both galleries from the existing market/catalog signals and calls the unchanged service client for lifecycle operations.
- The old vertical market/catalog copy and row-action structures were removed rather than retained as a compatibility path. Both pages render `ExpertSquadGalleryCard` and share one CSS card grammar.
- Filter values are derived from `installation_scope`, `active.effective`, and `built_in`; no parallel frontend state claims installation or activation authority.
- Existing stable selectors and lifecycle assertions were retained, while browser assertions now verify card count, first-row alignment, minimum card width, filter visibility, and active projection.
- An empty Details filter result now renders the canonical empty hint and no unrelated detail card, preventing selection from escaping the visible projection.
