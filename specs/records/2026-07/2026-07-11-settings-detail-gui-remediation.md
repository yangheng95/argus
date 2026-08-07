# Settings detail GUI remediation

## Recall

### User request

The Settings dialog outer container has been restyled, but the user explicitly rejects the unfinished inner-page presentation and asks for direct GUI analysis, testing, repair, and visual re-review.

### Acceptance criteria

- Appearance and Agent Models do not repeat the current page title inside the page body.
- Providers reads as a deliberate settings surface: summary, actions, search, configured providers, credentials, catalog rows, and edit/add forms have clear hierarchy and usable control sizing.
- Agent Models shows human-readable agent descriptions and a structured tier table instead of a loose monospace developer list.
- Expert Squad preserves all package/runtime evidence while making overview, catalog, and selected-package detail independently scannable.
- Permission choices retain semantic allow/ask/deny colors instead of collapsing every selected state to accent blue.
- Real rendered desktop screenshots cover Appearance, Providers, Agent Models, Expert Squad, and Permissions; failed visual findings are fixed and re-captured.
- Functional provider/model/expert-squad contracts remain unchanged; no fallback, compatibility path, fake data, hidden action, or duplicate source is introduced.

### Hard constraints

- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus process. GUI validation uses an isolated preview/fixture.
- Use Node, not Bun, for Playwright/browser launch.
- Preserve the large pre-existing dirty worktree and do not overwrite unrelated edits.
- Every behavior/visual-contract change receives focused tests. Existing tests that encode the rejected flat-detail presentation must be corrected rather than treated as acceptance authority.
- Desktop Settings is the authorized delivery surface; no mobile/responsive expansion is added.

### Persisted sources read before implementation

- `specs/records/2026-07/2026-07-10-overlay-codex-strict-parity-remediation.md`
- `specs/records/2026-07/2026-07-10-provider-settings-contract-repair.md`
- `specs/records/2026-07/2026-07-05-overlay-expert-squad-settings-redesign.md`
- `packages/overlay/src/components/settings/{primitives,AppearancePanel,AgentModelsPanel,ProvidersPanel,ExpertSquadPanel,GeneralPanel}.tsx`
- `packages/overlay/src/styles/surfaces/settings.css`
- Settings unit and browser tests under `packages/overlay/test/**`

### Whole-repository search evidence

Focused `rg` covered `provider-settings-row`, `provider-command`, `agent-model-table`, `agent-model-assignment`, `expert-squad-overview`, `permissions-settings-group`, SettingsGroup title ownership, and Settings small-button sizing across source, tests, and July records. The live owners are the four panel components and `settings.css`; the explicit visual-contract expectations are in `config-panel-sizing.test.ts`, provider layout tests, expert-squad surface tests, and the Settings browser fixtures. Network, General, Permissions, and server-connection section titles are legitimate subsection titles and are retained.

### Independent agent feedback

No sub-agent was used because the user did not request delegation and the active collaboration boundary prohibits unsolicited agent spawning. The primary agent performed the screenshot review directly.

## Initial GUI findings

- Appearance repeats “Appearance” and leaves two ordinary controls floating in an oversized blank page.
- Providers repeats “Providers”, uses 28-pixel action buttons, exposes raw counters and credentials in a cramped developer-tool grid, and lacks bounded section rhythm.
- Agent Models repeats “Agent Models”, hides useful descriptions in native title tooltips, renders agent IDs in monospace, and presents tiers as loose labels rather than a coherent assignment table.
- Expert Squad compresses overview telemetry into tiny cards, makes the catalog too narrow, and presents the selected package as an uncontained evidence dump.
- Permissions has semantic tone rules, but a later universal selected-state selector overwrites all choices with accent blue.

## Repair boundary

The repair changes presentation ownership only: remove duplicate body headings, expose already-available descriptions, establish bounded complex-detail surfaces, increase control hit targets, and restore semantic selection tones. API routes, persistence, model/provider values, expert-squad identity, and active selection sources are not changed.

## Scope escalation after first rendered review

The first repaired screenshots proved that per-page CSS improvements alone do not satisfy the user request: General, Appearance, Providers, Agent Models, and Expert Squads still speak different structural dialects. The delivery therefore expands from detail cleanup to a Settings design-system convergence. Shared primitives must own both simple row groups and complex detail sections; page code supplies domain content, not bespoke shell grammar. The unified language is: one page title, optional explanatory copy, consistent section header, one bounded surface per coherent dataset, 34-pixel minimum compact actions, quiet neutral selection with semantic status color reserved for meaning, and a common 68-pixel assignment/setting row rhythm.

## Verification commands

- `bun test packages/overlay/test/config-panel-sizing.test.ts packages/overlay/test/provider-settings-layout.test.ts packages/overlay/test/settings-primitives.test.ts packages/overlay/test/expert-squad-settings-surface.test.ts`
- focused Node-launched browser fixtures for Settings pages
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

## Rendered result and review

- General: semantic Allow selection now uses the theme `--good` token; the first browser run caught and rejected an invalid `--ok` token before the corrected capture passed.
- Appearance: the duplicate body title is gone; the two real preferences occupy one coherent row surface without invented filler settings.
- Providers: the repeated title is gone; summary/actions/search form one command surface; configured and catalog datasets use the shared `SettingsDetailSection` plus `SettingsSurface` grammar with visible spacing between sections.
- Agent Models: page explanation is owned by the group description, agent descriptions are visible, the project default is distinct, and tier assignments use the same bounded surface/row rhythm.
- Expert Squads: overview tiles, a wider bounded catalog, and a contained detail inspector replace the previous compressed list/evidence dump while preserving all projection evidence.
- Browser acceptance passed for the Settings dialog and Provider functional flows after the final rebuild. Unit contracts and Overlay TypeScript checking passed. Screenshots were personally reviewed at desktop width; no mobile scope was added.
