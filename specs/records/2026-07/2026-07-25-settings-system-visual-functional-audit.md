# Settings System Visual and Functional Audit

Date: 2026-07-25

Status: Implemented and verified; commit/push deferred to preserve concurrent staged work

## Recall

### User request

- Perform a comprehensive visual review of the Settings panel.
- Resolve the inconsistent design language and product philosophy.
- Verify that Settings functionality actually works instead of relying on source assertions or stale tests.

### Acceptance

- Audit all 18 registered Settings destinations, not a sampled subset.
- Verify navigation/search, loading, empty, populated, disabled, error, selection, mutation, and persistence behavior where each surface supports those states.
- Establish one visible hierarchy for page title, section explanation, content surface, rows, controls, status, and destructive actions.
- Remove local presentation dialects when the shared settings composites or canonical UI primitives can express the same contract.
- Verify the result in a real desktop Vite page with task-scoped screenshots inspected at original resolution.
- Add or repair regression coverage for every behavior or visual contract changed.

### Hard constraints

- Preserve unrelated dirty-worktree changes and stage only task-owned hunks.
- Do not restart, close, refresh, or otherwise manipulate the user's running OpenCorvus/overlay process.
- Use an independently started Vite target and Node-driven browser verification.
- Do not accept screenshots, DOM text, type checks, or mocked requests alone as functional proof.
- Do not add fallback, duplicated settings state, UI-only fake configuration, hard-coded process gates, or a second component primitive catalog.
- Keep the desktop Settings scope; responsive/mobile work is not part of this request.

### Read sources and prior records

- Repository `AGENTS.md`.
- `packages/overlay/src/store/dialog.ts`.
- `packages/overlay/src/components/ConfigDialogHost.tsx`.
- `packages/overlay/src/components/settings/layout.tsx`.
- `packages/overlay/src/styles/surfaces/settings.css`.
- `specs/records/2026-07/2026-07-24-settings-capability-scope-navigation.md`.
- Prior Vite verification records for global Settings ownership.

### Whole-repository inventory

`ConfigDialogTab`, `CONFIG_SECTIONS`, `CONFIG_NAV_GROUPS`, `renderActivePanel`,
`SettingsPanel`, `SettingsGroup`, `SettingsSurface`, `SettingsDetailSection`,
`SettingsRow`, `SettingsToolbar`, `.s-*`, `.config-*`, `.extension-*`,
`.provider-*`, `.mission-skill-*`, `.expert-squad-*`, and all Settings browser/unit
tests were searched before implementation.

The registered desktop Settings matrix is:

| Group | Destination | Runtime owner | Required functional evidence |
| --- | --- | --- | --- |
| Personal | General | global/project config | change a reversible setting and observe authoritative persistence |
| Personal | Appearance | local persisted UI settings | change theme/scale and observe the rendered/persisted result |
| Personal | Network | project/global config | exercise proxy editing or explicit empty/error state |
| Personal | Providers | auth/config/provider catalog | inspect provider state and exercise a non-secret reversible control |
| Personal | Agent Models | global/project agent model registry | inspect scope and model assignment or explicit empty/error state |
| Agent Squads | Squad Market | package catalog/installer | inspect populated catalog and selection state |
| Agent Squads | Installed Agent Squads | strict registry/settings route | switch exact squad and verify declaration identity |
| Agent Squads | Squad Skill | project skill mounts | inspect/toggle a reversible mount when available |
| Agent Squads | Squad MCP | selected package declaration | verify read-only package projection |
| Agent Squads | Squad Tool | selected package declaration | verify read-only package projection |
| Agent Squads | Mission Card | Mission Skill registry | inspect catalog, selection, copy invocation, and source actions where available |
| Chat | Tools | native Chat declaration | verify read-only declared tools |
| Chat | Skills | native Chat assignment plus Skill resource management | inspect and toggle a reversible assignment when available |
| Chat | MCP | native Chat assignment plus MCP resource management | inspect and toggle a reversible assignment when available |
| Memory & Context | Memory & Context | active task/session context | verify the correct scoped state or explicit unavailable state |
| Integrations | Channel | channel config/runtime | inspect a real channel state and reversible enable/config affordance |
| Archived | Archived | archived conversations/tasks | inspect empty/populated state and restore affordance when available |
| Footer | About | runtime diagnostics | verify current runtime and link/shortcut presentation |

### Visual contract

1. Navigation uses one typography, icon, selected-state, spacing, and group-heading language.
2. Every destination begins with one page-level title/description hierarchy; domain cards do not invent competing page headers.
3. Simple settings use `SettingsGroup` plus `SettingsRow`; complex catalogs use `SettingsDetailSection` plus `SettingsSurface`.
4. All rows share the same title/body/meta typography, divider rhythm, control alignment, and disabled/read-only treatment.
5. Loading, empty, warning, error, and success states use the same semantic status primitives and insets.
6. Primary, secondary, destructive, segmented, checkbox, search, and select controls come from canonical UI primitives.
7. Accent color communicates selection/action/status; it does not create ornamental one-off cards.
8. Light and dark themes preserve hierarchy and accessible contrast without separate visual dialects.

## Baseline audit

The independent Vite target at `http://127.0.0.1:4180/` was opened through the
real OpenCorvus menu. Every registered destination was selected through the
actual tab primitive and captured at 1280 × 720 under:

- `.scratch/settings-system-audit/baseline/`
- `.scratch/settings-system-audit/baseline-contact-sheet.png`

The baseline established the following concrete failures:

1. Chat Tools, Skills, and MCP stayed on `Loading…` forever when there was no
   project directory because the request effect returned before assigning a
   terminal state.
2. Squad Skill, Squad MCP, and Squad Tool described the same missing-directory
   condition as an empty catalog (`No Agent Squads available`).
3. Mission Card, Squad Market, Installed Squads, Chat, and Memory represented
   the same unavailable-scope state with unrelated blue, beige, naked-text, or
   empty-card treatments.
4. Mission Card repeated its page title as a group title and added a one-off
   mission boundary card.
5. Memory and About bypassed the shared Settings composition; About invented
   its own author card, information grid, and shortcut grid.
6. Provider refresh errors, Agent Model request errors, and settings scope
   warnings used independent error geometries.
7. The Vite process was connected to the existing backend on port 7878. Its
   anonymous-project row did not provide a project directory to current
   Settings, so no-directory evidence was treated as the authoritative
   unavailable-scope case rather than as proof of current uncommitted anonymous
   project backend work.

## Implementation

- Added `SettingsState`, the single settings feedback composition for neutral
  loading, information, success, warning, and error states. Empty collections
  remain represented by `SettingsEmpty`.
- Split Chat capability `loading`, `error`, `empty`, and missing-directory
  state. A missing directory now terminates immediately with an explicit
  unavailable-scope state.
- Applied the same terminal-state model to exact Squad capability inspection.
- Replaced Mission Card's one-off boundary and feedback boxes with the shared
  state composition, removed the duplicate page title, and retained its
  Mission-only explanation and badge.
- Wrapped Memory and About in the shared Settings panel/group/surface/row
  hierarchy. Memory now distinguishes loading, request failure, missing
  project directory, missing Task, and an empty selected Task.
- Replaced Provider refresh errors and Agent Model request/missing-default
  errors with the same feedback surface.
- Preserved the strong black settings tab text and the Agent Squads / Squad
  Skill / Squad MCP / Squad Tool / Mission Card naming established by the
  capability-scope navigation work.
- Added matched English and Chinese unavailable-scope copy.

## Verification

Completed evidence:

- `bun run typecheck`
- `bun run check:i18n`
- 68 focused Settings/navigation/layout/inset/state/Mission tests: pass
- `bun run build:vite`: pass
- Node-driven headed browser regression
  `settings-system-scope-browser.test.ts`: pass
- Mission Card and Agent Models headed-browser suites: 5/5 pass
- `check:i18n`, historical-doc links (21/21), and `docs:check`: pass
- Real Vite 18-destination matrix: every page selected and captured; no page
  remained on `Loading…`
- Repaired screenshots:
  `.scratch/settings-system-audit/repaired/`
- Repaired contact sheet:
  `.scratch/settings-system-audit/repaired/contact-sheet.png`

The browser regression starts an isolated server with no directory, opens
Settings through the real File menu, and verifies Chat Tools, Squad Skill,
Mission Card, and Memory. Each page must render a visible warning-tone
`SettingsState`, expose the correct status role, contain its exact unavailable
scope explanation, and contain no `Loading` text. The test also captures the
Memory unavailable state.

The final 18-page contact sheet was inspected after Provider and Agent Model
error convergence. The task did not create a Git commit or push because the
shared worktree already contained unrelated staged Research Studio files and
active overlapping uncommitted Settings/anonymous-project/sub-agent work.
Committing or rewriting that index would violate the requirement to preserve
parallel changes. All implementation and evidence remain in the shared
worktree without altering the existing staged set.
