# Scheduled Reference Parity and Project Catalog Repair

## Recall

### User requirement

- “scheduled页面抄这个，而且我现在无法选择项目”
- Recompose the desktop Settings → Scheduled list page from the supplied
  Scheduled tasks reference: one quiet page header, explanatory subtitle,
  prominent search, All / Active / Paused filters, scannable task rows, and
  useful suggestions.
- Repair project selection as product behavior, not only the visual trigger.

### Acceptance criteria

- The default Scheduled surface presents the reference information
  architecture instead of eagerly selecting the first Automation into a
  two-column master/detail frame.
- Search and status filters operate on the current project-owned Automation
  collection; selecting a row opens its existing complete detail/actions, and
  create/edit retain the existing canonical form.
- Three restrained suggestion rows open a prefilled create form without
  persisting until the user submits.
- The visible Project selector contains the complete canonical set of
  OpenCorvus-registered project directories plus projects discovered beside the
  launch directory, deduplicated by path.
- A real isolated page is opened, interacted with, captured, and manually
  reviewed at desktop size. No UI automation test or repeatable visual fixture
  is created, modified, or run.

### Hard constraints

- Preserve all unrelated staged and unstaged Composer/spec changes. Do not
  stash, reset, restore, broadly format, broadly stage, or create a worktree.
- Keep `AutomationService` and the existing project-scoped routes as the sole
  Automation persistence/execution source.
- Reuse Kobalte-backed `SelectControl`, `SegmentedControl`, `SearchField`, and
  the existing Settings/Button/Icon primitives.
- Do not add fallback discovery, a second project catalog, compatibility code,
  a route gate, a UI test, a screenshot baseline, or mobile/tablet scope.
- Do not stop, restart, refresh, or interact with a user's running Overlay.
  Visual review uses only a separately started isolated Vite/backend target.
- Commit subjects use `dsw-33987`; push the current main delivery branch to
  `legacy-remote` without bypassing hooks.

### Read records and sources

- `AGENTS.md`
- `specs/records/2026-07/2026-07-27-scheduled-automation-usability-repair.md`
- `specs/records/2026-07/2026-07-28-scheduled-settings-convergence.md`
- `specs/records/2026-07/2026-07-28-scheduled-real-project-e2e-repair.md`
- supplied `codex-clipboard-442c5de8-302e-49f0-be53-63098a06b994.png`
- `packages/overlay/src/components/settings/ScheduledAutomationsPanel.tsx`
- `packages/overlay/src/styles/surfaces/automations.css`
- `packages/overlay/src/components/ui/{SelectControl,SearchField,SegmentedControl}.tsx`
- `packages/overlay/src/services/{workspace,automations}.ts`
- `packages/opencorvus/src/project/project.ts`
- `packages/opencorvus/src/server/routes/global.ts`
- `packages/opencorvus/test/server/global-project-discovery.test.ts`
- `packages/overlay/test/{scheduled-automations,workspace-discovery-service}.test.ts`

### Whole-repository grep and call-site disposition

| Call site                                  | Current role                                                                                 | Disposition                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Project.discoverFromLaunchDirectory`      | Scans only launch root and direct children with `.opencorvus`                                | Replace its returned collection with one deduplicated selectable catalog that also projects registered worktrees/sandboxes.             |
| `GET /global/projects/discover`            | Sole directory-free project discovery route                                                  | Keep the route identity; update its description and positive contract to the complete selectable catalog.                               |
| Overlay `loadDiscoveredProjects`           | Sole route adapter                                                                           | Keep; it already preserves the server projection.                                                                                       |
| `ScheduledAutomationsPanel.initializeHost` | Loads project options and chooses the active/default project                                 | Keep one initialization owner; consume the repaired catalog and preserve the active project choice.                                     |
| `ScheduledAutomationsPanel.load`           | Eagerly chooses the first Automation                                                         | Preserve explicit preferred selection only so the default state remains the reference list.                                             |
| Scheduled list/detail/form JSX             | Two-column master/detail surface                                                             | Replace the default master/detail frame with list/search/filter/suggestions; retain detail/form content as single-page drill-in states. |
| `automations.css`                          | Owns old split-pane layout and current detail/form styling                                   | Replace old list chrome with reference-parity layout while retaining shared detail/form styling.                                        |
| locale `automations.*`                     | Visible terminology                                                                          | Add exact bilingual subtitle/search/filter/suggestion/back copy and keep locale parity.                                                 |
| `scheduled-automations.test.ts`            | Mixes valid recurrence/service contracts with prohibited UI/source-string and negative tests | Delete the prohibited UI/source-string and negative cases without running them; retain positive non-UI recurrence/service contracts.    |
| existing browser UI tests/fixtures         | Repeatable UI assertions forbidden by current repository policy                              | Do not run or update; no additional scan beyond touched Scheduled paths.                                                                |
| `global-project-discovery.test.ts`         | Mixes positive catalog contracts with negative filesystem/absence assertions                 | Retain and extend only positive catalog results; delete touched negative cases under the current positive-test rule.                    |

### Independent-agent feedback

- The user did not request sub-agents or parallel audit, so no sub-agent is
  started. The main agent owns the implementation, diff review, and live visual
  acceptance.

## Root cause and architecture decision

The Project control is backed by a structurally incomplete data source:
`/global/projects/discover` lists only marker-bearing directories at the server
launch root and one level below. A valid project already registered in the
canonical `ProjectTable` but located elsewhere cannot appear in the selector,
so no frontend primitive change can make it selectable.

The route remains the single project-picker catalog. Its producer returns one
path-deduplicated projection of registered project worktrees/sandboxes and
launch-neighbour discovery. Registered rows provide canonical project names;
otherwise the directory basename is used. No second UI catalog or fallback is
introduced.

The Scheduled panel remains one Settings destination. Its default view becomes
the reference-derived collection surface; row/detail and create/edit are
drill-in views over the same signals and services.

## Implementation plan

1. Repair the server project discovery projection and add a positive route
   regression for registered projects outside the launch root.
2. Recompose the Scheduled default view with subtitle, project/new actions,
   search, status filters, list rows, empty result, and prefilled suggestions.
3. Preserve the full existing detail, run history, actions, and form as
   drill-ins with explicit return navigation.
4. Replace the old split-pane CSS with the reference density, typography,
   whitespace, quiet dividers, and perceptible hover/focus states.
5. Add bilingual copy and remove prohibited UI/negative assertions encountered
   in the touched Scheduled and discovery test files.
6. Run focused positive non-UI tests, typecheck, i18n, Vite build, API/docs, and
   document-health checks.
7. Start an isolated real page, verify project selection plus list/search/filter/
   suggestion/detail/form interactions, capture screenshots, inspect them, and
   iterate until the desktop visual surface matches the reference intent.
8. Re-read the spec and final diff, stage only task-owned paths through an
   isolated current-HEAD index if needed, commit with `dsw-33987`, fetch, and
   push the current main branch to `legacy-remote`.

## Implemented result

- `Project.discoverFromLaunchDirectory()` now produces one path-deduplicated
  catalog with canonical registered worktrees and sandboxes before adding
  marker-bearing launch-root neighbours. The directory-free global route keeps
  its single identity and now accurately describes that complete projection.
- The live selector displayed both the isolated anonymous project and the
  registered `/Users/yangheng/Desktop/opencorvus` project. Opening the mature
  Kobalte Select, choosing `opencorvus`, and reading the visible trigger value
  proved that the project switch completed.
- Scheduled no longer auto-selects the first Automation. Its default Settings
  view now follows the supplied reference structure: title, descriptive copy,
  prominent rounded search, All / Active / Paused filters, quiet task rows,
  divider, and three suggestion rows.
- The project selector and New Automation action remain explicit product
  additions above the reference collection. Search and status filtering read
  the same loaded Automation array; no query override or second store exists.
- Suggestion activation pre-fills the existing create form with the correct
  name, recurrence preset, time, and prompt, while persistence remains owned by
  the unchanged form submission and Automation service.
- Detail, run history, run-now, pause/resume, edit, delete, model, reasoning,
  time-zone, exact-Session navigation, and due-refresh behavior remain in the
  same panel and are reached as drill-in views with an explicit return action.
- The single structured error surface now sits above the list/detail drill-in
  boundary. The first isolated real-project selection exposed that a
  project-config validation failure was being hidden with the detail region;
  the error remains owned by the existing signal but is now visible in every
  panel state.
- The touched Scheduled source-string/UI assertions and touched negative tests
  were deleted. Positive recurrence, route adapter, lifecycle, and project
  catalog contracts remain.

## Verification and visual review

- `bun test packages/opencorvus/test/server/global-project-discovery.test.ts`:
  2 pass / 0 fail.
- `bun test packages/overlay/test/scheduled-automations.test.ts packages/overlay/test/workspace-discovery-service.test.ts`:
  6 pass / 0 fail.
- `bun run --cwd packages/overlay typecheck`: pass.
- `bun run --cwd packages/opencorvus typecheck`: pass.
- `bun run --cwd packages/overlay check:i18n`: pass.
- `bun run --cwd packages/overlay build:vite`: pass.
- A separately started backend on `127.0.0.1:7988` used an isolated
  `OPENCORVUS_HOME` and served the freshly built Overlay at `/ui/`; it did not
  touch the user-running process on port 7878.
- Real-page interaction opened Settings → Scheduled from the visible left-Dock
  launcher, selected the registered `opencorvus` project, exercised search and
  the Active filter, opened the Daily brief suggestion, and verified the
  prefilled name, Weekdays recurrence, `08:00` time, and prompt before returning
  without submission.
- The final 1440 × 768 screenshot was opened and manually inspected. It shows
  the reference-derived whitespace, search/filter hierarchy, quiet divider,
  suggestion rhythm, visible project/new controls, and no obsolete surrounding
  card frame. Browser console warnings/errors: 0. The isolated backend
  separately reported the real project's unavailable `openai/gpt-5.6-sol`
  model while loading its Automation rows; this provided the evidence for
  lifting the structured error state above the drill-in boundary and does not
  affect project selection itself.
- No UI test, browser fixture, repeatable screenshot assertion, or screenshot
  baseline was added, modified, or run.
