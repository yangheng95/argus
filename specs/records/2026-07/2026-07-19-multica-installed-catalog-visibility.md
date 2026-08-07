# Multica installed catalog visibility

Status: Implemented and verified on 2026-07-19.

## Recall

### Original user request

> multica中有5个小队 但导入的时候只有两个

### Observed evidence and root cause

- A real authenticated read-only request to the configured Multica `/api/squads` endpoint returns five Squads.
- The same process can discover three exact canonical target manifest IDs in the combined user-global/current-project `ExpertSquadRegistry`; `MulticaExpertSquadImport.catalog()` removes those rows before returning its result, leaving two.
- The five source identities are not inferred from names: each exact source UUID maps deterministically to `multica-<uuid-without-hyphens>`, and the three omitted target IDs exactly match Registry entries.
- The direct trigger is therefore the installed-ID `filter()` in `catalog()`. The deeper contract problem is that one endpoint is being used both as the complete Multica source catalog and as the set of currently installable rows, so installed entries disappear without visible evidence.
- The earlier member-roster repair was correct but did not address this separate catalog-visibility problem. It fetched complete rosters only after the installed-ID filter and preserved the older silent-exclusion contract.

### Acceptance criteria

1. The canonical Multica catalog returns all five source Squads in source order and attaches authoritative `installed: boolean` evidence derived from the combined Registry by exact manifest ID.
2. Every catalog entry, installed or not, carries the complete official `members` roster; neither Mission nor an import Task reconstructs omitted source rows.
3. The Mission presents every catalog row in its one native multi-select question. Installed rows remain visible, are marked installed in their description, and are disabled through the canonical Question option contract; uninstalled rows remain selectable.
4. Selecting/importing an already installed canonical identity remains impossible through the normal UI and still fails without replacement through direct/racing tool calls. No replace, update, activation, uninstall, or compatibility path is added.
5. The built-in `multica-import` Skill and the General Orchestrator tool consume `installed` from the catalog, never infer it from names or local UI state, and choose only rows with `installed: false`.
6. Focused tests prove the complete catalog, installed/uninstalled flags, full rosters, disabled Question option transport/rendering, and unchanged duplicate-import rejection.
7. A real authenticated read-only probe reports source/catalog counts of `5/5` with installed counts `3/3`; a Node-launched headed browser screenshot shows five rows, three visibly disabled and two selectable.
8. OpenAPI, JavaScript Software Development Kit types, generated built-in Skill payload, current architecture, indexes, document health, typechecks, and route/i18n checks remain synchronized.

### Hard constraints

- `expert-squad.jsonc` manifest `id` remains the only installed identity and `prompt_profile.active` remains the only active Squad source.
- `multica_catalog -> multica_preview -> multica_import` remains the complete Multica tool surface. The adapter and generic Manager/Registry remain the only package write path.
- Imported packages remain user-global, inactive, atomic, and non-replacing. Installed rows are visible catalog evidence, not permission to overwrite them.
- `Question`, `InteractionCard`, and the existing Kobalte-backed `Checkbox`/native `Radio` primitives remain the sole question interaction surface; no Multica-specific dialog or selection store is created.
- Personal access tokens remain server-side and are never printed, persisted, or exposed in tool/UI evidence.
- No running OpenCorvus/Overlay process is restarted, refreshed, stopped, or used as a mutable test target. Browser acceptance uses Node, not Bun.
- No worktree or sub-agent is created.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-15-multica-import-agent-responsibility-and-installed-skill-action.md`
- `specs/records/2026-07/2026-07-15-multica-mission-multi-squad-parallel-import.md`
- `specs/records/2026-07/2026-07-19-multica-complete-catalog-roster-repair.md`
- Current Multica adapter, Orchestrator and panel tools, route, built-in Skill, Mission launcher copy, Question schema/runtime, InteractionCard and canonical selection primitives, generated contracts, and focused tests.

### Whole-repository search evidence

`rg` covered every `MulticaSquadCatalogSchema`, `MulticaExpertSquadImport.catalog`, `multica_catalog`, installed-catalog description, `Question.Option`/`QuestionOption`, `InteractionQuestion`, Mission launcher copy, complete-member path, duplicate import assertion, generated OpenAPI/SDK type, architecture statement, and focused browser fixture.

| Call point                          | Disposition                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `MulticaSquadCatalogEntrySchema`    | Add required authoritative `installed`; retain complete `members`.                                                                     |
| `MulticaExpertSquadImport.catalog`  | Replace installed-ID filtering with complete source mapping plus exact Registry membership evidence.                                   |
| `loadSquadMembers`                  | Retain as the single complete-roster owner and invoke it for every catalog row.                                                        |
| General `multica_catalog` tool      | Return `installed` and describe the complete catalog rather than only uninstalled rows.                                                |
| Mission `panel.multica_catalog`     | Retain direct delegation to the canonical catalog; no UI-side request path.                                                            |
| `Question.Option`                   | Add optional `disabled` selection semantics as the generic native question contract.                                                   |
| `InteractionCard`                   | Forward `option.disabled` to existing Radio/Checkbox primitives; do not create a new control.                                          |
| Mission launcher copy               | Ask with all rows, set installed rows `disabled: true`, and create Tasks only for selected uninstalled UUIDs.                          |
| Built-in `multica-import` Skill     | Filter choices by returned `installed`, while retaining duplicate-race rejection and no replacement.                                   |
| REST/OpenAPI/SDK                    | Retain the route and regenerate catalog plus Question option schemas.                                                                  |
| Backend/Skill/Overlay/browser tests | Replace silent-exclusion expectations with complete visible catalog/status/disabled regressions and retain duplicate rejection.        |
| Architecture and prior record       | Update current architecture; preserve prior records as historical facts and record this later correction instead of rewriting history. |
| API document renderer               | Skip an identical write before opening the tracked output for truncation; retain one strict write path for changed content.              |

### Independent agent feedback

No sub-agent is used because the user did not request delegation and the active collaboration instruction prohibits unsolicited spawning. The primary Agent owns the required second review.

## Implementation plan

1. Add failing regressions for installed rows remaining in the complete catalog, catalog tool status, disabled Question option schema, and five-row Mission rendering.
2. Replace the catalog filter with exact installed status projection; update tool, Skill, Mission copy, Question/InteractionCard, and focused tests.
3. Regenerate built-in payload, OpenAPI, JavaScript Software Development Kit and API docs; update current architecture and indexes.
4. Run focused backend/Overlay suites, document-health checks, generators, typechecks, route/i18n checks, and diff review.
5. Run a real authenticated read-only `5/5` source-to-catalog probe, then a Node-launched headed browser acceptance and inspect the task-scoped screenshots.
6. Fetch/merge the latest git-cc delivery branch, rerun affected acceptance, commit with `dsw-33987`, push `v0.0.10beta`, and confirm local/remote pointers agree.

## Verification ledger

- Regression-first run failed at all intended old-contract boundaries: catalog rows had no `installed`, installed identities produced an empty catalog, the General tool omitted status, `Question.Option` stripped `disabled`, and Mission/Skill text still described a filtered catalog.
- `bun test packages/opencorvus/test/expert-squad/multica-import.test.ts packages/opencorvus/test/question/question.test.ts packages/opencorvus/test/skill/multica-import-skill.test.ts packages/opencorvus/test/skill/skill.test.ts packages/overlay/test/multica-import-surface.test.ts` passed 67 tests with 315 assertions after implementation.
- A real authenticated read-only probe against the configured Multica source returned `sourceCount=5`, `catalogCount=5`, `installedCount=3`, and `selectableCount=2`. All five rows carried complete rosters; the three exact Registry matches remained visible with `installed: true`.
- `node test/browser-runner.mjs test/browser/multica-import-browser.test.ts` from `packages/overlay` passed in a headed browser after building 2,648 modules. The fixture renders five exact UUID rows, verifies the first three native checkbox inputs are disabled and the last two accept pointer/keyboard selection, and keeps the right Dock/Mission continuity checks.
- The first updated browser run intentionally attempted an automation click on a disabled label and timed out because Playwright correctly found it unavailable. The fixture was corrected to assert the native disabled property and initial unchecked state without attempting an invalid click; no product workaround or alternate interaction path was added.
- The fresh `.scratch/multica-squad-multi-select.png` was personally inspected. All five rows are visible; installed rows use the canonical low-emphasis disabled treatment and explicit `Installed` description, available rows retain normal focus/selected chrome, and no content is clipped or overlaps.
- The isolated expert-squad and Question route batch passed four tests with 57 assertions, including the expert-squad route wrapper's 48 assertions. The canonical panel suite passed 14 tests with 36 assertions when run alone.
- One earlier parallel test batch caused three unrelated `panel.test.ts` temporary Git setup operations to fail without Git output; immediate isolated rerun passed all 14 cases, proving the failure was concurrent test-process interference rather than a product regression.
- Tool schema snapshot, panel capability, built-in Skill freshness, and the non-panel tool cases passed 12 focused tests; the schema snapshot includes the generic disabled Question option.
- `bun script/generate.ts` regenerated the built-in Skill payload, OpenAPI, JavaScript Software Development Kit and English/Chinese API references. Generated catalog types require `installed: boolean`; generated Question options expose optional `disabled`.
- Root `bun run typecheck` passed all nine applicable package tasks. `bun run api:routes-check`, `bun run docs:check`, and `bun run overlay:i18n-check` passed.
- Historical links, document health, and product-document single-source checks passed 87 tests with 1,430 assertions after the new record and indexes were staged.
- A later full generator rerun exposed repeatable Windows `EUNKNOWN` while truncating the already-current English API document. File attributes and access-control lists were writable, Restart Manager reported no locking process, and both Node and Bun could open the file with `r+`. The renderer now leaves byte-identical output untouched and still performs the same strict write for changed content; a fixed-mtime behavior regression proves both branches without retry or fallback.
- The renderer behavior regression passed, and the original full `bun script/generate.ts` command subsequently completed successfully.
- The combined renderer/OpenAPI tool test run briefly terminated the existing CLI-generation child with exit 143 under load; immediate isolated rerun of `routes-check-openapi.test.ts` passed all 10 cases, including byte-identical CLI/direct generation.
- The latest two git-cc delivery commits were merged without conflicts. The combined tree reran the full generator and headed Multica browser acceptance successfully; the post-merge screenshot retained all five rows, three disabled installed states, two selectable states, and clean geometry.
- The post-merge Multica/Question/Skill/renderer batch passed every task-scoped case. Two unrelated generic Skill directory tests hit Windows process-supervisor startup failures only in the long combined run and then each passed in isolated reruns; this evidence is not represented as a full generic Skill-suite pass.
- Final complete call-point grep contains no active silent-exclusion wording, `member_preview` remains confined to the upstream schema/normalization boundary, `git diff --check` passed, the worktree is clean, and final diff review found no second catalog, replacement path, custom dialog, or UI-side Multica request.
