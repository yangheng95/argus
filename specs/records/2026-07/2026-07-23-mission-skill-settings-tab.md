# Mission Skill Settings Tab

## Recall

### User request

- Add a dedicated Mission Skill tab to Settings.
- Include related Mission Skill functions instead of adding a label-only placeholder.
- Inspect existing Settings surfaces and keep the same design language.

### Acceptance criteria

- Settings navigation exposes one `Mission Skill` entry derived from the existing `CONFIG_SECTIONS` source of truth.
- The tab lists only Mission Skills visible to the native Mission agent and preserves ordinary Skill separation.
- Users can search and filter Mission Skills, inspect source and required tools, copy the exact `@mission-skill(<JSON string name>)` directive, refresh discovery, and open the canonical project or user-global Mission Skill directory.
- Composer keeps its existing strict summary-only catalog; local paths are available only through a dedicated Settings contract.
- English and Simplified Chinese labels are complete.
- Backend, overlay contract, and real browser interaction tests cover the feature.
- Desktop light and dark screenshots are visually inspected and corrected before delivery.

### Hard constraints

- Reuse the existing Mission Skill catalog kernel and canonical roots; do not add a second scanner.
- Reuse `ConfigDialogHost`, `CONFIG_SECTIONS`, Kobalte-backed Tabs, and shared Settings/Button/Search/Badge primitives.
- Do not add an install/uninstall protocol without an existing package lifecycle contract.
- Do not add fallback routing, hidden messages, workflow state, or Chat access to Mission Skills.
- Do not expose absolute Mission Skill locations through `/mission-skill/catalog`.
- Do not restart or refresh the user's running OpenCorvus or overlay process; visual verification uses an isolated test server.
- Preserve unrelated working-tree edits and stage only files and hunks owned by this task.
- Keep the existing Mission wake attachment OpenAPI regression aligned with its real strict two-variant union when regeneration exposes the stale flattened assertion.

### Existing material read

- `specs/records/2026-07/2026-07-23-mission-skill-orchestration-surface.md`
- `specs/records/2026-07/2026-07-23-mission-skill-orchestration-implementation.md`
- `packages/overlay/src/components/ConfigDialogHost.tsx`
- `packages/overlay/src/components/settings/layout.tsx`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/components/settings/SkillMarketPanel.tsx`
- `packages/overlay/src/styles/surfaces/settings.css`
- `packages/overlay/src/store/dialog.ts`
- `packages/opencorvus/src/mission-skill/catalog.ts`
- `packages/opencorvus/src/mission-skill/roots.ts`
- `packages/opencorvus/src/server/routes/mission-skill.ts`

The Kobalte Tabs documentation was checked for the current vertical-tab keyboard and focus semantics already supplied by the project's shared Tabs primitive.

### Full-repository grep inventory

| Surface                        | Call sites and decision                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings section identity      | `packages/overlay/src/store/dialog.ts` remains the only section ID, label, and order source; add `mission-skill` there.                                                                |
| Settings navigation/rendering  | `packages/overlay/src/components/ConfigDialogHost.tsx` owns icon mapping, grouped navigation, panel body ID, and panel dispatch; add the tab to Integrations next to ordinary Skills.  |
| Derived Settings consumers     | `config-dialog-control.ts`, `Titlebar.tsx`, and `CommandPalette.tsx` already derive from `CONFIG_SECTIONS`; no parallel lists will be added.                                           |
| Explicit Settings tests        | `config-dialog-resizer.test.ts`, command-palette tests, and browser Settings tests are reviewed and updated where they enumerate tabs.                                                 |
| Composer Mission Skill catalog | `packages/overlay/src/services/mission-skill.ts`, `composer-expert-squad-catalog.ts`, `main.tsx`, mention tests, and `/mission-skill/catalog` keep the existing summary-only response. |
| Mission Skill discovery        | `MissionSkillCatalog` and `MissionSkillRoots` remain the only scanner and root source. A Settings projection classifies already-discovered entries; it does not rescan.                |
| Backend route and SDK          | `packages/opencorvus/src/server/routes/mission-skill.ts`, route tests, generated OpenAPI, TypeScript SDK, and API reference docs gain `/mission-skill/settings`.                       |
| Visual surface                 | `settings.css` receives only Mission Skill layout classes; controls and typography continue to come from shared primitives.                                                            |

### Independent review feedback

The earlier Mission Skill architecture was independently reviewed before implementation. Its retained constraint is that Chat and Composer must not receive Mission Skill contents or local locations. This follow-up therefore introduces a Settings-only projection instead of widening the Composer catalog.

The focused implementation review found four issues, all incorporated before delivery:

- Invocation rendering now uses `JSON.stringify(name)`, matching the Composer parser for quotes and other escaped characters.
- Equal or nested global/project roots are rejected as ambiguous configuration instead of receiving priority-based ownership.
- Coalesced catalog and Settings requests share the same wrapped success or error promise; concurrent different scopes remain independent.
- Browser coverage now exercises Open source, both root actions, clipboard rejection, native-open rejection, Settings load failure and recovery, and a project-sourced detail in both theme screenshots.

The second implementation review found two remaining consistency gaps. Directory preparation now selects its target only after the same overlap validation used by discovery, and in-flight ownership is a per-request-path map rather than one endpoint-wide slot. Route tests cover equal and nested POST rejection without filesystem writes; service tests cover interleaved project-session-project requests for both catalog and Settings.

## Current-state conclusion

The Settings shell already has the correct reusable interaction model: a vertical Kobalte tab list, grouped navigation, shared panel headers, standard toolbars, surfaces, badges, rows, buttons, and search fields. The Mission Skill tab should look native by composing those primitives, not by cloning the denser Expert Squad package manager.

The current backend has enough information to support this surface but intentionally strips source and location from its Composer response. Widening that response would violate the existing privacy and routing boundary. A dedicated Settings response is therefore the narrowest coherent design.

## Contract

`GET /mission-skill/settings` returns:

```ts
{
  roots: {
    global: string
    project: string
  }
  mission_skills: Array<{
    name: string
    description: string
    required_tools: string[]
    source: "built_in" | "global" | "project"
    location: string | null
  }>
}
```

- The route uses the same optional active-project `sessionID` validation as the catalog route.
- Each Settings request performs the same explicit catalog refresh used by Composer discovery.
- `location` is `null` for built-ins because their runtime materialization cache is not an editable source directory.
- Global and project classification comes from exact canonical root containment.
- Canonical global and project roots must be disjoint; equality or containment in either direction is a strict error.
- Duplicate IDs remain a strict catalog error; the Settings projection cannot resolve or hide conflicts.

`POST /mission-skill/directory` accepts an explicit `global` or `project` source, creates only that canonical directory, and returns its path. This makes the user-initiated Open action reliable even before the first custom Mission Skill exists; no directory is created during read-only discovery.

## Settings information architecture

The panel has three regions:

1. A shared panel header that explains the Mission-only boundary and provides Refresh.
2. A compact toolbar with search, source filter, result count, and canonical folder actions.
3. A master-detail surface:
   - the left list shows name, source badge, description, and required-tool count;
   - the right detail shows description, source, editable location where applicable, required tools, and the exact invocation directive;
   - Copy directive and Open source are contextual actions on the selected item.

The source filter values are `all`, `built_in`, `project`, and `global`. Search is local and matches visible name, description, source label, and required tools. It must not generate server requests while typing.

Empty states distinguish scope unavailable, catalog loading failure, no installed Mission Skills, and no search results.

## Implementation map

| File                                                             | Change                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/mission-skill/roots.ts`                 | Add strict source classification and named canonical roots.                                                      |
| `packages/opencorvus/src/mission-skill/catalog.ts`               | Add strict Settings schemas and projection over the existing catalog.                                            |
| `packages/opencorvus/src/server/routes/mission-skill.ts`         | Add `GET /mission-skill/settings` and the explicit directory preparation action.                                 |
| Mission Skill backend tests                                      | Cover source classification, roots, built-in null location, route output, and catalog separation.                |
| `packages/overlay/src/store/dialog.ts`                           | Add the single Settings section identity.                                                                        |
| `packages/overlay/src/components/ConfigDialogHost.tsx`           | Add icon, navigation placement, body mapping, and panel dispatch.                                                |
| `packages/overlay/src/components/settings/MissionSkillPanel.tsx` | Implement the Settings surface with shared primitives.                                                           |
| `packages/overlay/src/services/mission-skill.ts`                 | Extend the existing service with coalesced Settings loading and explicit directory preparation.                  |
| overlay i18n and Settings CSS                                    | Add complete copy and a desktop master-detail layout using theme tokens.                                         |
| SDK/docs outputs                                                 | Regenerate OpenAPI, client types, route docs, and API docs.                                                      |
| overlay tests                                                    | Cover navigation derivation, contract isolation, interaction, keyboard/focus, request behavior, and screenshots. |

## Verification

- Targeted Mission Skill backend tests.
- Targeted Overlay unit and contract tests.
- Overlay typecheck and production build.
- Generated SDK and API reference checks.
- Node-started Playwright browser test against an isolated overlay server.
- Desktop light and dark screenshots inspected at original resolution.
- Required spec index and document-health tests.
- Final diff review, focused independent review, commit with `dsw-33987`, and push to `myhexin`.
