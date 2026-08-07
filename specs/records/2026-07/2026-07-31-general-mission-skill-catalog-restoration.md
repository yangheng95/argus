# General Mission Skill Catalog Restoration

## Recall

### User input

- `现在不支持@mission了，这是个bug`

### Acceptance criteria

- The public `@mission("<exact-name>")` contract remains operational after removal of the domain-specific `mirror-prism-cluster` Mission Skill.
- The built-in catalog exposes one explicit `general` Mission Skill that coordinates an operator-defined Mission through the native Mission protocol without binding a domain workflow or Expert Squad.
- Selecting `@mission("general")` routes through the existing Mission wake path and still requires a visible `mission_skill` tool load; no bare keyword classifier, guessed Skill, alias, fallback, or hidden active state is introduced.
- Project and user-global Mission Skills continue to merge through the same strict catalog and duplicate-identity rules.
- A real page exposes `general` as a Mission Skill, inserts the exact directive, and is personally inspected from a current screenshot.
- All parallel worktree changes remain untouched and outside this task's commit.

### Hard constraints

- Do not restore, rename, alias, or imitate `mirror-prism-cluster`.
- Keep `@mission` as the existing strict exact-name Mission Skill syntax; do not overload it as a second bare Mission-routing command.
- Keep `@squad` as the independent exact Expert Squad reference.
- Do not add, modify, update, or run UI automation tests. Visual acceptance uses a real page, interaction, screenshot, and personal inspection only.
- Add positive non-UI catalog, payload, runtime, and route contracts for the current built-in identity.
- Commit subjects use the required `dsw-33987` prefix and push only to `myhexin/v0.0.27beta`.

### Existing sources read

- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-23-mission-skill-orchestration-surface.md`
- `specs/records/2026-07/2026-07-25-mission-directive-syntax.md`
- `specs/records/2026-07/2026-07-29-global-composer-mission-reference-routing.md`
- `specs/records/2026-07/2026-07-31-remove-mirror-prism-cluster-mission-skill.md`
- `packages/opencorvus/src/prompt/core/mission-core.txt`
- Browser skill instructions for real-page acceptance.

### Whole-repository search

| Owner or caller                                                      | Evidence                                                                                                                                                        | Decision                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/mission-skill/builtin-payload.ts`           | The previous deletion leaves the built-in payload empty.                                                                                                        | Add one authored `general` package and regenerate the single payload.                                         |
| `MissionSkillCatalog`                                                | Strictly merges built-in, user-global, and project definitions; global Composer summaries use the same parser.                                                  | Preserve unchanged and prove the current built-in catalog entry positively.                                   |
| `composer-mention.ts`                                                | `@mission` parsing, exact-name validation, atomic presentation, and directive extraction remain present. Entity options come only from `catalog.missionSkills`. | Do not patch the parser or weaken validation. Restore a real catalog entity.                                  |
| `composer-expert-squad-catalog.ts` and `/global/composer-references` | Correctly project Mission Skill summaries; an empty source produces an empty Composer group.                                                                    | Preserve the projection and add a positive global route assertion for `general`.                              |
| `composer-submit-route.ts` and `main.tsx`                            | Any resolved Mission Skill name already selects the canonical Mission wake route before Code/Work persistence.                                                  | Preserve unchanged.                                                                                           |
| `mission-core.txt` and `MissionSkillRuntime`                         | Exact visible names must be loaded through the real `mission_skill` tool; no directive means no Skill load.                                                     | Keep this authority boundary. The new contract explicitly adds no domain workflow.                            |
| `ComposerMentionMenu` and `ComposerReferenceSelector`                | Both render the projected Mission Skill entity through mature listbox/popover primitives.                                                                       | No UI source change is necessary; validate the restored data on a real page.                                  |
| User-global/project Mission Skill roots                              | No current local author package exists, so deletion of the sole built-in item makes the real catalog empty.                                                     | Keep external extension points; do not depend on an operator-local installation for baseline product support. |

### Causal chain

Observable symptom: typing `@mission` yields no selectable Mission Skill and a manually typed exact directive cannot pass strict catalog validation.

Direct trigger: the previous deletion removed the only built-in Mission Skill, so both global and project-aware Composer catalogs currently project zero Mission Skill entities.

Deep cause: the deletion correctly removed the Prism-specific contract but failed to preserve the product-level invariant that the shipped exact-name `@mission` namespace has at least one domain-neutral, explicitly selectable contract. The parser and wake route were never the failure.

Why the previous path did not root-fix it: verification proved the empty catalog and removed identity were internally consistent, but it replaced the positive user-visible `@mission` acceptance with empty-array contracts. It verified deletion, not preservation of the independent Mission capability.

### Independent agent feedback

- No independent agent was requested by the user, so none was started.

## Design

Add `packages/opencorvus/src/mission-skill/builtin/general/` as the sole built-in Mission Skill. Its exact identity is `general`; its contract says only to apply the native Mission protocol to the operator's stated objective, preserve exact intent, select fixed-profile Tasks from the current Expert Squad catalog, and reconcile terminal evidence. It declares no workflow ID, package ID, domain steps, automatic selection, compatibility alias, or hidden state.

This is not a fallback: Mission loads it only after the operator visibly selects `@mission("general")`. Requests without that exact directive continue to use native Mission behavior without calling `mission_skill`.

## Implementation and verification plan

1. Add the self-contained `general` Mission Skill author package and regenerate `builtin-payload.ts`.
2. Update current Mission Skill architecture with the shipped general contract.
3. Update positive generator, catalog, runtime, Mission Skill route, and global Composer-reference contracts.
4. Run focused non-UI tests, generated payload checks, typecheck, API route/docs checks, document health, and diff/reference audits.
5. Start an isolated real Overlay page, open the Composer `@mission` result, select `general`, inspect the inserted exact directive, capture a current screenshot, and personally review it.
6. Stage only task-owned paths, commit with `dsw-33987`, and push the current main branch to `myhexin` after reconciling remote changes.

## Verification evidence

- Focused non-UI contracts: 16 passed, 0 failed across payload generation, catalog, runtime, Mission Skill routes, and global Composer references.
- Real Overlay acceptance used an isolated backend on port `17891` and the actual Vite page. The Composer showed `general` under the `Mission Skill` group after typing `@mission`; selecting it inserted the exact atomic directive `@mission("general")`.
- The current screenshot was personally inspected: the reference token is visible in the active Composer, the `Skills & squads` count is `1`, and the sidebar reports the isolated backend as Online. Evidence: `specs/artifacts/2026-07-31-general-mission-skill-catalog-restoration.png`.
