# Frontend Replica Worker Terminal Tool Projection Repair

Date: 2026-07-05
Status: Completed

## Recall

User request:

- Investigate why frontend replica broke after the recent refactor, fix it, and run end-to-end testing.
- Failed task: `tsk_f2e177aeb001f71ENBl962S01t`.
- Source URL: `https://www.tradingview.com/markets/world-economy/`.
- Project worktree: `C:\Users\chuan\myhexin-local\demos\economy\calculator`.
- Runtime DB: `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`.

Acceptance criteria:

- Explain the failure from real task/session/artifact evidence, not from the final `failed` label.
- Fix the root chain that prevented frontend replica from reaching source-evidence handoff.
- Preserve the no-fallback, no-gate, no-dual-source expert-squad architecture.
- Keep source-evidence stages strict: Orchestrator must not proceed to Build without valid frontend-research/frontend-design artifacts.
- Add regression tests proving worker terminal/output tools survive active expert-squad projection.
- Run focused tests plus an end-to-end task-flow validation that exercises frontend replica dispatch through real source-evidence stages.
- Re-review benchmark results before delivery.

Hard constraints:

- No fallback or compatibility path.
- No host-side gate or keyword route workaround.
- No git reset/revert/worktree creation.
- Do not restart, kill, or refresh existing OpenCorvus / overlay processes.
- Do not treat mocked contract tests alone as real E2E evidence.
- Specs stay under `specs/records/2026-07/`; update this month README.
- The personal `opencorvus-expert-squad-creator` skill is stale as implementation authority; current repository code, current architecture docs, current July records, and runtime DB evidence are authoritative.

Sources read:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-07/2026-07-04-architecture-issue-subagent-investigation.md`
- `specs/records/2026-07/2026-07-04-direct-build-outcome-and-visual-qa-contract.md`
- `specs/records/2026-07/2026-07-03-rendered-reference-acceptance-redesign.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- Runtime task/session/artifact/protocol rows from `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`
- Project package files under `C:\Users\chuan\myhexin-local\demos\economy\calculator\.opencorvus\expert-squads\frontend-replica`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/agent/tool-pool-contract.ts`
- `packages/opencorvus/src/research/agent.ts`
- `packages/opencorvus/src/frontend-research/agent.ts`
- `packages/opencorvus/src/frontend-design/agent.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `packages/opencorvus/test/agent/runner-prompt.test.ts`
- `packages/opencorvus/test/session/extra-tools.test.ts`

Whole-repository search evidence:

- `rg -n "tsk_f2e177aeb001f71ENBl962S01t|ses_0d1e88512ffe7vlatouKd1PRXH|frontend-replica|world-economy|tradingview" .scratch specs packages -g "*.txt" -g "*.md" -g "*.ts" -g "*.tsx" -g "*.json" -g "*.jsonc"`
- `rg -n "submit_research_brief|submit_frontend_template|terminal tool|terminalTool|terminal_tools|output tools|outputTools|AgentToolPool|tool kit|toolkit|create.*Tools|tools:" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.txt"`
- `rg -n "frontend-research|frontend-design|frontend_research|frontend_design" packages/opencorvus/src/agent packages/opencorvus/src/frontend-research packages/opencorvus/src/frontend-design packages/opencorvus/src/tool packages/opencorvus/src/session packages/opencorvus/test -g "*.ts" -g "*.txt"`
- `rg -n "resolveWorkerCapability|role_base|built_in_tool_ids|builtInToolIDs" packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/src/expert-squad/registry.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -g "*.ts"`
- `rg -n "projectWorkerTools\(|projectOrchestratorTools\(" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "createResearchOutputTools|createFrontendTemplateOutputTools|submit_architect|submit_requirements|terminalTool.*toolName" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`

Independent agent feedback:

- None. The current multi-agent tool policy allows spawning only when the user explicitly requests subagents/delegation; this request asked for repair and end-to-end testing, so the main agent kept the critical path local.

## Runtime Failure Evidence

The failed task selected the correct expert squad:

- `decision_log.phase=orchestrator`, `key=select_expert_squad` recorded `active_profile=frontend-replica`.
- The projected Orchestrator tool list included `frontend_research` and `frontend_design`.
- The root Orchestrator message loaded `frontend-replica-expert-squad` and called `select_expert_squad`.

The source webpage evidence layer itself ran:

- Protocol events show `frontend_research` materialized task runtime, extracted, compiled, analyzed, captured runtime state, and completed source package creation for the TradingView URL.
- The task runtime contains `fd/webpage-evidence` and `fd/web-clone-source`.

The failure happened after host evidence, inside worker agent runtime tool projection:

- `frontend_research` failed with `[frontend-research] terminal tool submit_research_brief is not registered in the agent tool kit`.
- `frontend_design` failed with `[frontend-design] terminal tool submit_frontend_template is not registered in the agent tool kit`.
- No goals were created, and no Build was dispatched, which is correct because proceeding without a source-backed brief or frontend-design handoff would invent the source page.

## Root Cause

Dynamic expert-squad capability projection now routes worker tool maps through `PromptProfileResolver.projectWorkerTools(...)`.

That function filters every tool in the supplied runtime map through `capability.builtInToolIDs`, default tool refs, package tool refs, and Model Context Protocol (MCP) refs. This is correct for registry/default/package/MCP tools, but it also filtered stage-owned runtime tools created by the worker agent itself:

- `submit_research_brief` plus `update_*` research output tools.
- `submit_frontend_template` plus `update_frontend_*` frontend-design output tools.
- The same class includes Requirements, Architect, Integrity reviewer, and Build finalizer/update tools.

Those tools are not expert-squad package capabilities and should not be encoded in every package manifest. They are the worker session's own output protocol. Treating them as projected built-in tools created a false missing-tool error before the model turn.

## Repair Plan

1. Extend `PromptProfileResolver.projectWorkerTools(...)` with an explicit `stageOwnedToolIDs` input.
2. Keep the default behavior strict: tools not in role-base, default refs, package refs, MCP refs, or `stageOwnedToolIDs` remain absent.
3. Make `runAgentSession(...)` pass stage-owned runtime tool IDs from the agent-provided toolkit so worker finalizer/update tools survive active expert-squad projection.
4. Keep collision checks explicit so stage-owned tools cannot silently replace projected default/package providers.
5. Add tests proving:
   - direct worker projection preserves explicitly declared stage-owned runtime tools and still drops undeclared sidecar tools;
   - runner-level active package profile preserves terminal tools such as `submit_research_brief` before prompting.

## Validation Plan

- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "stage-owned" --timeout 180000`
- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts --test-name-pattern "stage-owned|terminal" --timeout 180000`
- `bun test packages/opencorvus/test/session/extra-tools.test.ts --test-name-pattern "frontend-research|frontend-design" --timeout 180000`
- A task-flow E2E validation that creates a temporary frontend-replica project package, runs the Orchestrator frontend-research/frontend-design dispatch path far enough to prove the worker terminal tools are registered, and verifies source-evidence artifacts are produced rather than failing before agent prompt.
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 180000`
- `git diff --check`

## Validation Results

- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "stage-owned|frontend replica research" --timeout 180000` passed.
- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts --test-name-pattern "stage-owned terminal|terminal collector|protocol misses|provider errors|continuation loop" --timeout 180000` passed.
- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts --timeout 180000` passed.
- `bun test packages/opencorvus/test/frontend-design/agent-process.test.ts --timeout 180000` passed.
- `bun test packages/opencorvus/test/research/agent-runtime-root.test.ts --test-name-pattern "continuation hydrates" --timeout 180000` passed.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "frontend_research returns a visible failure card|frontend_research marks a persisted failed child session terminal|respond_agent_coordination redispatch starts the frontend-research stage dispatcher|respond_agent_coordination redispatch starts the frontend-design stage dispatcher" --timeout 180000` passed.
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts --timeout 180000` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 180000` passed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `git diff --check` passed; Git reported existing CRLF conversion warnings only.
