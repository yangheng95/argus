# Settings, Search, And Composer Visual Convergence

## Recall

### User request

- Make Settings content text slightly larger than its own navigation text without letting Settings feel oversized beside the workspace rail.
- Unify search-field styling against the Codex desktop reference.
- Redesign the crowded MCP (Model Context Protocol) and Providers Settings pages so typography, spacing, controls, and alignment use one visual language.
- Align the empty-home composer and three suggestion cards to the message-panel width, reduce their visual bulk, and highlight the model selector when no model is selected.
- Replace the duplicate Expert Squads `Install` / `Details` navigation glyphs with distinct semantic icons.
- Use the seven supplied desktop screenshots as the acceptance reference.

### Acceptance criteria

- Settings uses one local typography scale: navigation remains the compact application baseline, body copy is only slightly larger, section titles are restrained, and the page title no longer dominates the workspace.
- Settings, Task Context, Providers, Expert Squad Market, file search, and changes search render through one real search-field component and one height/radius/focus contract. Settings-size fields and adjacent actions align vertically.
- MCP no longer presents a tall hand-built Agent tab wall inside one crowded card. Agent selection uses a mature settings control and capability, configured-server, and projected-pool information have distinct flat sections.
- Providers has one surface boundary, aligned statistics/actions, and a full-width shared search field without nested toolbar-card chrome.
- Empty-home title, composer, and suggestion cards derive width from the canonical message-content token. Suggestion cards are shorter and quieter.
- An unselected model is represented by a semantic DOM state and a stable highlighted treatment; it is not detected from translated copy and does not continuously flash.
- Expert Squad installation and detail pages have different semantic Lucide-backed icons while the canonical Expert Squad identity icon remains unchanged elsewhere.
- Focused unit tests, Overlay type checking, i18n checking, Node-launched Playwright browser tests, fresh desktop screenshots, documentation health, diff review, commit, and legacy remote push complete.

### Hard constraints

- Desktop-only scope; do not add tablet/mobile/responsive delivery requirements.
- Reuse Solid, Kobalte-backed Settings controls, `Button`, `Settings*` primitives, and the Lucide icon registry. Do not hand-build replacement commodity controls.
- No fallback, compatibility branch, second visual source, keyword matching, state machine, or hidden/synthetic message path.
- Do not restart, refresh, close, or interfere with the user's running OpenCorvus/Overlay. Visual verification uses an isolated Node-launched browser fixture.
- Preserve unrelated dirty worktree changes. Do not create a worktree, reset the repository, or stage unrelated hunks.
- Every code change receives regression coverage. Commit subjects start with `dsw-33987` and push to the configured legacy remote.

### Sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-09-overlay-codex-full-style-parity.md`
- `specs/records/2026-07/2026-07-10-overlay-codex-strict-parity-remediation.md`
- `specs/records/2026-07/2026-07-11-settings-detail-gui-remediation.md`
- `specs/records/2026-07/2026-07-15-codex-settings-multica-expert-squad-unification.md`
- `specs/records/2026-07/2026-07-16-expert-squad-settings-capability-redesign.md`
- The seven user-supplied screenshots listed in the current conversation.
- Relevant Overlay components, styles, primitives, and tests under `packages/overlay/**`.

### Whole-repository search evidence

| Search cluster | Call points and decision |
| --- | --- |
| `Task Context`, `MCP Servers`, `Providers`, `Choose model`, Expert Squad labels | `ConfigDialogHost.tsx`, `MemoryPanel.tsx`, `SkillMarketPanel.tsx`, `ProvidersPanel.tsx`, `Conversation.tsx`, `ExecutorSelector.tsx`, `store/dialog.ts`, and the locale files are the visible owners. Preserve locale ownership and existing data/action services. |
| `.search-field`, `.search-field-icon`, `.search-field-input` | Production callers are `ConfigDialogHost.tsx`, `MemoryPanel.tsx`, `ProvidersPanel.tsx`, `FileExplorerPanel.tsx`, and `FileChangesView.tsx`; Expert Squad Market had a sixth private search implementation. Replace all six render paths with one `SearchField` component while keeping `field.css` as the chrome source. |
| `config-page-title`, `s-group-head`, `s-row-title`, `s-row-desc`, Settings font tokens | The shared application tokens are 20/15/14/14/12px, but Settings adds a 30px page title and multiple high-specificity size overrides. Add one Settings-local scale and remove owner-specific size jumps. |
| `agent-capability-layout`, `activeCapabilityAgent`, `renderCapabilityAgentTabs`, MCP configured/projected sections | `SkillMarketPanel.tsx` is the single data and selection owner. Replace its hand-written vertical `role=tab` list for Tool/MCP projection with existing `SettingsSelect`, then separate the three MCP information regions using existing Settings detail surfaces. |
| `provider-command`, `provider-stat`, `provider-head-actions`, provider search | `ProvidersPanel.tsx` owns the toolbar; `settings.css` creates the nested card and extra button-width rules. Keep service behavior, remove the inner card boundary, align statistics/actions, and use `SearchField`. |
| `--chat-home-composition-width`, `--ui-chat-message-content-width`, `chat-home-suggestion` | `base.css` owns canonical message width; `conversation.css` independently hard-codes `900px/68%` and 132px cards. Project home geometry from the message token and reduce only the local suggestion geometry. |
| `selectedModel`, `modelPlaceholder`, `composer-model-selector` | `ExecutorSelector.tsx` already knows whether a model is selected. Add `data-requires-selection` from that value and style the existing Button/Popover; do not match `Choose model` text. |
| `SECTION_ICONS`, `expert-squad` | Only `ConfigDialogHost.tsx` maps both child pages to one icon. Add two navigation-semantic icon names to `Icon.tsx`; do not change the shared Expert Squad identity used by Work Ledger, mentions, and catalog rows. |
| Related regression selectors | Update `search-field-unification`, `config-panel-sizing`, `provider-settings-layout`, `conversation-empty-state-source`, `workspace-composer-density`, `executor-selector-dualbar`, and Expert Squad navigation tests; extend the existing config, memory, provider, composer, and Expert Squad browser fixtures for computed geometry and screenshots. |

### Independent agent feedback

- Settings audit: the main typography defect is the local 30/20/15/14px ladder; the search contract is CSS-only and its callers disagree on 40/34/30px heights; MCP mixes hand-written tabs and multiple datasets in one 880px surface; Providers draws a nested command card and gives actions private widths.
- Composer/icon audit: home content already aligns internally but uses the wrong independent width source; 132px suggestion cards are unnecessarily dominant; model absence needs a semantic state; the two Expert Squad navigation entries should receive page-specific icons without changing the global Expert Squad identity glyph.

## Implementation plan

1. Add the shared `SearchField` component and migrate every production search-field call site, including the Expert Squad Market private field.
2. Introduce one Settings-local typography/control rhythm, flatten Providers, and restructure MCP around a mature Agent selector plus separated Settings detail surfaces.
3. Bind empty-home composition width to the canonical conversation content width, reduce suggestion-card geometry, and add the stable unselected-model highlight.
4. Add distinct Expert Squad Install/Details navigation icon mappings.
5. Update focused unit/browser regressions, render fresh desktop screenshots through the Node browser runner, inspect them at original resolution, and iterate.
6. Run second review and documentation health checks, update this record with evidence, stage only task-owned hunks, commit, and push to legacy remote.

## Result

Implemented the seven requested desktop corrections through the shared design system:

- Added one `SearchField` primitive and migrated Settings, Task Context, Providers, Expert Squad Market, file search, and changes search. Settings fields now use one 36px control tier and one focus treatment.
- Replaced the Settings 30/20/15/14px typography ladder with a restrained 26/18/15/14px local scale. The inspected General screenshot confirms body copy is slightly larger than navigation without overwhelming the workspace rail.
- Flattened the Providers command area, retained one-line catalog rows, and restored a connected-only status pill so successful authentication stays observable without showing verbose API-key warnings on every row.
- Replaced Tool/MCP's hand-written vertical agent wall with the existing Kobalte-backed Settings select and separated agent projection, configured MCP status, and projected MCP pool into bounded detail surfaces.
- Bound empty-home title, composer, and cards to `--ui-chat-message-content-width`, reduced suggestion cards from 132px to 108px, and added `data-requires-selection="true"` plus a stable accent highlight to the unselected model control.
- Assigned separate Shopping Bag and Workflow glyphs to Expert Squad Install and Details while leaving the global Expert Squad identity icon unchanged.

Fresh isolated desktop screenshots were inspected at original resolution:

- `.scratch/overlay-empty-home-composer-1440.png`: title, composer, and all three 108px cards share the 1040px message width; the model selector has a visible non-animated accent treatment.
- `.scratch/config-dialog-resizer.png`: 15px content copy reads larger than the 14px navigation, the page title is restrained, and the search field aligns with the sidebar rhythm.
- `.scratch/provider-settings-primitive-owner.png`: statistics/actions and the full-width search field form one flat toolbar; provider rows remain aligned and compact.
- `.scratch/settings-mcp-projection.png`: agent selection is horizontal and compact; configured status and projected pool have distinct visual ownership.

Verification completed:

- Overlay `tsc --noEmit` passed.
- Focused unit suite passed 119 tests after updating the connected-only Provider status contract.
- Node-launched browser checks passed for command palette/home composition, Settings resizer/typography, Provider search and all three prompt-driven authentication flows, Tool/Skill/MCP projection, and the primary Expert Squad install/detail lifecycle.
- The production Vite build passed; its existing large-chunk advisory remains informational.
