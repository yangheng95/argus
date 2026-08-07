# Architect Goal Identity and Prism Design Contract Repair

Date: 2026-07-25

Status: Implementation validated; fresh Mission running under bounded monitoring

## Recall

| Item | Details |
| --- | --- |
| User requirement | Stop treating activity as progress, stop reusing the polluted Mission, explain and repair why Architect structural re-entry generated another complete Goal set and why the same design Goal repeatedly launched new Agent Sessions. Repair both OpenCorvus infrastructure and the active Mirror Prism expert squad, restart, and validate with a fresh Mission. |
| Acceptance criteria | The polluted Mission `7a18cba92c55a6b9` is stopped and retained as evidence. An Architect structural re-entry over an exact prior ContractGraph preserves every unchanged Goal ID and does not increase Goal cardinality. A genuinely new Goal is the only case that appends one new Goal identity. Mirror Prism Page Designer writes its design into the Frontend Design adapter's exact task-scoped `visual-html-skeleton` artifact root, uses canonical visual capture, and cannot call a partial/inconsistent snapshot complete. Focused persistence, adapter, package, payload, and documentation tests pass. The backend is restarted only after the repair is committed and pushed, and validation uses a fresh Mission/Session. |
| Hard constraints | Follow `AGENTS.md`; no fallback, compatibility lane, host workflow gate, model substitution, state machine, repeated wake/restart loop, fabricated Goal/task/Mission, database migration, destructive Git command, new worktree, or deletion of the polluted Mission record. Preserve all parallel worktree changes and stage only task-owned files. Commit subjects use `dsw-33987`; push normally to `legacy-remote`. |
| Runtime evidence | At 2026-07-25, Task `tsk_f952767d9001De82KFTZQ5hino` contained original Goals `gol_f95497211001...1007` plus duplicate Goals `gol_f960501f0001...0007`. The Orchestrator message explicitly observed that `structural_reentry` created a new ContractGraph and seven new Goal IDs. Progress became `2/14` because both copies of G1 were marked passed. The same Task launched Page Designer Sessions `ses_069c1a009ffdJg0xbpFErDe6q5`, `ses_06917ba39ffd9MHfzsfwXJr7y5`, and `ses_0690252d1ffe0J6PjOHWRDUtaC`; the first failed on the external provider, while later runs produced project-local `.mirror/design/spaces-index/index.html` but the Frontend Design adapter persisted partial evidence because canonical `visual-html-skeleton` capture was not completed. Mission abort returned HTTP 200; Mission, Task, root Orchestrator, and active Visual Reviewer are now explicit terminal aborted records. |
| Sources read | `AGENTS.md`; `specs/records/2026-07/2026-07-08-evidence-delivery-and-architect-reentry-systemic-repair.md`; `specs/records/2026-07/2026-07-23-mirror-prd-initial-architect-dispatch-repair.md`; `specs/current/architecture/15-agent-facts-and-turns.md`; Architect adapter/output/persistence sources; Frontend Design prompt/output/artifact sources; Mirror Prism Architect and Page Designer package prompts/Skills. |
| Whole-repository grep | `rg -n -i "structural_reentry|createGoal|insertArchitectGoals|removedGoalIDs|prior_contract_graph_artifact_id|goal ID|existing Goal" packages/opencorvus/src packages/opencorvus/test expert-squads specs`; `rg -n "visual_evidence|visual-html-skeleton|capture_frontend_visual_evidence|\\.mirror/design|FRONTEND_DESIGN_FACT_STATUS" packages/opencorvus/src/frontend-design packages/opencorvus/test/frontend-design expert-squads/mirror/prism`; `rg -n "insertArchitectGoals\\(" packages/opencorvus/src packages/opencorvus/test`; `rg -n "mirror-prd-stage-architect|mirror-design-page-designer" expert-squads/mirror/prism packages/opencorvus/test/expert-squad`. |
| Independent agent feedback | No independent Agent was requested or used. The repair is based on persisted Mission/Task/Session/tool evidence and exact production call paths. |

## Causal chain

### Duplicate Goal graph

1. `projectArchitectInput()` correctly selects the exact prior ContractGraph and projects its existing Goal rows.
2. `ArchitectAgent.coordinate()` correctly seeds the output collector with those existing database Goal IDs.
3. Mirror Prism Architect instructions say to create the complete Goal graph but do not explicitly require structural re-entry to preserve the projected IDs.
4. Even if the model returns the exact existing IDs, `insertArchitectGoals()` unconditionally maps every returned ID to a fresh `Identifier.ascending("goal")` and inserts every row.
5. `architect-stage.ts` then binds only the newly inserted rows to the new ContractGraph. The original graph and its passed Goal remain, producing two independently visible seven-Goal sets.

The persistence implementation is therefore the decisive infrastructure defect. Prompt ambiguity increases the probability of new temporary IDs but is not required to trigger duplication.

### Repeated Page Designer Sessions

1. The Frontend Design adapter prompt and validator define one canonical task-scoped artifact root: `.opencorvus/.r/t/<task>/fd/visual-html-skeleton`.
2. Mirror Prism's Page Designer Skill and reference instead require `.mirror/design/<page>.html`.
3. The worker follows the active package contract, writes the project-local file, performs browser work outside the canonical capture tool, and reports completion.
4. The adapter can persist only a partial/inconsistent FrontendDesign fact because the required canonical `capture_frontend_visual_evidence` row and files are absent.
5. The Orchestrator correctly refuses to accept the partial fact and dispatches another Page Designer Session for the same Goal.

The repeated Sessions are the observable consequence of a contradictory expert-package/adapter contract, not evidence that the Goal itself needs a new identity.

## Implementation plan

1. Replace append-all Architect persistence with identity-preserving reconciliation:
   - existing exact Goal IDs are updated in place and retain order/attempt/evidence identity;
   - new logical Goal IDs alone receive new database IDs and append after existing order indexes;
   - dependencies map across preserved and newly allocated IDs;
   - all current graph Goals bind to the new ContractGraph without leaving a second visible graph.
2. Update Architect persistence comments and tests so structural re-entry cardinality and identity are explicit.
3. Update Mirror Prism PRD Architect prompt/Skill to require exact existing Goal IDs on re-entry and `modify_goal` for changed fields.
4. Replace `.mirror/design` in the Page Designer package with the adapter-projected task-scoped `visual-html-skeleton` contract. Require canonical capture and a non-partial FrontendDesign fact before claiming completion.
5. Bump the Mirror Prism package version, regenerate the bundled payload, and add package-source/payload regressions.
6. Run focused tests, package typecheck, payload freshness, historical/document health, and a second diff review.
7. Commit and push normally, restart the backend once, then publish a fresh Mission and verify that initial Architect creates one graph and structural re-entry does not grow it.

## Validation ledger

- Polluted Mission `7a18cba92c55a6b9` abort returned HTTP 200. Mission status is `failed`, Task lifecycle is `cancelled`, and root/Orchestrator/active reviewer Sessions are terminal `aborted`; no record was deleted.
- `insertArchitectGoals()` now recognizes exact Task-owned Goal IDs, updates only their contract fields, preserves identity/order/creation history, allocates IDs only for new Goals, and maps dependencies across both sets.
- Mirror Prism version `2026.07.25.1` requires exact Goal IDs on Architect re-entry and makes task-scoped `visual-html-skeleton` plus `capture_frontend_visual_evidence` the Page Designer's sole output contract.
- Generated `packages/opencorvus/generated/expert-squad-payload.ts` includes the repaired package bytes.
- `bun test packages/opencorvus/test/engine/goal-versioning.test.ts packages/opencorvus/test/engine/domain-artifact-bindings.test.ts packages/opencorvus/test/workbench/board-requirements.test.ts packages/opencorvus/test/engine/goal-contract-fields.test.ts packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts packages/opencorvus/test/expert-squad/mirror-prism-source-capability.test.ts`: 22 passed, 0 failed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed, 0 failed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts packages/opencorvus/test/architect/prompt.test.ts packages/opencorvus/test/frontend-design/prompt.test.ts packages/opencorvus/test/frontend-design/schema.test.ts`: 124 passed, 0 failed.
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`: 10 passed, 0 failed; regeneration preserved SHA-256 `09e2ffce46896891c78c6557df15f0474a37aefb717860b31e4c19c5e8d9fcfb`.
- `bun run docs:check`: passed with 291 operations across 24 groups.
- `bun run typecheck`: 9 package tasks passed.
- Second diff review found no fallback, gate, state machine, alternate design-output root, Goal-attempt mutation, or unrelated-file staging requirement. Existing Goal contract updates and ContractGraph rebinding occur in the same database transaction, so no intermediate null graph binding is externally observable.
- Commits `caf72152f` and `8bfa8f6d7` passed normal pre-push hooks and are present on `legacy-remote/v0.0.18beta`.

## Post-restart infrastructure finding

The fresh Mission `29b33753e4a9f88b` (Session `ses_068ce047affe7YoKvRGFzqVIv4`) loaded an empty Mission ledger and began a fresh scaffold bootstrap, but its first `panel.expert_squad_catalog` result failed after successful tool execution:

`Truncate.output: sessionID and taskID are required for runtime-scoped tool output`

The catalog is larger than the inline output limit. `Tool.define()` correctly passes the Mission Session ID into `Truncate.output()`, but Mission root Sessions intentionally have no Task lineage, while `Truncate.output()` has only a Task-session storage path. The catalog itself and Panel tool are not the cause; the output recovery storage contract omits the legitimate root-Session execution surface.

Whole-repository grep for this addendum covered `Truncate.output`, `toolOutputDir`, cleanup globs, `taskIDForSession`, `expert_squad_catalog`, Panel tests, and truncation tests. The repair adds one canonical root-Session output directory under the existing session-index runtime namespace, selects it only when the Session has no Task owner, includes it in retention cleanup, and adds real large-output recovery plus Panel catalog regressions. This is storage-shape integrity, not a workflow fallback or gate. The running process still contained the pre-repair implementation, so the same catalog retry reproduced the truncation failure. Mission `29b33753e4a9f88b` was therefore classified as polluted and explicitly aborted after its live prompt settled; its Session and fresh-01 clone remain preserved as evidence and are not reused.

### Addendum validation

- `ProjectRuntimePaths.rootSessionToolOutputDir()` now owns the sole taskless Session recovery path under `.opencorvus/.r/sx/<session>/tool-output`.
- `Truncate.output()` retains Task-primary runtime ownership when Task lineage exists and uses the root-Session path only when it does not. Cleanup covers both canonical path shapes.
- The production-shaped Panel regression executes a 60 KiB Mission `expert_squad_catalog`, verifies truncation succeeds without Task lineage, and reads the complete persisted catalog bytes back from the root-Session path.
- The complete Panel suite initially exposed seven stale fixtures that passed fabricated message/Session IDs into strict Panel provenance checks. These were fixture contract defects, not accepted noise: the tests now create real caller Sessions/messages and explicit Control context. `bun test packages/opencorvus/test/tool/panel.test.ts`: 18 passed, 0 failed.
- `bun test packages/opencorvus/test/tool/truncation.test.ts`: 24 passed, 0 failed.
- `bun run --cwd packages/opencorvus typecheck`: passed after the addendum.
- The first fresh attempt used scaffold source `file:///Users/yangheng/Documents/OpenCorvus-Demos/prism/scaffold-sources/vite-react-ts`, baseline `main`, and created `runs/tradingview-spaces-20260725-fresh-01`; it was not promoted after its root Session reproduced the old-process truncation defect.

## Fresh-process runtime validation

- The backend process that still carried the old truncation implementation exited through `SIGINT` only after Mission `29b33753e4a9f88b` had been aborted and no live prompt owner remained. Port 7878 and the old PID were both absent before restart.
- The repaired backend started as PID `25149` on `http://127.0.0.1:7878`. `/global/health` returned healthy, and the exact provider probe for `hexin/gpt-5.6-sol` returned HTTP 200 with `status: connected`.
- The project-installed Prism package is `2026.07.25.1`; the bundled market reports the same installed version and `update_available: false`.
- A completely new Mission `16b1b10fea539825` and root Session `ses_068c14a76ffeqy5uSbcv1nr8kb` were created with the scaffold URL and `main` baseline in the initial operator message. The message forbids reuse of either polluted Mission, every old Task/Session/Goal runtime, and fresh-01.
- The new root Session completed `panel.expert_squad_catalog`. It then successfully read the truncated result from `.opencorvus/.r/sx/1z/MdlgVM/tool-output/tool_f973f8959001W9fmm3U8uy8fu8`, proving the new taskless-Session recovery path works in the real Mission message flow rather than only in tests.
- The Mission cloned the exact `main` baseline commit `d1982dc60d3da2a22e659c49eb88e41e350679a0` into the previously absent `runs/tradingview-spaces-20260725-fresh-02`, created branch `mirror-prism-tradingview-spaces-0725`, verified a clean worktree, and created exactly one active Delivery Task `tsk_f97457723001toocqO4G5KhIsQ` with root Session `ses_068ba8791ffeq3GVQmc8UOiQNB` and Orchestrator Session `ses_068ba8186ffefPDSfTkwQX7w34`. There were no pending permissions. The 15-minute heartbeat now targets only this exact Mission/Session and treats the two earlier Missions as evidence-only.

## Structural re-entry payload finding

Task `tsk_f97457723001toocqO4G5KhIsQ` created exactly 11 Goals, then correctly requested one structural re-entry over ContractGraph `art_f97623ea00015TNuKKw3nqBkb5`. Goal persistence preserved all 11 IDs and did not append duplicates, proving the identity repair. The re-entry nevertheless failed terminally because `architect/agent.ts` truncates every existing Goal's rendered `acceptance_specs` to 600 characters while telling the model that full bodies remain on an exact Goal fact; the projected Architect has no tool that can read that full Goal fact. Since `modify_goal.acceptance_specs` replaces the complete list, the worker correctly refused to rewrite from the truncated snapshot.

The root repair is to remove this false prompt truncation and project the complete already-validated Goal contracts that `projectArchitectInput()` has loaded from durable storage. This changes no workflow control and adds no fallback or gate. Regression coverage must prove a structural re-entry prompt contains the tail of an acceptance contract longer than 600 characters and contains no truncation claim.

## Source-contract capability finding

Fresh Mission `354651f00eac19e7`, Task `tsk_f9778c739001OBRomkZCM5gzv2`, then failed at the first manifest node. The Prism package requires `mirror-prd-general-researcher` itself to persist, read back, validate, and digest `.mirror/prd/tmp/system-project-contract.json`, but the package projected only browser evidence and `websearch`; the frontend-research base role has no repository write or digest tool. The previous universal-build dispatch was therefore an undeclared substitute, not a repair.

The package-owned repair projects `apply_patch` and `bash` only to this exact dynamic researcher and explicitly limits them to the canonical source-contract output. This keeps the manifest node as the sole producer and removes the need for an extra workflow node or fallback.

## Explicit projection switch-precedence finding

Fresh Mission `d311a90cd1b31ea3`, Task `tsk_f97a22870001yTTk60cD3zNKWy`, and worker Session `ses_0685d1013ffdsnPpHRZh1r4wGf` proved that the package declaration alone did not reach the model-visible runtime. The installed Prism `2026.07.25.2` manifest contains `apply_patch` and `bash` in `capability_projection.agents.mirror-prd-general-researcher.built_in_tool_ids`, and `PromptProfileResolver` includes those IDs in the resolved capability. The worker's actual visible tool surface nevertheless omitted both tools and ended at message `msg_f97a3fee3001tJ1PrikL9WfBqX` with coordination artifact `art_f97a43a5e001IjHZPKAT4bGL1m`.

The complete call graph is:

1. `PromptProfileResolver.expandedWorkerBuiltInToolIDs()` merges the frontend-research template tools with the package's explicit `built_in_tool_ids`.
2. `PromptProfileResolver.projectWorkerTools()` materializes the resolved built-ins into `runtimeTools`.
3. `runAgentSession()` passes those runtime tool names to `promptToolSwitchesForAgentRun()`.
4. `promptToolSwitchesForAgentRun()` first marks every materialized tool enabled, then overwrites `apply_patch` and `bash` with the frontend-research template defaults `false`.
5. `SessionPrompt` consequently removes both explicitly projected tools from the model-visible surface even though the resolver, projection hash, and runtime descriptor still claim they belong to the worker.

This is a precedence defect between a base-template default and an exact package declaration. The default must continue to keep ordinary frontend-research workers read-only, while an explicit active-package `built_in_tool_ids` declaration must override that default for the declared worker. Caller-supplied per-run switches remain the final authority. The repair therefore changes only switch composition order: materialized tool availability, template defaults, explicit package enablement, then caller override. It does not add a gate, fallback, alternate writer, or workflow branch.

Whole-repository grep for this addendum covered `promptToolSwitchesForAgentRun`, `defaultRuntimeToolSwitches`, `projection.built_in_tool_ids`, `builtInToolIDs`, `projectWorkerTools`, and every production/test caller. Regression coverage must prove both sides of the contract from the real Prism package: a generic frontend-research run keeps `apply_patch`/`bash` disabled, while the resolved `mirror-prd-general-researcher` explicit projection enables both.

### Switch-precedence validation

- `promptToolSwitchesForAgentRun()` now composes materialized runtime tools, template defaults, exact package declarations, and caller per-run overrides in specificity order.
- The focused tool-scope regression proves ordinary frontend-research still receives `apply_patch: false` and `bash: false`, while an explicit package projection receives both as `true`.
- The production Prism package test resolves every installed worker capability. It proves the exact `mirror-prd-general-researcher` runtime switches enable both write tools and the sibling `mirror-prd-ui-researcher` keeps both disabled.
- `bun test packages/opencorvus/test/agent/runner-tool-scope.test.ts packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts packages/opencorvus/test/session/runtime-contract-tools.test.ts packages/opencorvus/test/agent/runtime-template-registry.test.ts`: 35 passed, 0 failed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed, 0 failed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
