# Titlebar, worktree, and expert-squad layout

## Recall

### User request

- Remove the tooltip shown on the titlebar menu in the first reference image.
- Present worktrees as a titled list: a `Worktree` header at the same hierarchy as `Environment information`, refresh and delete-all actions in that header, and one named row with its own delete action per worktree.
- Present Expert Squads as a left-navigation group with `Install` and `Details` child titles, and separate the corresponding right-side content.

### Acceptance

- Titlebar menu triggers and menu items retain accessible names without native `title` tooltips.
- The runtime popover always renders a peer `Worktree` section header, refreshes through the existing project-worktree loader, bulk-deletes every removable visible worktree through the existing delete service, and renders each worktree name in its own row with a per-row delete button.
- Settings navigation renders `Expert Squads` as a group title, with independently selectable `Install` and `Details` pages. Import controls occur only on Install; catalog overview, squad list, activation, export, and technical details occur only on Details.
- English and Simplified Chinese labels, regression tests, type checking, build, and desktop screenshot review pass.

### Hard constraints

- Reuse Kobalte/Solid settings and button primitives and the existing `/project/current/worktrees` service; no parallel API, local mock state, compatibility route, fallback, or workflow gate.
- Preserve unrelated dirty worktree changes and do not create another git worktree.
- Do not restart, close, refresh, or otherwise disturb a running OpenCorvus/overlay process. Visual validation uses an isolated test page and Node-started Playwright.
- Desktop-only scope; no unsolicited mobile or tablet layout work.

### Read material

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-08-right-toolbar-runtime-status-panel-merge.md`
- `specs/records/2026-07/2026-07-05-overlay-expert-squad-settings-redesign.md`
- `specs/records/2026-06/2026-06-18-command-palette-config-sections-single-source.md`
- Browser control skill instructions for real-page interaction and screenshots.

### Whole-repository grep

| Surface                 | Command / evidence           | Decision              |
| ----------------------- | ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Titlebar tooltip        | `rg -n "MenuItem             | data-menu-trigger     | title=" packages/overlay/src/components/titlebar/TitlebarMenubar.tsx packages/overlay/test` | Remove native titles from the shared menu item and trigger owners while retaining `aria-label` and action labels. |
| Worktree UI and service | `rg -n "current/worktrees    | loadProjectWorktrees  | deleteProjectWorktree                                                                       | deleteProjectWorktrees                                                                                            | cleanupExpired                                                                                                                                                                               | project-worktree" packages/overlay/src packages/overlay/test packages/opencorvus/src/server/routes/project.ts` | Reuse the project route and service. Replace expired-only toolbar presentation with explicit refresh and all-removable bulk deletion in the header; keep the same confirmed delete lifecycle. |
| Settings section source | `rg -n "CONFIG_SECTIONS      | ConfigDialogTab       | data-config-tab                                                                             | expert-squad" packages/overlay/src packages/overlay/test specs`                                                   | Add the install child to the existing single section registry, retain `expert-squad` as the existing details deep link, and form the Expert Squads nav group from those registered sections. |
| Expert squad panel      | `rg -n "expert-squad-toolbar | expert-squad-overview | expert-squad-layout                                                                         | expert-squad-detail" packages/overlay/src packages/overlay/test`                                                  | Parameterize one panel implementation by the selected registered page; do not create a second catalog or action owner.                                                                       |

### Independent agent feedback

- No independent agents were requested, so none were spawned.

## Implementation plan

1. Remove native title tooltips from titlebar menu chrome and add an accessibility regression.
2. Recompose the runtime panel worktree section around its existing loader and deletion services; add refresh/delete-all labels and interaction coverage.
3. Extend the single settings-section registry with Expert Squad Install, turn Expert Squads into a nav group, and split one panel implementation into install/details projections.
4. Update focused unit/browser tests, run typecheck/build/document-health checks, then open isolated desktop pages, inspect screenshots, correct visual issues, and rerun.
5. Review the final diff, commit only task-owned files with the required `dsw-33987` prefix, and push the current branch to legacy remote.

## Result

- `TitlebarMenubar` no longer emits native `title` attributes for either menu triggers or menu items. Accessible labels and shortcut metadata remain intact.
- The environment popover now owns a peer `Worktree` section with visible Refresh and Delete all actions, an explicit empty state, and one left-aligned named row plus per-row delete action for each non-primary worktree.
- Refresh reuses `loadProjectWorktrees`; Delete all reuses `deleteProjectWorktrees` for every removable visible row. Existing directory-ownership checks, confirmation, partial-failure refresh, and board reload behavior remain the only lifecycle path.
- `CONFIG_SECTIONS` now registers `expert-squad-install` and the existing `expert-squad` details route. `ConfigDialogHost` projects them as Install and Details children beneath an Expert Squads navigation group.
- One `ExpertSquadPanel` implementation projects the two right-side pages: package replacement/import controls on Install, and catalog overview/list/activation/export/technical details on Details.

## Verification

- Passed `bun run --cwd packages/overlay typecheck`.
- Passed `bun run --cwd packages/overlay check:i18n`.
- Passed 38 focused unit/source tests across runtime controls, settings sizing, command palette registration, expert-squad navigation, and titlebar tooltip ownership.
- Passed 20 `historical-docs-links` document-health tests.
- Passed Node-started browser build and 16 titlebar/runtime tests, including a real refresh request, directory-switch ownership, single delete, delete-all confirmation/completion/busy/partial-failure/reload cases, native-tooltip absence, and screenshot capture.
- Passed Node-started browser build and 5 Expert Squads/titlebar tests, including Install/Details content isolation, session scope, recovery, lifecycle actions, and screenshot capture.
- Passed `git diff --check` before final staging.
- Visually reviewed `.scratch/task-dirbar-runtime-status-panel-merged.png`, `.scratch/expert-squad-settings-install.png`, and `.scratch/expert-squad-settings-page.png`. The first review found centered worktree names; `justify-content: flex-start` and full row width corrected the list, and the refreshed runtime screenshot was reviewed again.
