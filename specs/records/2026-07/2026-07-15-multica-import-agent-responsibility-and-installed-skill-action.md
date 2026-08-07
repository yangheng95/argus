# Multica import Agent responsibility and installed Skill action

## Recall

### 2026-07-15 supporting-file protocol follow-up

- User requirement: update the built-in `multica-import` Skill to the latest Multica/expert-squad protocol.
- Acceptance: the Skill must explicitly treat `skill.content` plus every safe `skill.files[]` entry as one immutable imported Skill directory, review `preview.skills[].supportingFiles`, preserve paths and contents without flattening or omission, and re-preview after any source closure change. A multi-file Skill is not a blocker by itself.
- Runtime authority: `packages/opencorvus/src/expert-squad/multica-import.ts` already writes `skills/<stable-source-id>/SKILL.md` plus each supporting file, includes the whole source snapshot in `sourceDigest`, validates the generated package with `ExpertSquadRegistry.loadSourcePackage`, and rejects only concrete defects such as unsafe paths, mismatched ownership, invalid frontmatter, or another canonical package violation. This task updates the Agent instructions rather than adding a second importer or changing correct adapter behavior.
- Delivery: update only the canonical Skill source, regenerate `builtin-payload.ts`, and add a dedicated Skill regression without editing the existing broad Skill/import tests. Validate the generated payload text, focused Multica importer supporting-file cases, built-in payload freshness, TypeScript, docs, and diff integrity.
- Hard constraints: no fallback, compatibility, automatic source rewrite, supporting-file flattening, hidden import path, replacement retry, automatic activation, or new Multica tool. `multica_catalog`, `multica_preview`, and `multica_import` remain the entire Multica-specific tool surface.
- Recalled sources: `AGENTS.md`; `specs/README.md`; `specs/current/architecture/04-extensions.md`; this complete record; the historical `2026-07-14-multica-expert-squad-import.md`; `skill-creator`; `opencorvus-expert-squad-creator` and its checklist; current Skill, built-in generator/payload, importer, Orchestrator tools, General projection, and focused tests.
- Whole-repository search: `rg` covered every `multica-import` identity, Skill projection, generated payload call point, supporting-file schema/preview/blocker/write path, import tool, server route, and focused test. No second Multica import Skill or importer exists.
- Parallel boundary: target files are clean and the shared index is empty. Only unrelated untracked dashboard artifacts remain; they are not read, modified, staged, or committed. No sub-Agent is used because this is a small single-source instruction update and the user did not request delegation.

### 2026-07-15 supporting-file follow-up verification

- The dedicated Skill regression passed after the canonical generator refreshed `builtin-payload.ts`; it proves exact canonical/payload equality, the unchanged three-tool surface, explicit `supportingFiles` review, immutable `SKILL.md` plus `skill.files[]` closure semantics, digest invalidation, and `replaced=false` reporting.
- The complete Multica importer suite passed 13/13, including exact supporting-file installation, multi-file portability, unsafe-path rejection, source/mapping drift zero-write behavior, installed-ID exclusion, and no replacement. The broad Skill suite and built-in Skill suite also passed; package TypeScript and formatting pass.
- Final General projection and historical-doc reruns are temporarily blocked by a parallel uncommitted deletion of tracked `packages/opencorvus/src/expert-squad/projected-agent-dispatch.ts` while `packages/opencorvus/src/orchestrator/tools.ts` still imports it. This task does not restore or edit either parallel-owned file; final validation and commit wait for that owner to settle the import/deletion atomically.
- The parallel owner subsequently removed the stale import while retaining its file deletion. General projection passed 2/2, all 11 historical-doc rows passed, package TypeScript passed, and final Prettier plus `git diff --check` passed. No parallel-owned file is included in this follow-up's commit.

### Original request

1. Multica import is Agent-led rather than a fixed programmatic workflow.
2. During import, the Agent autonomously diagnoses and repairs encountered technical problems.
3. This responsibility is declared in the `multica-import` Prompt only; no repair tool, REST mutation API, host workflow, or extra abstraction is introduced.
4. A Skill that is already installed must no longer display the market import/install option.
5. When importing from Multica, an Agent Squad that is already installed in the current project must not be offered or imported again.

### Acceptance criteria

1. The built-in `multica-import` Skill tells the Agent to investigate root causes, repair every in-scope technical problem with its existing capabilities, re-run preview, and continue until import succeeds.
2. The Agent asks the user only when intent, external authority, or an irreversible semantic decision cannot be inferred safely. Validation is never weakened and blockers are never silently discarded.
3. `multica_catalog`, `multica_preview`, and `multica_import` remain the complete Multica-specific tool surface. There is no `multica_repair` tool or source-writing REST path.
4. `/skill/market` reports whether each market source is already installed, using the server's canonical source normalization and installed-source evidence.
5. The Skill Market card retains its non-import actions but does not render the install button when `installed` is true.
6. Focused unit/browser tests cover both installed and uninstalled market entries. A real rendered Skill Market screenshot is inspected after the behavior passes.
7. `multica_catalog` receives the current project directory and excludes Multica Squad candidates whose canonical target manifest ID is already installed there.
8. The Multica-specific import tool and REST contract no longer accept `replace`; a concurrent or direct duplicate import remains an explicit `already exists` rejection with zero replacement.
9. Generic expert-squad folder/ZIP import keeps its explicit replacement contract; this change is limited to Multica import identity.

### Hard constraints

- No fallback, compatibility alias, second source of installed state, UI source guessing, gate, state machine, hidden message, automatic activation, or unrelated Multica source mutation.
- The server remains the sole authority for source normalization and installed status; the Overlay consumes the explicit boolean.
- Expert-squad manifest `id` remains the sole installed Squad identity. Display names, directory labels, source digests, and similar strings are not used to guess duplicates.
- Existing unrelated dirty-worktree changes are user-owned. No reset, stash, new worktree, or destructive recovery may overwrite them.
- Frontend verification uses Playwright through Node, not Bun, and does not restart or interfere with a running OpenCorvus/Overlay process.
- Commit subjects use `dsw-33987`; delivery targets the current primary branch on the legacy remote without bypassing hooks.

### Sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-14-multica-expert-squad-import.md`
- `opencorvus-expert-squad-creator` and `references/open-corvus-expert-squad-checklist.md`
- Current Multica importer, built-in Skill, generated built-in payload, General expert-squad projection, Skill Manager/routes, Overlay extension service/store, Skill Market panel/i18n, and their tests.

### Whole-repository search evidence

- `rg -n --hidden -S "multica-import|multica_import|MulticaExpertSquadImport|/expert-squad/multica" .`
- `rg -n -S "multica_repair|repairSource|MulticaSourceRepair" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07`
- `rg -n -S "skill/installed|skill/market|skill/install|installSkill|loadSkillMarket|skill.market.install_button_title" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`
- `rg -n -S "MarketEntry|BUILTIN_MARKET|normalizeGit|normalizeUrl|managedGitTarget|manifest.*source|source_type" packages/opencorvus/src/skill packages/opencorvus/test/skill packages/overlay/src packages/overlay/test`
- `rg -n -S "skillMarket|market-card|Install Skill|安装技能" packages/overlay/src packages/overlay/test`
- `rg -n -S "MulticaExpertSquadImport.catalog|multica_catalog|/multica/squads|MulticaImportInput|replace|targetSquadID|ExpertSquadRegistry.discover" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`

### Call-point disposition

| Call point                                                      | Disposition                                                                                                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/skill/builtin/multica-import.md`       | Declare autonomous diagnosis, repair, re-preview, and completion responsibility using existing Agent capabilities.                                                          |
| `packages/opencorvus/src/skill/builtin-payload.ts`              | Regenerate from canonical built-in Skill sources; never hand-edit.                                                                                                          |
| `packages/opencorvus/test/skill/skill.test.ts`                  | Pin the Prompt responsibility and absence of a new repair tool requirement.                                                                                                 |
| Multica adapter/tools/General manifest                          | Retain the existing three-tool import surface; no repair mutation endpoint or projected tool.                                                                               |
| `packages/opencorvus/src/skill/manager.ts`                      | Extend the existing market entry contract with authoritative `installed`; compute it from installed source evidence using the same canonical normalization used by install. |
| `packages/opencorvus/src/server/routes/skill.ts`                | Retain the existing `/skill/market` route; its generated schema follows `MarketEntry`.                                                                                      |
| `packages/overlay/src/services/extensions.ts` and app store     | Retain existing loaders/store; no duplicate installed-state store is added.                                                                                                 |
| `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Consume `item.installed` and omit only the install button for installed entries.                                                                                            |
| Overlay i18n                                                    | Retain existing labels; no installed replacement label is needed because the requested action is absent.                                                                    |
| Skill Manager and Overlay browser tests                         | Add installed/uninstalled contract and rendered-action regressions.                                                                                                         |
| `packages/opencorvus/src/expert-squad/multica-import.ts`        | Filter the source catalog by exact installed target IDs for the current project and always import with `replace: false`.                                                    |
| `packages/opencorvus/src/orchestrator/multica-import-tools.ts`  | Bind catalog to `Instance.directory`; remove `replace` from the Multica Agent tool.                                                                                         |
| `packages/opencorvus/src/server/routes/expert-squad.ts`         | Bind `/multica/squads` to `Instance.directory`; remove `replace` from the Multica-only REST input.                                                                          |
| Multica Prompt and generated payload                            | State that installed candidates are absent and must never be replaced through import.                                                                                       |
| Generic `ExpertSquadPackageManager` folder/ZIP surfaces         | Retain their existing explicit `replace` contract unchanged.                                                                                                                |
| Multica adapter, tool, and server tests                         | Cover catalog exclusion, no replace field, and duplicate zero-replacement rejection.                                                                                        |

### Independent-agent feedback

No sub-agent was used. The user did not request delegation, and the active collaboration constraint prohibits spawning sub-agents unless explicitly requested. The primary Agent owns the required second review.

## Design

The change has three direct parts. First, the existing Prompt assigns the Agent responsibility to diagnose, repair, re-preview, and complete the import with its already projected capabilities. Second, `SkillManager.market()` attaches an `installed` boolean by comparing canonical market-source identities with the canonical sources returned by installed discovery, and the Overlay renders the existing install button only when the market entry is installable and not installed. Third, the Multica catalog maps every source Squad UUID to its canonical target manifest ID and removes exact IDs already returned by project package discovery. The Multica-only import contract has no replacement control and always delegates with `replace: false`, so a race or direct duplicate request fails instead of overwriting.

## Verification plan

1. Prompt and generated-payload tests.
2. Skill Manager tests for installed and uninstalled Git/URL entries.
3. Overlay focused source/interaction tests.
4. Node-launched browser test with a real Skill Market screenshot, followed by visual inspection.
5. Historical-doc links, document health, relevant typechecks, and `git diff --check`.
6. Independent final diff review, then a scoped commit and `legacy-remote` push without including unrelated dirty-worktree changes.
7. Multica adapter/tool/server tests prove exact-ID catalog exclusion, absent `replace`, and duplicate rejection without replacement.

## Verification results

- Passed `bun test packages/opencorvus/test/skill/manager.test.ts` (15 tests).
- Passed `bun test packages/opencorvus/test/skill/skill.test.ts` (28 tests).
- Passed `bun test packages/opencorvus/test/skill/builtin-skills.test.ts` (5 tests), including generated built-in payload freshness.
- Passed the focused `GET /skill/market` server route test (1 test, 5 assertions).
- Passed both `packages/opencorvus` and `packages/overlay` TypeScript checks.
- Passed the Node-launched, headed browser test `skill-market-installed-action-browser.test.ts`. Visual review of `.scratch/skill-market-installed-action-hidden.png` confirmed that the installed card retains `Open Site` but has no `Install Skill`, while the uninstalled card still has `Install Skill`.
- Passed `git diff --check`; source/test searches contain no `multica_repair`, `repairSource`, or `MulticaSourceRepair` implementation.
- Passed all 13 Multica adapter/tool tests, including exact manifest-ID catalog exclusion, duplicate import rejection, and proof that the installed manifest remains unchanged.
- Passed the isolated Multica server route case (11 assertions), including current-project catalog ownership and rejection of the removed `replace` request field.
- Passed the focused Multica Prompt test (8 assertions), the `packages/opencorvus` TypeScript check, `api:routes-check`, generated API docs check, and all 20 historical-doc link tests.
- Regenerated the built-in Skill payload, OpenAPI document, JavaScript SDK client, and English/Chinese API reference from their canonical sources.
- The document-health suite has 52 passes and one unrelated concurrent failure: `specs/records/2026-07/README.md` links the untracked `2026-07-15-current-wip-batched-push.md`. That concurrent record/index surface is not part of this task and was not staged here.
