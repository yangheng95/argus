# 2026-07-05 Dual-Source And Obsolete Code Subagent Investigation

## Recall

User request: "`/goal 请用独立子agent调查代码中的双源问题和废弃，过期代码问题，按照轮次迭代记录问题，直到找不到新问题`"

Current objective:

- Use independent read-only subagents to investigate dual-source, obsolete, and expired code paths.
- Keep iterating by round until a challenge round stops finding genuinely new issues.
- Record findings only in this task; do not modify product code here.
- Preserve the request, acceptance criteria, and hard constraints in this record so context compaction does not shrink scope.

Acceptance criteria:

- Use independent direct subagents, not CLI stand-ins, for parallel codebase slices.
- Keep every subagent read-only and prohibit further delegation.
- Record each round before moving to the next round.
- Separate confirmed issues from downgraded/rejected items and from "same issue, more evidence" follow-ups.
- Use code, test, spec, and grep evidence rather than naming/title guesses.
- Stop only after a challenge round produces no genuinely new issues.

Hard constraints:

- No fallback/compatibility proposals as fixes.
- No blind patching, git reset, revert, or worktree creation.
- Do not restart or interfere with running OpenCorvus / overlay processes.
- Do not treat mocked tests or prompt text alone as real E2E evidence.
- Keep records under `specs/records/2026-07/` and update the monthly README index.

Sources read before editing this record:

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-04-architecture-issue-subagent-investigation.md`
- `specs/records/2026-07/2026-07-05-overlay-expert-squad-settings-redesign.md`

Full-repo grep / read evidence used in this investigation:

- `rg -n -F "/config/prompt-profile" packages/opencorvus/src packages/overlay/src packages/opencorvus/test packages/overlay/test`
- `rg -n "promptEntries|promptDrafts" packages/overlay/src packages/overlay/test`
- `rg -n "writeIterationSnapshot\\(|executeMetrics\\(|readIterationHistory\\(" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "visual_feedback_verification|verification-evidence|legacy_attachment_url|input_evidence" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "queued_operator_wake|queued_by_process_id|queued_by_instance_directory|queued_by_project_id|source_kind|COALESCE" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "buildRetryFeedbackPrompt|renderBuildPromptOverlays|task-dirbar-keyboard" packages/opencorvus/src packages/opencorvus/test packages/overlay/test`

Independent subagent feedback consumed by this record:

- Round 1: Erdos, Gibbs, Helmholtz, Beauvoir.
- Round 2 challenge: Lovelace, Arendt.
- Round 3 challenge: Sartre, Euclid.
- Round 4 focused challenge: Lovelace, Arendt.
- Round 5 focused challenge: Sartre, Euclid.
- Round 6 saturation check: Lovelace, Arendt.

Working tree boundary:

- The repository was already heavily dirty before this investigation started.
- Existing uncommitted source, test, docs, and spec edits are treated as user/other-task state.
- This task only adds the investigation record and README index entry; it does not claim ownership of unrelated modified files.

## Issue Ledger

### Round 1 New Confirmed Issues

1. `DS-01` Public prompt-profile versus expert-squad contract split still exists. Source routes no longer expose `/config/prompt-profile`; live server code now exposes legacy `/config/prompt` plus canonical `/expert-squad/catalog` (`packages/opencorvus/src/server/routes/config.ts:180-219`, `packages/opencorvus/src/server/routes/expert-squad.ts:89-142`). Generated/public artifacts still publish the retired route and/or omit the new canonical route (`packages/sdk/openapi.json:1375`, `packages/sdk/openapi.json:12770`, `packages/sdk/js/src/gen/sdk.gen.ts:968`, `packages/sdk/js/src/gen/sdk.gen.ts:4045`, `packages/sdk/js/src/gen/types.gen.ts:4605`, `packages/web/src/content/docs/reference/api.mdx:57`, `packages/web/src/content/docs/zh-cn/reference/api.mdx:57`, `packages/transport-protocol/test/contract.test.ts:408`).
2. `DS-02` Overlay settings still depend on the legacy prompt catalog path, and `promptEntries` remain stored/reset even though the UI no longer consumes them. The settings refresh path still calls `/config/prompt` (`packages/overlay/src/services/init.ts:278-328`, `packages/overlay/src/services/dialog.ts:55`, `packages/overlay/src/services/events.ts:215`), while `promptEntries` only survive in store/init/reset state (`packages/overlay/src/store/app.ts:105-108`, `packages/overlay/src/store/app.ts:146-147`, `packages/overlay/src/services/workspace.ts:322-323`).
3. `DS-03` A subset of overlay browser fixtures still shortcut two different contracts into one expert-squad payload, which hides route-shape regressions. Confirmed examples include `packages/overlay/test/browser/overlay-global-live-pressure-browser.test.ts:519`, `packages/overlay/test/browser/task-list-perf.test.ts:200`, `packages/overlay/test/browser/task-list-tree-click.test.ts:131`, `packages/overlay/test/browser/task-composer-existing-task.test.ts:101`, and `packages/overlay/test/browser/task-deep-link-browser.test.ts:116`.
4. `DS-04` The legacy prompt catalog/helper layer still survives as maintenance residue even though runtime authority moved to `PromptProfileResolver`. Backend still serves `PromptCatalog.list()` through `/config/prompt` (`packages/opencorvus/src/config/prompt-catalog.ts:97`, `packages/opencorvus/src/server/routes/config.ts:209`), and tests still exercise the static `PromptProfile` helper while runtime callers use `PromptProfileResolver` (`packages/opencorvus/src/agent/prompt-profile.ts:123-157`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:288-301`, `packages/opencorvus/test/agent/prompt-profile.test.ts:153-157`).
5. `DS-05` Architecture and model-facing wording still teach the retired Prompt Catalog / prompt-profile catalog terminology instead of the expert-squad catalog contract (`specs/current/architecture/07-panel.md:295`, `packages/opencorvus/src/orchestrator/tools.ts:8112-8113`, `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts:104`).
6. `DS-06` Current architecture docs still describe the removed `ProviderLLM.stream()` entrypoint as live (`specs/current/architecture/06-provider.md:145`, `specs/current/architecture/06-provider.md:203`), while source now routes through session-owned model wrapping (`packages/opencorvus/src/provider/llm.ts:4`, `packages/opencorvus/src/session/llm.ts:237`, `packages/opencorvus/src/session/llm.ts:305`).
7. `DS-07` Deprecated goal-run query aliases remain exported with no live callers: `listGoalRunsByTask`, `listActiveGoalRunsByCoordinator`, and `listGoalRunsByCoordinator` (`packages/opencorvus/src/engine/store.ts:1201-1208`).
8. `DS-08` `engine_iteration` remains a live read contract after its production write path died. Runtime still reads iteration history in orchestrator and describe paths (`packages/opencorvus/src/orchestrator/agent.ts:1356-1364`, `packages/opencorvus/src/engine/describe.ts:702`, `packages/opencorvus/src/engine/describe.ts:811`), while write/compute code is only defined in metrics modules and tests (`packages/opencorvus/src/metrics/store.ts:144`, `packages/opencorvus/src/metrics/score.ts:49`).
9. `DS-09` Historical `EvaluationRow` is still the active consumption model even though the old table is gone. Runtime rebuilds it from verification artifacts and still feeds task/workbench paths through it (`packages/opencorvus/src/engine/store.ts:114`, `packages/opencorvus/src/engine/store.ts:1697`, `packages/opencorvus/src/engine/store.ts:2300`, `packages/opencorvus/src/task-api/index.ts:1319`, `packages/opencorvus/src/task-api/index.ts:1896`, `packages/opencorvus/src/workbench/board.ts:146`).
10. `DS-10` Build input evidence still has no durable single authority. Dispatch seeds `build_session_contract.payload.input_evidence = null` (`packages/opencorvus/src/orchestrator/tools.ts:14114`), then `BuildAgent.run()` rebuilds evidence from transient context packets and falls back to the original manifest only on retry (`packages/opencorvus/src/build/agent.ts:989-1007`).
11. `DS-11` `visual_feedback_verification` is still dual-sourced between a persisted verification-evidence artifact and a mirrored decision-log payload. The write path duplicates the payload (`packages/opencorvus/src/orchestrator/tools.ts:4855-4877`, `packages/opencorvus/src/acceptance/visual-feedback-verification.ts:218`), while failure counting and workflow projection still read the mirror first (`packages/opencorvus/src/orchestrator/tools.ts:4867-4877`, `packages/opencorvus/src/engine/workflow.ts:682-706`).
12. `DS-12` Visual QA comparison/diagnostic artifacts are still re-materialized under ambient `Instance.project.id` instead of task ownership (`packages/opencorvus/src/orchestrator/tools.ts:5164`, `packages/opencorvus/src/orchestrator/tools.ts:5223`, `packages/opencorvus/src/orchestrator/tools.ts:5483`).
13. `DS-13` `legacy_attachment_url` is still an operational authority carrier, not just historical metadata. Build evidence rehydrates from it and attachment GC retains blobs by scanning it (`packages/opencorvus/src/build/evidence-manifest.ts:360`, `packages/opencorvus/src/storage/attachment-store.ts:833`, `packages/opencorvus/src/storage/attachment-store.ts:871`).

### Round 2 Challenge Delta

1. `DS-01` expanded: the retired `/config/prompt-profile` endpoint is still pinned by protocol tests (`packages/transport-protocol/test/contract.test.ts:408`), while the new `/expert-squad/catalog` path is already present in generated OpenAPI/SDK (`packages/sdk/openapi.json:12770`, `packages/sdk/js/src/gen/sdk.gen.ts:4045`). Manual API docs still document the retired route and omit the canonical route (`packages/web/src/content/docs/reference/api.mdx:57`, `packages/web/src/content/docs/zh-cn/reference/api.mdx:57`).
2. `DS-14` Generic evaluation readers do not filter `verification-evidence` by `scope` or `label`, so `visual-feedback-verification` can be reconstructed as a normal evaluation row. The writer stores it with `label="visual-feedback-verification"` and `scope="visual_feedback"` (`packages/opencorvus/src/acceptance/visual-feedback-verification.ts:218`), but generic reads only filter on `kind="verification-evidence"` before rebuilding `EvaluationRow` (`packages/opencorvus/src/engine/store.ts:692`, `packages/opencorvus/src/engine/store.ts:845`, `packages/opencorvus/src/engine/store.ts:1697`).
3. `DS-03` was downgraded in wording, not dismissed: the shortcut fixture problem is real, but it is a subset of browser tests rather than the dominant pattern. Many newer tests already return `[]` for `/config/prompt` while keeping a separate expert-squad catalog fixture.

### Round 3 Challenge Delta

1. `DS-15` `promptDrafts` still exists as dead overlay runtime state. It is defined and reset in the app store (`packages/overlay/src/store/app.ts:105-108`, `packages/overlay/src/store/app.ts:146-147`, `packages/overlay/src/services/workspace.ts:322-323`), but no current overlay consumer reads it.
2. `DS-16` Overlay architecture guards still assert the retired `prompt-preview-*` selector contract even though the live surface is now `expert-squad-prompt-card` (`packages/overlay/test/overlay-architecture-guards.test.ts:1122-1153`, `packages/overlay/src/components/settings/ExpertSquadPanel.tsx:580-582`, `packages/overlay/src/styles/surfaces/settings.css:2286-2293`).
3. `DS-17` Queue cwd ownership is still explicitly dual-sourced between `session.directory` and `project.worktree`. Every queue query uses `COALESCE(session.directory, project.worktree)` (`packages/opencorvus/src/engine/queue.ts:318`, `packages/opencorvus/src/engine/queue.ts:363`, `packages/opencorvus/src/engine/queue.ts:638`, `packages/opencorvus/src/engine/queue.ts:699`, `packages/opencorvus/src/engine/queue.ts:762`, `packages/opencorvus/src/engine/queue.ts:777`), and `taskCwd()` documents the same fallback contract (`packages/opencorvus/src/engine/queue.ts:582-600`).
4. `DS-18` Build still defaults task runtime and prompt context back to ambient `Instance.project.worktree` instead of task-owned project resolution. Evidence materialization uses `Instance.project.worktree` (`packages/opencorvus/src/build/agent.ts:925-927`), prompt context does the same when `context.projectDir` is absent (`packages/opencorvus/src/build/agent.ts:986-987`), and the external executor assistant message still records `path.root = Instance.worktree` (`packages/opencorvus/src/build/agent.ts:2313`).

### Round 4 Focused Challenge Delta

1. `DS-19` Build prompt overlay rendering still preserves a second path contract: `projectDir` is optional, and missing `projectDir` changes runtime refs from absolute task-runtime paths to relative fallback paths (`packages/opencorvus/src/build/prompt-context.ts:17-20`, `packages/opencorvus/src/build/prompt-context.ts:130-137`, `packages/opencorvus/src/build/prompt-context.ts:153-156`).
2. `DS-20` The `task-dirbar-keyboard` browser fixture still auto-injects `directory` from a default project directory when the caller does not provide it, hiding missing-directory injection failures (`packages/overlay/test/browser/task-dirbar-keyboard.test.ts:173-177`, `packages/overlay/test/browser/task-dirbar-keyboard.test.ts:204`).
3. `DS-21` `queued_operator_wake` persists `source_kind`, `queued_by_process_id`, `queued_by_instance_directory`, and `queued_by_project_id`, but production readers only consume `payload.event`; the extra fields are effectively write-only persisted metadata with test-only readers (`packages/opencorvus/src/engine/queue.ts:122-142`, `packages/opencorvus/src/engine/queue.ts:198-241`, `packages/opencorvus/test/engine/queue.test.ts:707-719`, `packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts:282-286`).
4. The additional claim that existing-session Build bypasses project consistency checks is merged into `DS-18`, not tracked as a separate issue. It is more evidence for the same ambient-project dependency, not a new defect class.

### Round 5 Focused Challenge Delta

1. `DS-22` Same-session build retry drops task-specific build overlays and requirements context. Normal prompt assembly includes task-specific overlays (`packages/opencorvus/src/build/agent.ts:3385-3400`, `packages/opencorvus/src/build/prompt-context.ts:198-227`), but retry prompt generation only returns flattened `buildContextPacketText(context?.contextPackets)` and ignores `target`, `taskID`, requirements, and overlay rendering (`packages/opencorvus/src/build/agent.ts:3403-3415`). Current tests explicitly pin that omission (`packages/opencorvus/test/build-agent/prompt-context.test.ts:372-410`).

### Round 6 Saturation Result

1. One final challenge agent returned `无新增问题`.
2. The other final challenge agent re-confirmed `DS-22` from a different angle: retry prompt routing at `packages/opencorvus/src/build/agent.ts:1013` never re-renders `Task-Specific Build Overlays`; it only serializes already-flattened context packet text.
3. No round after `DS-22` produced a genuinely new issue class. The investigation stopped here.

## Downgraded, Rejected, Or Not Counted As New Issues

1. There is no live `/config/prompt-profile` source route or current overlay caller in the checked source tree. The problem is the published contract residue, not a second live runtime route.
2. Current expert-squad runtime authority is single-path: active storage plus `/expert-squad/catalog` plus `PromptProfileResolver` plus `loadExpertSquadCatalog()`. This was not counted as a current dual authority.
3. `byteMaterializationProjectID` is public-contract leakage, but current runtime handling is fail-fast rather than fallback-driven; it was not promoted to a current split-authority bug in this audit.
4. `legacyRuntimeRelativePaths` and duplicate legacy tool IDs are defensive rejection logic, not live legacy implementations.
5. `DS-17` had one earlier challenge agent argue it was "not a current bug" because all queue paths consistently use the same `COALESCE(...)`. Local adjudication kept it as confirmed because this task was specifically auditing dual-source and obsolete code, and the queue contract itself still explicitly preserves the fallback.
6. `DS-03` was kept, but only as a subset-fixture regression risk. The broad claim that "most browser tests" do this was rejected.

## Conclusion

This audit stopped after six rounds because the final challenge round added no issue beyond `DS-22`. The confirmed problem set is the 22-item ledger above. The dominant clusters are:

1. Prompt/expert-squad migration residue still leaks through public contracts, settings reload paths, helper layers, docs, and test fixtures.
2. Build / evidence flows still keep multiple authorities or ambient-project fallbacks in contract, prompt, and artifact paths.
3. Overlay and queue code still retain dead runtime state, stale selectors/fixtures, and write-only persisted metadata.
