# Dispatch Agent Null Schema Pollution

Date: 2026-07-08
Status: Implemented
Owner: Codex

## Glossary

- API: Application Programming Interface, the typed contract exposed by code or a route.
- DB: Database, the persistent SQLite store used by OpenCorvus.
- GPT: Generative Pre-trained Transformer, the model-family signal used by the provider adapter for OpenAI-compatible strict tool schemas.
- UI: User Interface.

## Recall

### User Request

The user asked why the long-running crypto trading Mission task appeared stuck, then clarified: `查调度卡住的问题，我取消的。深入检查所有的schema混乱，不清晰，错误等问题`.

The provided task debug packet identified:

- task id `tsk_f3d6469fd001JiT1CT5N1DoWj8`
- title `Phase 02: Backend and Data Foundation`
- status `cancelled`
- root session `ses_0c29b95ffffeFhYtVnzNPJz3fO`
- run id `run_f3d6f820e001s9j9D4V1PDsQa4`
- runtime DB `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`
- project worktree `C:\Users\chuan\myhexin-local\demos\economy\crypto`

The user explicitly stated that they cancelled it, so cancellation must be treated as terminal evidence, not the root cause.

### Acceptance Criteria

- Explain the observable stall as an evidence-backed scheduler/schema failure, not as the user cancellation itself.
- Reproduce the exact `dispatch_agent target=build` schema failure from the live task.
- Repair the schema materialization path so provider strict-schema `null` placeholders do not block a valid per-goal build dispatch.
- Keep strict local semantics: non-null wrong fields such as `target_agent` on `target=build`, or invalid `directBuildIntent`, must still fail.
- Do not add fallback aliases, broad permissive schemas, hidden route gates, provider-specific special cases for `dispatch_agent`, or a second scheduler dispatch source.
- Add focused tests that cover the live failure shape and the strict rejection cases.

### Hard Constraints

- No fallback or compatibility shim.
- No broad `git reset`, no unrelated file reverts, and preserve existing dirty worktree files.
- Do not restart, cancel, refresh, kill, or otherwise interfere with the running OpenCorvus / overlay process.
- Do not create a new worktree.
- Specs must stay under `specs/records/2026-07/` and be indexed in the monthly README.
- Code changes require tests.

### Sources Read

- `AGENTS.md`
- `specs/artifacts/长程编排测试.md`
- `specs/records/2026-07/2026-07-07-unified-scheduler-dispatch-tool.md`
- `specs/records/2026-07/2026-07-07-dispatch-agent-projected-target-schema.md`
- `specs/records/2026-07/2026-07-02-optional-build-worktree-schema.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/provider/schema.ts`
- `packages/opencorvus/src/provider/transform.ts`
- `packages/opencorvus/test/session/extra-tools.test.ts`
- `packages/opencorvus/test/provider/schema-stress.test.ts`
- `packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`
- Runtime DB rows for task `tsk_f3d6469fd001JiT1CT5N1DoWj8`, session `ses_0c29b8cd8ffeipAxqC0PuNDCm6`, and repeated `dispatch_agent` tool parts.
- Runtime log files under `C:\Users\chuan\myhexin-local\demos\economy\crypto\.opencorvus\r\t\H0\ySuTI5\`.

### Whole-Repository Search Evidence

- `rg -n "selectJsonSchemaVariant|stripNullOptionalsFromJsonSchema|shouldStripProviderNullOptionals|normalizeOpenAIStrictToolSchema|z\.discriminatedUnion|z\.literal\(" packages/opencorvus/src/session packages/opencorvus/src/provider packages/opencorvus/src/orchestrator packages/opencorvus/test/session packages/opencorvus/test/provider packages/opencorvus/test/orchestrator -S`
  - Finding: provider strict null cleanup is centralized in `SessionLoop.prepareProviderTool()` / `stripNullOptionalsFromJsonSchema()`. The only JSON Schema variant selector is `selectJsonSchemaVariant()`.
- `rg -n "dispatch_agent|directBuildIntent|goalID|target_agent|fact_check_items|null placeholders|strict-schema" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07 -S`
  - Finding: `dispatch_agent` is the single visible worker dispatch surface; `directBuildIntent` is a valid optional literal only for task-level direct build, while goal-scoped builds use `goalID` and may omit it.
- `sqlite3 C:\Users\chuan\.local\share\opencorvus\opencorvus.db` queries against `session`, `message`, and `part`
  - Finding: the root session has a child Orchestrator session `ses_0c29b8cd8ffeipAxqC0PuNDCm6`; repeated tool parts from 2026-07-07 16:50 through 16:55 show the same `dispatch_agent` schema error before user cancellation.
- `bun -e` replay using `createOrchestratorTools()`, `WorkflowRegistry.resolveSync("pipeline")`, and `SessionLoop.prepareProviderTool()`
  - Finding: current code still reproduces the live failure without calling the real `dispatch_agent.execute` body.

### Independent Agent Feedback

No sub-agent was used for this repair. The user asked Codex to debug the schema failure, and the available evidence is local DB, logs, source, and a direct replay harness. The selected benchmark-debug workflow was applied directly in this thread.

## Evidence

The task did not hang because backend goal #2 was running slowly. Goal #1 passed, then Orchestrator repeatedly tried to start goal #2 with:

```json
{
  "target": "build",
  "goalID": "gol_f3d6ba17b002rgfUBIwM1FUWEB",
  "worktreeUsage": "managed_worktree",
  "request": null,
  "directBuildIntent": null,
  "userConfirmedStaleIntegrityData": null,
  "target_agent": null,
  "fact_check_items": null
}
```

The recorded tool error rejected `request`, `directBuildIntent`, and `userConfirmedStaleIntegrityData` as null, and rejected other target-specific fields as unrecognized keys. The same failed call repeated until the user cancellation emitted `external abort signal fired`.

## Diagnosis

The schema failure sits between provider strict schema normalization and local Zod validation.

Provider strict tool schemas make optional properties visible as nullable so GPT-compatible providers can satisfy strict object requirements. `SessionLoop.prepareProviderTool()` therefore strips provider-injected `null` placeholders before running the original local schema validation.

That strip logic must pick the correct JSON Schema variant for discriminated unions. It currently treats every `const` property in a variant as a discriminator. For `dispatch_agent target=build`, the branch contains:

- required `target: "build"`: the real discriminator
- optional `directBuildIntent: "modify_files"`: a task-level direct-build literal, not a branch discriminator

When a per-goal build omits `directBuildIntent`, provider strict mode supplies `null`. The variant selector sees `directBuildIntent !== "modify_files"` and refuses the correct `build` branch before null cleanup can run. The schema then validates the original polluted payload and loops on the same failure.

This is a schema interpretation bug, not a crypto backend implementation bug, not a task cancellation bug, and not an `analyze_intent` projection bug.

## Design

Repair `selectJsonSchemaVariant()` so it selects variants by required `const` properties only. Required const fields such as `target` and `action` are discriminators. Optional const fields are valid branch-local constraints and must be left for local validation after the branch is selected.

Expected behavior:

- `target=build`, `directBuildIntent=null`, and other target fields `null` select the `build` branch, strip optional null placeholders, and validate as a per-goal build.
- `target=build` with `target_agent: "opentest-build"` remains rejected because the non-null unknown key is not a provider null placeholder.
- `target=build` with `directBuildIntent: "wrong"` remains rejected by the build branch schema.
- A missing or null required `target` does not select a branch.

## Secondary Schema Cleanup

Full `extra-tools` validation exposed a separate stale schema fixture: `runtime-needs-webpage-extract` declared `required_tools: ["webpage_extract"]`. Current `SkillRequiredTools` correctly validates required tools against `AgentToolPool.canonicalToolIDs()`, and `webpage_extract` is not canonical for project skills. The fixture was not testing retired frontend extraction; it was testing that exact runtime contracts rebind a stale `skill` tool to the current turn-scoped mount surface.

The fixture now uses canonical `bash`, which remains outside the exact `frontend-design` runtime contract used by that test. This preserves the test's intent without embedding a retired required-tool ID in a live schema fixture.

## Implementation

- `packages/opencorvus/src/session/loop.ts`: `selectJsonSchemaVariant()` now considers only required `const` properties when choosing a JSON Schema variant for provider null placeholder cleanup.
- `packages/opencorvus/test/session/extra-tools.test.ts`: adds the live `dispatch_agent target=build` polluted-input regression and strict rejection cases for non-null unknown fields and wrong optional literal values.
- `packages/opencorvus/test/session/extra-tools.test.ts`: replaces the stale `webpage_extract` skill fixture with canonical `bash`.

## Validation

- Pass: `bun test packages/opencorvus/test/session/extra-tools.test.ts -t "dispatch_agent target branches|strips GPT strict-schema null placeholders|keeps BuildResult local semantics" --timeout 120000`
- Pass: `bun test packages/opencorvus/test/session/extra-tools.test.ts -t "exact runtime contract skill tool" --timeout 120000`
- Pass: `bun test packages/opencorvus/test/session/extra-tools.test.ts --timeout 120000`
- Pass: `bun test packages/opencorvus/test/provider/schema-stress.test.ts --timeout 180000`
- Pass: `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts --timeout 180000`
- Pass after staging the new tracked record: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 180000`
- Pass: `bun run --cwd packages/opencorvus typecheck`
- Pass: `git diff --check`
