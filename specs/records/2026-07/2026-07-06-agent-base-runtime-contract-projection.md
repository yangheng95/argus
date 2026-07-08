# Agent Base Runtime Contract Projection

Date: 2026-07-06
Status: Implementation record
Owner: Codex

Supersession note: `2026-07-06-expert-squad-namespaced-source-layout.md` supersedes this record's direct-child package path. Non-`general` expert squads now live under `.opencorvus/expert-squads/<namespace>/<id>/`; the base-runtime projection constraints remain historical context.

## Glossary

- API: Application Programming Interface, the TypeScript or route contract between modules.
- MCP: Model Context Protocol, the protocol for exposing external tools, prompts, and resources to agents.
- UI: User Interface.
- Runtime kernel: The OpenCorvus host runtime that owns sessions, workflow tools, tool execution, submit protocol, and artifacts.
- Base role: A stable `AgentRoleID` declared by `AgentRoleContract`.
- Runtime projection: A read-only derived view of existing role, tool-pool, workflow, and expert-squad package projection capability.

## Recall

### User Request

The user asked to continue implementing the expert-squad runtime-package direction while using independent agents to review changes during implementation.

The latest approved direction is:

- Do not overfit the platform to `software-testing`.
- Keep `frontend-research` and `frontend-design` as base roles because they own custom host tools and submit protocol.
- Do not move already implemented expert-squad protocols into a new external mount directory.
- Expert-squad runtime should be self-contained inside the package where possible.
- MCP package-local config should be read from the active expert squad and projected automatically.
- Virtual agents should instantiate display/prompt identity on top of base roles, not define workflow, host tools, completion, or artifact ownership.
- New complex host-level behavior requires a base runtime contract; package-defined global roles remain forbidden.

### Acceptance Criteria

- The implementation must not introduce a second role contract table.
- Existing `AgentRoleContract`, `AgentToolPool`, and `WorkflowRegistry` remain the single authoring sources for role identity, host tools, and scheduler workflow bindings.
- Any new API must be a read-only projection derived from those sources.
- The projection must describe package projection capability without letting packages define host tools, workflow tools, submit protocol, or artifact ownership.
- `PromptProfileResolver` remains the only runtime expert-squad projection surface.
- No fallback, alias, inactive package scan, `config.agent` mutation, global `AgentRoleID` expansion, second workflow, hidden message, or synthetic context packet is added.
- Independent agents must review the implementation diff before commit.

### Hard Constraints

- Non-`general` expert squads remain project packages under `.opencorvus/expert-squads/<id>/`.
- `prompt_profile.active` remains the active expert-squad selection source.
- Package-local protocols stay package-local.
- Terminal submit tools are currently stage-owned runtime tool contracts passed by agent modules to `runAgentSession`; this phase must not duplicate those names into a static contract table.
- Host tool lists are owned by `AgentToolPool`; this phase must not add package-owned host tool extension.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- An untracked July planning draft was observed as background user notes only and is not a committed source for this record.
- `specs/records/2026-07/2026-07-06-self-contained-expert-squad-runtime.md`
- `specs/records/2026-07/2026-07-06-dynamic-expert-agent-instance-review-plan.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/agent/tool-pool-contract.ts`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/session/agent-runtime-metadata.ts`
- `packages/opencorvus/src/browser-preview/persist.ts`
- `packages/opencorvus/src/visual-qa/annotated-screenshot.ts`
- `packages/opencorvus/test/agent/role-contract.test.ts`
- `packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
- `packages/opencorvus/test/session/runtime-contract-tools.test.ts`
- `packages/opencorvus/test/visual-qa/output-tools.test.ts`
- `packages/opencorvus/test/server/browser-preview-routes.test.ts`

### Repository Search Evidence

- `rg -n "AgentRoleContract|AgentRoleID|taskWorkerIDs|agentOwnedTaskWorkerIDs|skillMountable|promptProfileTarget|terminal|submit|completion|workflow" packages/opencorvus/src packages/opencorvus/test`
  - Finding: role identity, prompt profile targeting, runtime contract requirement, continuation, direct reply, and live ownership flags already converge on `AgentRoleContract`.
- `rg -n 'submit_.*report|report_build_result|submit_frontend_design|submit_visual_qa|terminalTool|terminalToolName|writableArtifacts|artifact.*kind|AgentToolPool|defaultRuntimeToolSwitches|stageOwnedToolIDs|runtimeContractRequired|exactRuntimeContract' packages/opencorvus/src packages/opencorvus/test -g '*.ts'`
  - Finding: host tool pools are centralized in `AgentToolPool`, while terminal finalizers are still stage-owned runtime contracts passed to `runAgentSession` by individual agent modules.
- `rg --files packages/opencorvus/test packages/opencorvus/src | rg "(role-contract|agent-role|workflow|runner|tool-pool|runtime-contract|submit|artifact).*\\.(test\\.)?ts$"`
  - Finding: existing tests already guard role registration, workflow binding, runtime metadata, tool-pool ownership, and runner tool scoping.

### Independent Agent Review

Two read-only agents were launched for this implementation:

- Runtime/base-role review: audit `AgentRoleContract`, runner, workflow, terminal submit tools, artifacts, and completion semantics; identify the minimal implementation that avoids a second contract.
- Expert-squad/resolver review: audit resolver/registry/catalog boundaries and recent package-local MCP projection; identify scalability risks and tests.

Round 1 feedback applied before commit:

- Runtime/base-role review found that `AgentRoleContract.all`, `AgentRuntimeMetadata`, `runAgentSession`, `WorkerTurnDescriptor`, and `SessionRuntimeContract.identity.agentKind` already derive runtime identity from base roles. Resolution: this change adds only a derived projection and does not accept virtual IDs as runtime role IDs.
- Runtime/base-role review warned that workflow binding is owned by `WorkflowRegistry`, host tools by `AgentToolPool`, and terminal finalizer names are stage-owned `runAgentSession` inputs. Resolution: the projection composes those existing sources and intentionally does not author terminal finalizer names, artifact ownership, or completion semantics.
- Expert-squad/resolver review confirmed that active expert-squad projection still belongs to `PromptProfileResolver`, with active package selection from `prompt_profile.active` and no inactive package materialization. Resolution: this base-runtime projection remains outside manifest/package input and does not load expert-squad package resources.
- Expert-squad/resolver review flagged scalability risk if catalog or UI treats raw manifest refs as effective runtime projection. Resolution: future UI/API work must expose resolver-owned effective projection, especially for expanded package-local MCP server refs.
- Both reviews rejected package-defined global roles, second active state, package-owned workflow, global MCP config writes, and any static table that duplicates existing runtime facts.

Final diff review feedback applied before staging:

- Runtime review found no blocking issue: `AgentBaseRuntimeContract` remains a derived view and `virtualAgent` is only package-local display/prompt metadata capability.
- Resolver review found no code-side boundary issue: the base-runtime projection does not read manifests, scan packages, touch `PromptProfileResolver`, or mutate `config.agent`.
- Both reviews accepted the Visual QA change as a strict runtime-relative evidence fix rather than a fallback.
- Resolver review flagged that `specs/records/2026-07/README.md` currently contains unrelated untracked record links. Resolution: stage only the base-runtime record index line for this commit and leave unrelated README lines and untracked records untouched.

## Diagnosis

Phase 1 is partly already implemented. `AgentRoleContract` is the role identity and runtime metadata source. `AgentToolPool` is the host tool source. `WorkflowRegistry` is the scheduler workflow binding source. `AgentRuntimeMetadata` derives session runtime metadata from `AgentRoleContract`.

The missing piece is an explicit, read-only projection that makes this current base runtime contract observable and testable as a composed view without creating a new source of truth.

This projection must not capture terminal finalizer names yet because those are still owned by each agent module's `runAgentSession` call. Capturing them in a new static map would create the second source this phase is meant to avoid.

## Implementation Decision

Add a derived base-runtime projection module that composes:

- role metadata from `AgentRoleContract`
- host tool assignment from `AgentToolPool`
- scheduler workflow tools from `WorkflowRegistry`
- package projection capability from existing role fields

The projection is not manifest input, not configuration, and not package-owned metadata. It is a diagnostics/test surface for the runtime kernel and a future guardrail for virtual-agent implementation.

Local verification exposed two adjacent guardrail repairs:

- `subagent-infrastructure-homogeneity.test.ts` still asserted direct selector discovery through `ExpertSquadRegistry.discover(projectDirectory)`. The current source correctly centralizes project package discovery in `discoverProjectPackages`, so the test now asserts that selector catalog uses the helper and that the helper owns the registry discovery call.
- Visual QA annotation had begun accepting absolute browser-preview screenshot paths. The repair keeps `annotated-screenshot.ts` strict by resolving only runtime-relative browser-preview evidence paths, then fixes the real source by making `browser-preview/persist.ts` normalize camelCase `screenshotPath` and `implementationScreenshotPath` refs the same way it already normalizes snake_case refs.

## Test Plan

- Unit test the projection for key roles:
  - `build` has base session kind `build`, scheduler workflow tool `build`, runtime contract required, package projection enabled, and host tools from `AgentToolPool`.
  - `frontend-design` and `frontend-research` remain base roles, not virtual-agent-only identities.
  - `general` has no scheduler workflow binding and no package runtime provider projection, while prompt overlay remains allowed.
  - `orchestrator` remains host-owned and not package virtual-agent mountable.
- Source-hygiene test:
  - The projection module must import `AgentRoleContract`, `AgentToolPool`, and `WorkflowRegistry`.
  - It must not contain hard-coded terminal finalizer names such as `report_build_result`, `submit_frontend_template`, or `submit_visual_qa_report`.
- Existing verification:
  - `bun test packages/opencorvus/test/agent/role-contract.test.ts`
  - `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  - `bun test packages/opencorvus/test/session/runtime-contract-tools.test.ts`
  - `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts`
  - `bun test packages/opencorvus/test/server/browser-preview-routes.test.ts`
  - focused expert-squad resolver tests if touched
  - `bun run --cwd packages/opencorvus typecheck`
  - `git diff --check`
