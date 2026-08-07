# Settings Content Inset Convergence

## Recall

### User request

- Add spacing around text on the Settings pages so copy does not sit directly against card borders.
- Inspect and correct every Settings page, using the supplied Tools screenshot as the visible failure reference.
- Prevent Settings empty-state notices from rendering as full-width nested cards, using the supplied Providers screenshot as the second visible failure reference.

### Acceptance criteria

- Tools, Skills, Skill Market, Model Context Protocol (MCP), and Channel custom-content cards use one shared Settings content-inset token; their first visible copy/control starts at least one inset away from the enclosing border.
- General, Appearance, Network, Providers, Agent Models, Task Context, Expert Squad Install/Details, Archive, and About retain their existing correct row/surface spacing without receiving a second nested inset.
- Empty Settings surfaces use the same content inset instead of the current narrow horizontal padding.
- Empty-state copy sizes to its content within the available width; Providers no longer draws the full-width dashed `.provider-empty` card.
- The shared `SettingsGroup` primitive expresses custom-body inset semantics. No page-specific margin patch, structural selector guess, fallback, parallel surface, or duplicated spacing constant is introduced.
- Focused source tests, Overlay type checking, Node-launched Playwright browser tests, fresh light/dark desktop screenshots for every Settings tab, documentation health, diff review, commit, and legacy remote push complete.

### Hard constraints

- Desktop-only scope. Do not add tablet/mobile/responsive delivery work.
- Reuse the existing Solid `SettingsPanel`, `SettingsGroup`, `SettingsRow`, `SettingsSurface`, `SettingsEmpty`, Kobalte-backed controls, and current Settings shell.
- Keep `SettingsGroup` and `settings.css` as the single semantic and visual sources for card-body inset.
- Do not restart, refresh, close, or interfere with the user's running OpenCorvus/Overlay. Use the isolated Node browser fixture and task-scoped screenshots.
- Preserve the pre-existing uncommitted Expert Squad, Button, payload, Settings segmented-control, test, and spec-index changes. Do not create a worktree, reset the repository, or stage unrelated hunks.
- Commit subjects start with `dsw-33987`; push the current branch to the configured legacy remote.

### Sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-15-codex-settings-multica-expert-squad-unification.md`
- `specs/records/2026-07/2026-07-16-settings-search-composer-visual-convergence.md`
- `specs/records/2026-07/2026-07-16-overlay-small-window-typography-clipping-refinement.md`
- The supplied Tools screenshot and the current task-scoped Settings light-theme screenshot matrix under `.scratch/`.
- `packages/overlay/src/components/ConfigDialogHost.tsx`
- Every component under `packages/overlay/src/components/settings/**` plus `MemoryPanel.tsx`.
- `packages/overlay/src/components/settings/primitives.tsx`
- `packages/overlay/src/styles/surfaces/settings.css`
- `packages/overlay/test/settings-primitives.test.ts`
- `packages/overlay/test/browser/config-dialog-resizer.test.ts`
- `packages/overlay/test/browser/skill-mount-matrix-browser.test.ts`

### Whole-repository search evidence

| Call point / surface | Audit decision |
| --- | --- |
| `SettingsGroup` in `GeneralPanel`, `AppearancePanel`, `NetworkPanel`, `PermissionsPanel`, and `ServerConnectionSettingsGroup` | Keep unchanged. Their direct `SettingsRow` children already provide the shared 16px-equivalent row padding. |
| `SettingsGroup` in `ChannelsPanel` | Add the shared custom-body inset to External Access. Replace the Available Channels generic empty hint with `SettingsEmpty`; populated channel rows keep `SettingsRow` padding. |
| `SettingsGroup` in `SkillMarketPanel` for Tool, Skill, Skill Market, and MCP modes | Add the shared custom-body inset. These four groups currently mount `.extension-settings-body` directly and are the repeated flush-to-border defect shown by the supplied screenshot and current matrix. |
| `SettingsDetailSection` in Tool/MCP and Providers | Keep unchanged. Their `SettingsSurface` content already resolves through explicit shared section padding or `SettingsRow` padding. |
| `SettingsGroup` in `ProvidersPanel` | Keep the command/detail/add-form geometry. Replace the private full-width dashed `.provider-empty` card with `SettingsEmpty`; the screenshot proves that the private block-level card is visually overextended even though its text padding is non-zero. |
| `SettingsGroup` in `AgentModelsPanel` | Keep unchanged. Loading/error/detail and assignment surfaces already own their inset; adding a group inset would create double padding. |
| `SettingsGroup` in `ExpertSquadPanel` | Keep unchanged. Its catalog and detail cards already use dedicated shared row/detail inset, confirmed by the current screenshot. |
| `MemoryPanel` and About markup in `ConfigDialogHost` | Keep structure unchanged. Task Context is flat rather than bordered; About cards already have explicit surface padding. |
| `ArchivePanel` | The first focused primitive test proved that Archive hand-writes `.s-*` markup despite the repository-wide primitive guard. Replace that parallel structure with `SettingsPanel`, `SettingsDetailSection`, `SettingsRow`, `SettingsPill`, and `SettingsEmpty` so Archive receives the same row/empty inset contract without a second surface. |
| `.s-empty` call sites | Route horizontal padding through the new shared Settings content-inset token and size the empty element to its content with a 100% maximum, so empty copy neither hugs a border nor creates a full-width nested card. |
| `config-dialog-resizer.test.ts` Settings matrix | Expand the existing matrix to all 15 Settings tabs, assert the custom-body inset geometry, and capture light/dark screenshots. |
| Existing browser projection test | Retain Tool/Skill/MCP data and interaction assertions; add only geometry assertions if the matrix does not cover populated capability surfaces sufficiently. |

### Independent agent feedback

- None. The user did not request sub-agents; repository instructions prohibit unsolicited delegation for this task.

### Git baseline

- Current branch: `work-v0.0.6beta-yr-0716`.
- Baseline commit `2aa7aeee2` is already present on `legacy-remote/work-v0.0.6beta-yr-0716` before this task.
- Pre-existing uncommitted files were enumerated before implementation and remain outside this task's staging boundary.

## Root cause

`SettingsGroup` always renders one bordered `.s-group-body`, but the primitive only defines spacing for `SettingsRow`. Panels that mount a richer wrapper directly into the group body receive no semantic content inset. The repeated `.extension-settings-body` family and Channel's custom form therefore begin on the border edge, while row-based pages look correct. The defect is a missing primitive capability, not a typography or per-page margin problem.

## Implementation plan

1. Add an explicit custom-body inset option to `SettingsGroup` and one shared Settings inset token used by both that option and `SettingsEmpty`.
2. Enable the option only at audited custom-content call points in Channel and Tool/Skill/Skill Market/MCP; migrate Channel and Providers empty states to the non-stretching `SettingsEmpty` primitive and delete the retired provider-only card CSS.
3. Migrate the pre-existing handwritten Archive Settings surface to the same primitives after the focused guard exposed it during implementation.
4. Add focused source regressions for the primitive contract and every enabled call point.
5. Extend the existing isolated Settings browser matrix to every tab and assert real computed inset geometry, then inspect fresh light/dark screenshots at original resolution.
6. Run focused tests, Overlay typecheck/i18n, production build, documentation-health checks, second diff review, commit only task-owned hunks, and push to legacy remote.

## Codex review feedback

- The first focused run of `settings-primitives.test.ts` failed because `ArchivePanel.tsx` hand-wrote the complete `.s-panel` / `.s-group` / `.s-surface` / `.s-row` family. The original audit incorrectly treated its visual use of the same class names as primitive adoption. The plan is revised to migrate Archive through the real Solid primitives; the guard remains strict and unchanged.
- The user's second screenshot added a direct non-stretch requirement. Review of every Settings empty-state call point found only Providers drawing its own nested dashed card; the other visible empty states are unbordered copy inside their owning surface. The plan is revised to migrate Providers and make non-stretch sizing part of `SettingsEmpty` itself.

## Verification

- `bun test packages/overlay/test/settings-content-inset.test.ts packages/overlay/test/settings-primitives.test.ts packages/overlay/test/provider-settings-layout.test.ts` — 59 passed, 0 failed.
- `bun run --cwd packages/overlay typecheck` — passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/config-dialog-resizer.test.ts` — passed; production build completed and all 15 Settings tabs were rendered in light and dark themes with computed inset/overflow assertions.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/skill-mount-matrix-browser.test.ts packages/overlay/test/browser/settings-channel-extension-head.test.ts packages/overlay/test/browser/archive-lifecycle-browser.test.ts` — 3 passed, 0 failed. This covers populated Tool/Skill/MCP projections, Channel extension content, and Archive restore/permanent-delete behavior.
- Fresh screenshots under `.scratch/settings-*-light.png` and `.scratch/settings-*-dark.png` were inspected at original resolution. Focused populated-state screenshots `settings-tool-projection.png`, `settings-skill-mounts.png`, `settings-mcp-projection.png`, `settings-channel-extension-head.png`, and `archive-settings-lifecycle.png` were inspected after the final implementation. Text now clears the owning border; Providers no longer renders the nested full-width dashed empty card; no horizontal overflow was observed.
- `git diff --check` — passed after implementation.
- `bun run --cwd packages/overlay check:i18n` currently reports the unrelated dirty Work Ledger change leaving `work_ledger.mission_task_count` unused. This task does not own that concurrent change or its locale cleanup; rerun before push after the other change settles.
- Documentation health must be rerun after the new record is staged because the health test intentionally rejects README links to untracked records.
