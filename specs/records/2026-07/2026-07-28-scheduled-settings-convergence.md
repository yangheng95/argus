# Scheduled Settings Convergence

## Recall

### User requirement

- “现在的 sheduled 跟设置面板脱离了，不是一个系统，把 sheduled 挪到设置面板然后统一设计语言。”
- Follow-up: “scheduled 的左侧 dock 入口不要删除。”
- Interpret `sheduled` as the existing `Scheduled` / `Scheduled automations` surface.

### Acceptance criteria

- Scheduled Automations is a first-class Settings destination and no longer owns an independent fullscreen Dialog.
- The left Work Ledger retains a compact Scheduled shortcut that opens the
  canonical Settings → Scheduled destination directly.
- Settings search, command palette, titlebar Settings menu, keyboard tab semantics, page title, and panel lifecycle all derive from the canonical `CONFIG_SECTIONS` registry.
- Project selection, list/detail, loading, empty, warning/error, form, history, and action states use the Settings composition and visual tokens instead of a parallel dialog language.
- Existing Automation CRUD, pause/resume, run-now, history, recurrence, model, project, and exact-Session navigation behavior remains backed by the existing project-scoped services.
- A real isolated Vite page is opened, exercised, captured, and visually inspected at the desktop delivery size; failures are repaired and recaptured.

### Hard constraints

- Preserve all unrelated staged, unstaged, and untracked work. Do not stash, reset, restore, delete, or broadly stage it.
- Do not restart, close, refresh, or otherwise interfere with the user's running OpenCorvus/Overlay process.
- Use a separately started Vite target and Node-driven browser interaction.
- Do not add a second Automation store, local signal/query override, compatibility alias, fallback route, temporary iframe, or hand-built replacement control primitive.
- Keep the desktop-only delivery scope. Mobile, tablet, and responsive migration are not authorized.
- Reuse `SettingsPanel`, `SettingsGroup`, `SettingsSurface`, `SettingsRow`, `SettingsState`, and the canonical Button/Select/Combobox/TextField controls.
- Keep Automation lifecycle ownership in `AutomationService` and the existing Overlay service; this task only changes its presentation and navigation owner.

### Read records and sources

- `AGENTS.md`
- `specs/records/2026-07/2026-07-26-codex-parity-scheduled-automations.md`
- `specs/records/2026-07/2026-07-27-scheduled-automation-usability-repair.md`
- `specs/records/2026-07/2026-07-25-settings-system-visual-functional-audit.md`
- `packages/overlay/src/store/dialog.ts`
- `packages/overlay/src/services/config-dialog-control.ts`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/components/ConfigDialogHost.tsx`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ScheduledAutomationsHost.tsx`
- `packages/overlay/src/components/settings/layout.tsx`
- `packages/overlay/src/styles/surfaces/settings.css`
- `packages/overlay/src/styles/surfaces/automations.css`
- `packages/overlay/test/scheduled-automations.test.ts`
- `packages/overlay/test/browser/automation-lifecycle-browser.test.ts`

### Whole-repository call-site inventory

| Call site | Current role | Disposition |
| --- | --- | --- |
| `store/dialog.ts` `ConfigDialogTab` / `CONFIG_SECTIONS` | Canonical Settings destination registry | Add `scheduled`; keep this as the single navigation/search/menu source. |
| `ConfigDialogHost.tsx` section icon/group/body/render switches | Settings presentation owner | Register `scheduled`, render the Automation panel, and receive exact-Session navigation from `App`. |
| `App.tsx` | Mounts both Settings and the independent Automation Dialog | Remove the independent host and pass the existing Session callback only to Settings. |
| `WorkLedger.tsx` | Previously emitted `oc:open-scheduled-automations` from a separate Dock row | Retain the row as a shortcut, replace its event with `openConfigDialog("scheduled")`, and keep Settings as the only page owner. |
| `ScheduledAutomationsHost.tsx` | Owns Dialog open/focus lifecycle plus Automation content | Replace with `settings/ScheduledAutomationsPanel.tsx`; retain data/form behavior and delete the Dialog/event lifecycle. |
| `styles/surfaces/automations.css` | Owns a second dialog/project/list/detail visual dialect | Retain domain layout only; restyle it through Settings surfaces, spacing, typography, states, and tokens. |
| `i18n/*` `automations.*` | Automation terminology | Reuse existing page and field copy; add only a Settings-appropriate project/group description if visual hierarchy needs it. |
| `scheduled-automations.test.ts` | Service plus source-contract coverage for the old Dialog | Replace Dialog/Dock assertions with Settings registry/host/composite/single-source assertions while retaining service and form contracts. |
| Automation browser tests | Real lifecycle evidence enters through the old Dock row | Update the focused Settings acceptance path and retain lifecycle behavior against the real backend where practical. |
| `services/automations.ts`, recurrence helpers, OpenCorvus Automation routes/services | Canonical Automation data and execution owners | Keep unchanged unless a real regression proves otherwise. |

### Independent-agent feedback

- No independent Agent was requested for this task, so no sub-agent was started.
- The main-agent review boundary is the existing Settings visual contract plus a second post-implementation source/diff review and real browser evidence.

## Architecture decision

Scheduled Automations becomes one project-aware Settings destination. The Settings
registry owns discovery and navigation; the panel owns only its mounted UI state;
the existing Automation service remains the sole durable data and execution
source. The left-Dock Scheduled row remains as a direct shortcut to that registry
destination. Its former custom event and fullscreen Dialog are deleted rather
than retained as an alias, so the shortcut does not create a second page or
navigation state.

The panel uses the Settings composites for page grouping, rows, feedback, and
surface boundaries. Domain-specific two-column list/detail and recurrence form
layout remain local to the Automation surface, but inherit Settings widths,
colors, borders, spacing, typography, and control primitives.

## Implementation plan

1. Register `scheduled` in `CONFIG_SECTIONS`, Settings icon ownership, the Personal navigation group, body IDs, and active-panel rendering.
2. Convert the independent host into `ScheduledAutomationsPanel`, initialize it on mount, remove Dialog/open/focus/event state, and route successful run-history Session selection through the Settings host callback.
3. Retain the Work Ledger Scheduled shortcut, route it through
   `openConfigDialog("scheduled")`, and delete the standalone App mount.
4. Compose project, automation collection, detail/form, empty, loading, and error states with the canonical Settings components; reduce Automation CSS to domain layout over Settings tokens.
5. Update source contracts and add a Settings navigation regression that proves there is exactly one owner and no retired event/Dialog residue.
6. Run focused unit/type/i18n/build checks, start an isolated Vite/browser target, exercise Settings → Scheduled and representative states, inspect screenshots, repair, and rerun.
7. Re-read the final diff, run documentation health checks, commit only task-owned changes with the required `dsw-33987` prefix, and push the current main delivery branch to `myhexin`.

## Implemented convergence

- Registered `scheduled` in the canonical Settings section registry. It now
  appears under Personal and automatically participates in Settings search,
  titlebar navigation, the command palette, page-title projection, and Kobalte
  tab semantics.
- Replaced `ScheduledAutomationsHost` with
  `settings/ScheduledAutomationsPanel`. The independent fullscreen Dialog,
  `oc:open-scheduled-automations` event and return-focus state were deleted.
- Retained the left Work Ledger Scheduled launcher as a Settings shortcut. It
  calls `openConfigDialog("scheduled")` directly and therefore cannot recreate
  the former independent Dialog or event-owned state.
- Routed the existing Automation run-history Session callback through
  `ConfigDialogHost`; Settings closes only after the exact Session navigation
  succeeds and retains the visible error surface on failure.
- Rebuilt the project owner, collection, list rows, loading/empty/error
  feedback, and panel boundaries with `SettingsPanel`, `SettingsGroup`,
  `SettingsSurface`, `SettingsRow`, `SettingsEmpty`, and `SettingsState`.
  Automation-specific list/detail and recurrence layouts now consume Settings
  surface, divider, hover, selection, radius, and spacing tokens.
- Retained compact Work Ledger label and tooltip copy for the shortcut while
  keeping `automations.title` as the canonical Settings page label.
- Added regression coverage for registry ownership, the Dock-to-Settings route,
  the absence of the retired Dialog/event paths, Settings composite use,
  preserved project-scoped service behavior, and Settings scroll ownership
  during the full form flow.

## Verification and visual review

- `bun run --cwd packages/overlay typecheck`: pass.
- `bun run --cwd packages/overlay check:i18n`: pass.
- Focused Settings, Automation, Work Ledger, Dialog, command-palette, and
  Multica source contracts: 40 pass / 0 fail.
- Focused left Work Ledger mount contract: 1 pass / 0 fail.
- `bun run --cwd packages/overlay build:vite`: pass.
- Node-driven headed lifecycle against an isolated Vite server, isolated
  OpenCorvus backend, temporary Git project, and local streaming model provider:
  strict E2E PASS. It entered through the visible left-Dock Scheduled shortcut,
  asserted the selected Settings registry tab, and covered create, local
  validation, controlled time-zone/model/reasoning selection, edit, pause,
  reload, resume, run-now, exact run-history Session navigation, Heartbeat
  Session ownership, and armed delete. The provider received two real model
  requests.
- The same E2E asserts that the browser window does not become the Settings
  scroll owner, the Settings sidebar stays at scroll position zero, and the
  sidebar/content axes remain aligned while the long Automation form scrolls.
- Fresh 1440 × 900 screenshots were opened and inspected at original
  resolution:
  `specs/artifacts/2026-07-28-scheduled-settings-convergence/`.
  `00-left-dock-scheduled-entry.png` proves the restored shortcut uses the same
  icon, label, spacing, and grouping language as the surrounding Dock actions;
  `00-settings-scheduled-navigation.png` proves that shortcut opens the selected
  Settings destination. Review also confirmed the repaired detail grid still
  spans the last factual row instead of exposing inactive grey cells.
- The broader left-Dock compact and Multica browser fixtures still report
  unrelated existing failures: a stale 15px radius expectation observes the
  current 18px token, and the Multica fixture lacks current capability routes
  plus expects obsolete confirmation focus. Neither failure touches Scheduled
  navigation or Automation behavior; the isolated Scheduled lifecycle and the
  task-owned source contracts pass.
