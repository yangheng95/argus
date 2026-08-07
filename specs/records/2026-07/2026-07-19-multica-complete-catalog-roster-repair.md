# Multica complete catalog roster repair

Status: Implemented and verified on 2026-07-19.

## Recall

### Original user request

> multica导入小队功能没有实现了；看下代码，修复下

### Observed evidence and root cause

- The production `~/.multica/config.json` parses successfully and the real authenticated catalog currently returns five not-yet-installed Squads.
- A read-only real-source probe could build strict previews for the candidates whose catalog roster was complete. For two larger Squads, the `/api/squads` response exposed only the first three `member_preview` rows while `/api/squads/<id>/members` contained more Agents.
- `multica-import` instructs the Agent to build `agent_goal_concurrency` and `virtual_workflows` from catalog `member_preview` before calling `multica_preview`.
- `MulticaExpertSquadImport.preview()` correctly validates the mapping against the complete detail graph and rejected both larger Squads with `OpenCorvus mapping is missing agent_goal_concurrency for Multica agent <uuid>`.
- The user-visible symptom is therefore a circular data contract: catalog omits identities that strict preview requires the caller to map. Existing tests pass because their default two-Agent fixture never exceeds the source preview cap.

### Acceptance criteria

1. The OpenCorvus Multica catalog returns a normalized, complete `members` roster for every not-yet-installed candidate by reading the official per-Squad members endpoint; it does not expose the upstream truncated `member_preview` as mapping evidence.
2. Both Mission `panel.multica_catalog` and the General Orchestrator `multica_catalog` receive every exact Agent UUID needed to construct the strict mapping before preview.
3. `multica_preview` and `multica_import` keep their current complete-mapping, digest, blocker, no-replacement, no-activation, and atomic Manager/Registry contracts. No validation is weakened.
4. No fourth Multica tool, compatibility field, fallback source, UI-side Multica request path, host workflow, automatic mapping, or second catalog is added.
5. A regression fixture with more members than the upstream preview cap proves catalog normalization, authenticated members acquisition, mapping construction solely from returned catalog `members`, blocker-free preview, and import.
6. The Mission launcher prompt follows the generic Mission first-wake state/contract protocol before catalog acquisition and names `members` as complete mapping evidence; English and Chinese remain equivalent.
7. Generated OpenAPI and JavaScript Software Development Kit contracts, current architecture, indexes, focused tests, typechecks, and document-health checks are synchronized.

### Hard constraints

- `expert-squad.jsonc` manifest `id` remains the only Squad identity and `prompt_profile.active` remains the only active selection source.
- The existing `multica_catalog -> multica_preview -> multica_import` tool surface remains complete.
- Multica personal access tokens stay server-side and must not appear in tool, Overlay, test, or diagnostic output.
- Imported packages remain user-global, inactive, non-replacing packages installed only through `ExpertSquadPackageManager` and discovered only through `ExpertSquadRegistry`.
- No running OpenCorvus/Overlay process is restarted, refreshed, stopped, or reused as a mutable test target.
- No worktree is created. No sub-agent is used because the user did not request delegation.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/{2026-07-14-multica-expert-squad-import,2026-07-15-multica-mission-multi-squad-parallel-import,2026-07-15-multica-import-agent-responsibility-and-installed-skill-action,2026-07-17-multica-global-expert-squad-storage}.md`
- Multica adapter, tools, panel action, routes, General projection, built-in Skill, launcher, translations, focused tests, and generated API/SDK contracts.

### Whole-repository search evidence

`rg` covered every `MulticaSquadCatalogSchema`, `MulticaExpertSquadImport.catalog`, `multica_catalog`, `member_preview`, `loadSnapshot`, `/api/squads`, and `/api/squads/<id>/members` call point across production, tests, Overlay, SDK, current architecture, and July records.

| Call point                         | Disposition                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MulticaSquadSchema`               | Retain as the strict upstream `/api/squads` and detail response schema, including source-owned truncated `member_preview`.                                        |
| `MulticaSquadCatalogSchema`        | Replace the upstream-array alias with the normalized OpenCorvus catalog entry: Squad declaration plus complete `members`, with no compatibility `member_preview`. |
| `loadSnapshot`                     | Reuse one members-endpoint helper; keep full agent/Skill/MCP acquisition and strict preview validation unchanged.                                                 |
| `MulticaExpertSquadImport.catalog` | Filter installed identities, then fetch the official complete roster for each remaining Squad and return the normalized schema.                                   |
| Mission `panel.multica_catalog`    | Retain the direct call to the single catalog owner; it automatically receives normalized complete entries.                                                        |
| Orchestrator `multica_catalog`     | Replace its compact `member_preview` output with compact complete `members`.                                                                                      |
| Built-in `multica-import` Skill    | Build the mapping from complete catalog `members`; keep preview/import procedure and tool set unchanged; regenerate the generated built-in payload.               |
| Overlay launcher copy              | Align first-wake ordering with Mission state/contract rules and pass complete `members` evidence to each selected Task.                                           |
| REST route/OpenAPI/SDK             | Keep the same route and operation; regenerate the response shape from the replaced catalog schema.                                                                |
| Browser fixture                    | Add real question option `value` fields and keep it explicitly UI-only; do not claim a mocked Mission/Multica end-to-end run.                                     |

## Implementation plan

1. Add the over-preview-cap regression first and prove the current circular mapping failure.
2. Separate upstream Squad schema from normalized catalog schema, reuse the members acquisition helper, and update both Agent-facing catalog projections.
3. Update the canonical Skill, generated payload, Mission launcher copy, browser fixture, current architecture, and generated API/SDK artifacts.
4. Run focused adapter/tool/panel/Overlay tests, package typechecks, generators and document-health tests.
5. Use the Node-launched headed browser fixture for the current launcher/question screenshot, inspect it, run a fresh real-source read-only catalog-to-preview probe for all candidates, then perform a separate final diff review.

## Verification ledger

- Regression-first proof: the new over-preview-cap fixture initially failed because `catalogEntry.members` was absent while the source exposed three preview rows and four official members.
- `bun test packages/opencorvus/test/expert-squad/multica-import.test.ts packages/opencorvus/test/skill/multica-import-skill.test.ts` — 21 passed. This includes the four-member catalog-to-preview-to-import chain and wrong-Squad member identity rejection.
- Real authenticated read-only Multica probe with an isolated `OPENCORVUS_HOME` — five catalog candidates; all five built mappings solely from normalized `members` and entered strict preview. Agent counts were `1, 1, 1, 5, 5`; blocker counts were `3, 2, 0, 0, 0`. The two five-Agent Squads that previously failed for missing concurrency mapping now preview with zero blockers.
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts` — route isolation wrapper passed with 48 assertions, covering catalog, preview, import, project ownership and strict bodies.
- Skill/projection/panel checks — 29 Skill/projection tests, 34 panel capability/actor tests, and both focused Mission Multica panel tests passed.
- `bun test packages/overlay/test/multica-import-surface.test.ts` — four passed, including first-wake ordering and complete-roster copy in both locales.
- `node test/browser-runner.mjs test/browser/multica-import-browser.test.ts` from `packages/overlay` — one headed browser acceptance passed. The production-shaped fixture verifies failed-wake settlement, exact UUID option values, pointer selection, keyboard focus/Space selection, right-Dock continuity, and no UI-side Multica API path. Fresh `multica-left-sidebar-entry.png`, `multica-squad-multi-select.png`, and `mission-launch-directory-and-dock-continuity.png` were inspected; no clipping, overlap, missing control, or incorrect selection state remained.
- Browser investigation also repaired stale fixture evidence that lacked mandatory `sessionAgentID` ownership and misclassified deliberate SSE stream aborts during Mission session switching; the final run had no unexpected browser errors.
- `bun script/generate.ts` regenerated the built-in Skill payload, OpenAPI document, JavaScript SDK type, portable package template and API docs. The catalog response now exposes complete `members` and no `member_preview`.
- Root `bun run typecheck` — all nine applicable package tasks passed. Focused OpenCorvus and Overlay typechecks also passed.
- `bun run api:routes-check`, `bun run docs:check`, and `bun run overlay:i18n-check` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts` — 87 passed after the new record was added to the Git index required by the tracked-link audit.
- `git diff --check` passed. Final review confirmed that active Agent/UI/catalog paths consume only normalized `members`; remaining `member_preview` references are limited to the strict upstream schema, the source truncation regression, and explicit prohibition documentation/tests.
