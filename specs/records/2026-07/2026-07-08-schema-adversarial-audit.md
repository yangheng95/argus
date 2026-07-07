# Scheduler Schema Adversarial Audit

Date: 2026-07-08
Status: Implemented
Owner: Codex

## Glossary

- API: Application Programming Interface, the typed contract exposed by a route, tool, or library.
- CRLF: Carriage Return Line Feed, the Windows text-file newline sequence.
- DB: Database, the persistent SQLite store used by OpenCorvus.
- GPT: Generative Pre-trained Transformer, the model-family signal used by OpenAI-compatible strict tool schemas.
- ID: Identifier, a stable string used to address a task, session, goal, package, tool, or row.
- JSON: JavaScript Object Notation, the structured data format used for provider tool arguments and schemas.
- LF: Line Feed, the Unix text-file newline sequence.
- LLM: Large Language Model, the model that selects tools and writes assistant messages.
- MCP: Model Context Protocol, the protocol used to expose scoped tools, prompts, and resources.
- PID: Process Identifier, the operating-system number assigned to a running process.
- QA: Quality Assurance, the verification phase or agent role that checks completed behavior.
- UI: User Interface, the visible application surface.

## Recall

### User Request

The user asked why the long crypto trading Mission appeared stuck, then clarified that they cancelled it and wanted the scheduler stall investigated: schema confusion, unclear contracts, and errors must be inspected deeply. The user then required independent adversarial agents until no new issue was found.

The provided task debug packet identified:

- task ID `tsk_f3d6469fd001JiT1CT5N1DoWj8`
- title `Phase 02: Backend and Data Foundation`
- status `cancelled`
- root session `ses_0c29b95ffffeFhYtVnzNPJz3fO`
- run ID `run_f3d6f820e001s9j9D4V1PDsQa4`
- runtime DB `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`
- project worktree `C:\Users\chuan\myhexin-local\demos\economy\crypto`
- only goal #1 passed; goals #2 through #7 stayed pending

Cancellation at 2026-07-07 16:55:29Z is terminal evidence only. It is not the root cause.

### Mission Criteria Preserved

The underlying Mission required a real local crypto trading-system demo, not placeholder UI or hard-coded data. The backend/data phase needed real DB schema, seed/init scripts, market data APIs, realtime push, local matching, balances, frozen funds, fills, and strict schema validation. The debugging acceptance criteria for this repair were:

- explain the scheduler stall with evidence instead of blaming cancellation
- reproduce and repair the `dispatch_agent target=build` schema loop
- search for adjacent schema confusion, not just patch the first failing field
- preserve strict local validation and reject wrong non-null fields
- avoid fallback, compatibility aliases, route gates, or a second dispatch source
- use independent adversarial agents until they stop finding new issues
- add tests that prove the failure shape and neighboring contracts

### Hard Constraints

- No fallback logic and no silently tolerated invalid schema shape.
- No broad `git reset`, no unrelated file revert, and no new worktree.
- Do not restart, close, refresh, or kill running OpenCorvus or overlay processes.
- Tests must use real inactivity or process completion, not mechanical startup timers.
- Specs must stay under `specs/records/2026-07/` and be indexed by the monthly README.
- Code changes require tests. Passing benchmark output still requires a second review.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/artifacts/长程编排测试.md`
- `specs/records/2026-07/2026-07-08-dispatch-agent-null-schema-pollution.md`
- `specs/records/2026-07/2026-07-08-expert-squad-selector-contract-completion.md`
- `specs/records/2026-07/2026-07-07-unified-scheduler-dispatch-tool.md`
- `specs/records/2026-07/2026-07-07-dispatch-agent-projected-target-schema.md`
- `specs/records/2026-07/2026-07-02-optional-build-worktree-schema.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- Runtime DB rows and task/session evidence for `tsk_f3d6469fd001JiT1CT5N1DoWj8`

### Whole-Repository Search Evidence

- `rg -n "selectJsonSchemaVariant|stripNullOptionalsFromJsonSchema|shouldStripProviderNullOptionals|requiresOpenAIStrictToolSchema|normalizeOpenAIStrictToolSchema" packages/opencorvus/src packages/opencorvus/test -S`
  - Finding: provider strict-schema null cleanup had been split between provider schema production and runtime execution cleanup. That split was collapsed to one predicate.
- `rg -n "dispatch_agent|directBuildIntent|goalID|target_agent|fact_check_items|reason" packages/opencorvus/src/orchestrator packages/opencorvus/test/orchestrator packages/opencorvus/test/session -S`
  - Finding: `dispatch_agent` is the scheduler-owned worker dispatch surface. Several targets allowed empty or omitted `reason`, which made provider strict-schema normalization less falsifiable.
- `rg -n "active_skill_projection|projected_tool_ids|projected_skill_names|production_skill_names|package_mcp_server_refs|virtual_agents|capability_projection" packages/overlay/test packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad -S`
  - Finding: overlay tests had fixture-only catalog shapes that could mix manifest refs, runtime provider IDs, virtual-agent identity, and resolver output in one object. Those fixtures could make invalid projections appear valid.
- Runtime DB and log inspection for task `tsk_f3d6469fd001JiT1CT5N1DoWj8`
  - Finding: repeated schema failures occurred before cancellation. Goal #2 never received a successful build worker.

## Evidence Chain

Observable symptom:

- Phase 02 was cancelled by the user at 2026-07-07 16:55:29Z after appearing stuck.

Direct trigger:

- Goal #1 passed.
- Goal #2, `Decimal utilities, config validation, and API error contract`, remained pending.
- The Orchestrator repeatedly tried to call `dispatch_agent` for `target: "build"` and failed local input validation.

Representative failed payload:

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

Deep cause:

- GPT-compatible strict tool schemas require optional fields to appear as nullable provider-facing properties.
- Runtime execution must remove provider-injected `null` placeholders before validating against the original local schema.
- The discriminated-union branch selector previously treated every `const` property as a discriminator.
- `directBuildIntent: "modify_files"` is an optional branch-local literal, not the `dispatch_agent` discriminator.
- With `directBuildIntent: null`, the selector failed to select the build branch, so null placeholder cleanup did not run.
- The polluted provider payload reached local Zod validation and repeatedly failed.

Why the first repair was not enough:

- It fixed the branch selector, but adversarial review found adjacent schema risk:
  - strict provider detection still had duplicate predicates
  - some dispatch targets accepted missing or empty `reason`
  - OpenAI-compatible `o*` and `chatgpt-*` model IDs were not covered by the strict predicate
  - `fact_check` could carry a `target_agent` assertion that disagreed with the real target session kind
  - overlay expert-squad fixtures still allowed invalid projected shapes that production resolvers would not emit

## Adversarial Agent Rounds

Round 1:

- Found provider strict null pollution as the scheduler blocker.
- Found overlay fixture raw refs and live DB evidence of repeated build schema failures.

Round 2:

- Found the need for a single strict-schema predicate and all-target null cleanup tests.
- Found `fact_check target_agent` mismatch should be rejected against the target session kind.

Round 3:

- Found OpenAI-compatible `o*` and `chatgpt-*` model IDs were missing from strict cleanup parity.
- Found old `architect` tool tests missing required `reason`.
- Found overlay mount matrix projected/mountable mismatch and active projection omissions.

Round 4:

- Found untracked helper risk and empty build/frontend-design reason acceptance.
- Found overlay fixtures conflating `virtual_agents` identity with `capability_projection.agents`.

Round 5:

- Found `frontend_design` still accepted empty `reason`.
- Found `active_skill_projection` could still be synthesized from partial fixture data.

Round 6:

- Found no new schema issue beyond staging the helper.
- Confirmed `active_skill_projection` should require complete resolver-shaped payloads when the active squad has capability surfaces.

Round 7:

- Found runtime `projected_tool_ids` still needed to reject ref-shaped IDs.
- Found `production_skill_names` and `projected_skill_names` still used refs in panel fixtures.

Final pass:

- Found no new blocking or near-blocking schema/projection issue.
- Confirmed `projected_tool_ids` rejects refs, active projection validation calls that guard, skill names are names rather than refs, and package refs remain only in package-ref projection fields.

## Repairs

### Provider Strict Schema Single Source

- Added `packages/opencorvus/src/provider/strict-tool-schema.ts`.
- `ProviderTransform` and `SessionLoop` now both use `requiresOpenAIStrictToolSchema()`.
- The predicate covers OpenAI, Azure, and OpenAI-compatible `gpt-*`, `chatgpt-*`, and `o*` model IDs while keeping non-GPT compatible providers out.

### Scheduler Tool Schema Tightening

- `dispatch_agent` stage targets now require non-empty `reason` where a reason field exists.
- `frontend_design`, `build`, `integrity`, `requirements`, `architect`, `workload_analysis`, `analyze_intent`, and `explore` reject empty `reason`.
- `fact_check` continues to require the stronger fact-check-specific minimum.
- Tests cover all current dispatch targets for null placeholder cleanup and empty reason rejection.

### Fact-Check Target Scope

- Added regression coverage that rejects `dispatch_agent target=fact_check` when `target_agent` disagrees with the target session kind.
- This prevents caller-authored target claims from overriding durable session identity.

### Expert-Squad Projection Fixture Hardening

- Extracted expert-squad runtime provider ID derivation to `packages/opencorvus/src/expert-squad/provider-names.ts`.
- Overlay fixtures now use those same provider-name functions instead of inventing local IDs.
- `virtual_agents` is now identity only in fixtures; capability surfaces must live under `capability_projection.agents`.
- Active skill projection must be a complete resolver-shaped payload when the active squad has projected capability surfaces.
- `projected_tool_ids` rejects refs with `/` or `.`, and rejects retired `exec_command`.
- Fixture production shape rejects `default_mcp_server_refs` and duplicate typed MCP refs already covered by `package_mcp_server_refs`.

## Validation

Passed:

- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/opencorvus/test/session/extra-tools.test.ts packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/provider/schema.test.ts packages/opencorvus/test/provider/schema-stress.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts --timeout 180000`
- `bun test --timeout 120000 packages/overlay/test/expert-squad-fixture.test.ts`
- `node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts test/browser/skill-mount-matrix-browser.test.ts` from `packages/overlay`

Incomplete and not counted as pass:

- `bun test packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 180000`
- The combined server-route test run reached a Windows temp cleanup `EBUSY` hang after test activity. The hung process was matched to the exact test command and stopped. This is a test-runner cleanup issue to investigate separately, not evidence that these server-route suites passed.

## Worktree Notes

- Unrelated dirty file left untouched: `packages/opencorvus/src/provider/models-snapshot.ts`.
- Unrelated untracked artifact left untouched: `specs/artifacts/expert_provider.zip`.
- No OpenCorvus or overlay runtime process was restarted or killed.
- No fallback, compatibility alias, dispatch gate, or second source of truth was added.
