# Mission Expert Squad recommendation catalog projection

## Recall

### User request

The user supplied a screenshot of a Mission `panel` card showing `...89955 bytes truncated...` immediately after loading `references/recovery-delivery.md` and reported that this is a bug. Diagnose from the exact runtime tool call, repair the root cause immediately, preserve all parallel changes, reload only when required, and intervene in the Mission only to the minimum reliable degree.

### Acceptance criteria

1. `panel.expert_squad_catalog` returns the complete information a Mission needs to choose an exact Expert Squad and its declared workflow, but does not return Settings-only manifests, complete capability projections, Agent inventories, README bodies, selector instruction bodies, paths, or hashes.
2. The real project catalog remains below the inline tool-output threshold and does not create a recovery file during an ordinary Mission catalog call.
3. Empty launcher selection still returns the complete canonical visible Squad set; a non-empty selection still preserves exact caller order and rejects unknown IDs.
4. Settings and Expert Squad API consumers retain the existing complete `ExpertSquadCatalogSummary` projection.
5. Root-Session large-output recovery remains independently supported for genuinely large tool results; this repair does not weaken or remove truncation storage.
6. Focused tests, typecheck, documentation health, commit, normal-hook push to `myhexin`, and a real post-reload Mission call verify the repaired message flow.

### Hard constraints

- Do not add a size gate, field-name blacklist, fallback, retry, compatibility output, Squad special case, or Host workflow rule.
- Derive the compact Mission recommendation from the same canonical package catalog used by Settings; do not scan packages twice or create another identity source.
- Preserve every unrelated staged, unstaged, untracked, and concurrently edited file. Do not stash, reset, restore, delete, or create a worktree.
- Do not classify the successful truncation persistence as the root cause. The root defect is the wrong consumer projection before truncation.
- A process reload is required because `panel.ts` and the resolver are runtime-loaded source. Settle any live Mission prompt before stopping PID `98945`.

### Sources read

- `AGENTS.md`
- supplied screenshot `codex-clipboard-8bbe9d32-571c-47d9-85ac-fb1a91093cdf.png`
- runtime output `.opencorvus/.r/sx/CB/tke3G0/tool-output/tool_f98679961001UPipoq86LRX8yp`
- Mission `58bd3f2288e90736`, Session `ses_06798f38cffeLk7mCkyS31Of3Y`
- `specs/records/2026-07/2026-07-25-architect-goal-identity-and-prism-design-contract-repair.md`
- `specs/current/architecture/07-panel.md`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/expert-squad/catalog.ts`
- `packages/opencorvus/src/expert-squad/catalog-profile.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/test/tool/panel.test.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`

### Whole-repository search

`rg` over `expert_squad_catalog`, `recommendationCatalog`, `settingsCatalog`, and `ExpertSquadCatalogSummarySchema` found:

| Call point | Decision |
| --- | --- |
| `PromptProfileResolver.catalogInventory` | Preserve as the one package discovery and validation source. |
| `PromptProfileResolver.settingsCatalog` and `/expert-squad` routes | Preserve the full Settings projection. |
| `PromptProfileResolver.recommendationCatalog` | Change its consumer contract to a compact Mission recommendation derived from each validated full summary. |
| `MissionRoutes /mission/wake` | Preserve exact visible-ID validation through the compact recommendation catalog. |
| `PanelTool expert_squad_catalog` | Preserve the one Mission-only query and serialize only compact recommendations. |
| Panel capability schema and generated SDK action union | Preserve; the input action does not change. |
| Resolver, Panel, Mirror Prism package tests | Update or extend to assert exact visible ordering, workflow recommendation data, absence of Settings-only payloads, and non-truncated real output. |
| Truncation tests and large mocked Panel result | Preserve as independent recovery-path coverage. |
| All `assertKnownProfileID` callers | Keep project callers project-scoped; make global candidate validation explicitly resolve only the canonical global package location. |

### Independent Agent feedback

No independent Agent review was requested, so no sub-agent was started.

## Failure evidence

At `2026-07-25T08:32:34.102Z`, Mission Session `ses_06798f38cffeLk7mCkyS31Of3Y`, message `msg_f9867414c00160C49LRinTJ3dv`, part `prt_f986799360012eiYWimXDn43Fw`, called `panel` with exact input `{ "action": "expert_squad_catalog" }`. The tool succeeded in 45 milliseconds, but its output was 89,955 bytes and was replaced inline by a 285-byte recovery notice. The complete output file begins with the entire built-in General capability projection and continues through every Agent, workflow node, README, selector instruction, package path, and Prism manifest detail.

Mission status remained `running`, with zero Tasks and no pending permissions. Backend PID `98945` remained healthy on `127.0.0.1:7878`.

## Causal chain

1. The Mission correctly calls its only Expert Squad recommendation action.
2. `PromptProfileResolver.recommendationCatalog` returns `ExpertSquadCatalogSummary[]`.
3. `ExpertSquadCatalogSummary` is the Settings/detail model and intentionally embeds the complete `capability_projection`, `readme.content`, `selector.instructions`, paths, and hashes.
4. `PanelTool` serializes the full objects without a Mission-specific projection.
5. The generic truncation layer correctly persists the 89,955-byte result and returns a recovery notice.
6. The Mission must perform a second Read against an opaque file merely to discover a short list of Squad IDs, guidance, and workflows; the visible UI shows a huge truncated control-plane response before any Task exists.

The earlier infrastructure repair only added a legal root-Session storage path for large output. It explicitly declared the catalog not causal, so it made the oversized response recoverable without correcting the wrong projection. This is why the same user-visible defect remains.

## Concurrent shared lifecycle defect

The required full Settings route regression exposed a second reproducible Expert Squad infrastructure defect. Updating the global config to a globally installed external Squad failed with `ConfigCandidateValidationError: Unknown prompt profile "project-replica"`. `validateConfigCandidate` discarded its existing `providerScope: "global"` while asking `assertKnownProfileID` to resolve the profile with no project directory. The resolver therefore refused every non-built-in global profile before uninstall reference replacement could begin.

This is not an uninstall or Prism special case. Global config validation now explicitly requests the global package scope, which resolves through the same Registry location source used by installation and discovery. Project, Task, Session, and Orchestrator callers keep their exact project directory. No validation is skipped.

## Design

Define one strict `ExpertSquadRecommendation` projection derived from the already validated full catalog summary:

- Squad identity and display fields: `id`, `label`, `display_label`, `description`, `version`, `built_in`;
- selector decision fields: `summary`, `selection_guidance`;
- declared workflow summaries: workflow `id`, `label`, `description`, and `node_count`.

The recommendation deliberately omits runtime implementation detail. A Task with the selected fixed `promptProfile` resolves the full package projection through the existing resolver; Mission only owns the recommendation and stage boundary.

## Implementation

- Added a strict `ExpertSquadRecommendation` schema rather than weakening the existing full catalog schema.
- Changed only `PromptProfileResolver.recommendationCatalog` to derive the Mission projection from the canonical validated inventory.
- Kept `PromptProfileResolver.settingsCatalog` and the `/expert-squad` Settings surface unchanged.
- Preserved exact visible-ID ordering and unknown-ID rejection.
- Preserved the independent generic truncation and root-Session recovery path for genuinely large outputs.
- Preserved strict profile validation while teaching the shared resolver the already-existing distinction between global and project package scopes.

## Verification

The original runtime result was 89,955 bytes. Running the repaired production resolver against the same Prism project produces 2,730 bytes for `general` and `prism`, with all five declared workflow summaries and no `capability_projection`, README, selector instruction body, or manifest path.

Focused verification:

- `bun test packages/opencorvus/test/tool/panel.test.ts`: 19 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`: 24 pass, 0 fail.
- `bun test packages/opencorvus/test/tool/truncation.test.ts`: 24 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts`: 6 pass, 0 fail.
- `bun test packages/opencorvus/test/mission/wake-route.test.ts packages/opencorvus/test/server/mission-routes.test.ts`: 38 pass, 0 fail.
- Full isolated Expert Squad route suite: 18 route cases pass, including complete Settings projection and global uninstall reference replacement.
- `bun run --cwd packages/opencorvus typecheck`: pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 pass, 0 fail.
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`: 8 pass, 0 fail.

The first document-health run reported only that this new record and the unrelated concurrently authored left-Dock record were not yet tracked. The record is included in this repair commit; the unrelated record remains owned by its concurrent change.

## Runtime disposition

The oversized call occurred in the Mission root Session before it created Delivery Task `tsk_f987349b1001GDIH3c4fdYiLJd`. That Task received the fixed Prism `promptProfile`, fresh-07 working directory, and workflow request rather than the full catalog payload. The Task is actively executing and has no error or pending permission, so stopping it merely to reload this Mission-only projection would violate the minimum-intervention requirement. Reload the backend after that live owner settles, then verify a real Mission `panel.expert_squad_catalog` call remains inline. Restart the Mission only if separate evidence proves its Task lineage is polluted.
