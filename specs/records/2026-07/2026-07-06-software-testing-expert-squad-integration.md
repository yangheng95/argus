# Software Testing Expert Squad Integration

Date: 2026-07-06
Status: Superseded by `2026-07-06-global-virtual-agent-opentest-adaptation.md` and `2026-07-06-opentest-contract-engine.md`.

Supersession note: this record documents the first `software-testing` integration. The current implementation replaces the old `software-testing/shared/test-protocol-contract` tool with one external contract file plus a dynamic protocol engine, and trims `software-testing` projection to only the active roles that have real overlays, skills, tools, or virtual-agent bindings. Do not use this record as the current protocol source.

Glossary:

- API means Application Programming Interface.
- GUI means Graphical User Interface.
- ID means Identifier.
- JSONC means JavaScript Object Notation with Comments.
- MCP means Model Context Protocol.
- SUT means System Under Test.
- UI means User Interface.

## Recall

### User Request

Analyze `C:\Users\chuan\myhexin-local\iwc-aigc-test-agent` as the reference repository, then integrate its software-testing agent functionality into OpenCorvus.

The requested integration must:

- Generate a new testing agent according to the project agent construction rules.
- Define the context input/output protocol and the agent's position/order in the workflow.
- Determine tool registration and availability.
- Implement the custom tool required by the agent runtime.
- Write the software testing expert squad workflow prompt according to a real software testing process.
- Export the result to `.opencorvus/expert-squads`.
- Test that the chain is connected.

User clarification during implementation: the integration does not need to create many new sub-agents to work. Functional coverage should come from the software-testing protocol, package tools, artifact evidence, and existing OpenCorvus workflow roles rather than a one-to-one replication of OpenTest's internal `tester`, `script-writer`, and `failure-handler` agent boundaries.

### Acceptance Criteria

- The reference repository is used as source evidence, not as the implementation target.
- OpenCorvus receives a new non-`general` expert-squad package under `.opencorvus/expert-squads/software-testing/`.
- The package validates through `ExpertSquadRegistry.loadPackage`.
- The package selector is visible from `general` skill projection and can select `software-testing`.
- The active `software-testing` scheduler projection exposes the intended existing workflow tools plus package-local tools.
- The active package does not create a second workflow engine, hidden route, fallback profile, or custom agent role rejected by the current registry.
- Package-local tools compile through the current `@opencorvus-ai/plugin` ToolDefinition ABI and are executable through `PromptProfileResolver.projectOrchestratorTools` / `projectWorkerTools`.
- Payload release includes `software-testing` so empty projects can receive the package through the existing payload path.
- Tests cover package validation, payload freshness, catalog/skill projection, and package tool execution.
- The integration does not claim that OpenTest's internal sub-agent topology is required for correctness; OpenCorvus v1 coverage is validated by protocol/tool/artifact behavior through existing roles.

### Hard Constraints

- No fallback or compatibility logic.
- No second active expert-squad source; `prompt_profile.active` remains the only active selection field.
- No global `PromptProfile.builtIns` expansion for non-`general` squads.
- No package-defined custom role such as `tester` or `script-writer`; current `ExpertSquadRegistry` rejects unknown agent roles.
- No second workflow, dispatcher, context-packet system, hidden message, or task manipulation layer.
- Use existing `WorkflowRegistry` tools and existing agent roles. The software testing process is expressed as package README, selector, role overlays, package skills, and package tools.
- Do not overfit the integration to OpenTest's sub-agent count. Keep the runtime surface small unless a concrete missing capability requires expanding `AgentRoleContract`.
- Package tools stay under the active package projection and must not enter the flat `ToolRegistry`.
- Specs stay under `specs/records/2026-07/`; update the monthly README.

### Sources Read

| Source | Finding carried forward |
| --- | --- |
| `AGENTS.md` | Expert squads are dynamic project packages; manifest ID is identity; `prompt_profile.active` is selection; `PromptProfileResolver` owns projection; no fallback, no gate, no custom hidden workflow. |
| `specs/README.md` | New records must live under `specs/records/YYYY-MM/` with Recall. |
| `specs/current/architecture/04-extensions.md` | Expert squads are internal capability packages, not external plugins or ordinary Codex skills. Workflow remains `WorkflowRegistry`. |
| `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md` | Current package architecture: `.opencorvus/expert-squads/<id>`, README as Orchestrator append prompt, selector as inactive discovery source, package tools/MCP/skills through resolver. |
| `specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md` | Active squad changes scheduler tools, skills, dispatchable roles, and skill-mount visibility through capability projection. |
| `specs/records/2026-07/2026-07-05-expert-squad-payload-seeding-and-skill-refresh.md` | Non-`general` repository squads are payload-released into projects without overwrite and then discovered normally. |
| `specs/records/2026-07/2026-07-06-expert-squad-decoupling-agents-rule.md` | Domain rules belong in package README, selector, role overlays, skills, tools, and MCP; global core prompts must not absorb domain policy. |
| `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md` | Expert-squad work requires checklist, dated record, callpoint inventory, implementation plus tests. |
| `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md` | Required files, package identity rules, manifest/projection rules, payload release rules, and validation commands. |
| `C:\Users\chuan\myhexin-local\iwc-aigc-test-agent\CLAUDE.md` | OpenTest model: `TEST.md` + `script.ts`; stable `ctx` abstraction; Plan designs tests, Execute runs/debugs; stale script vs real bug distinction. |
| `iwc-aigc-test-agent/docs/test-case-structure.md` | Test case contract: `TEST.md`, `script.ts`, `.opentest/ctx.d.ts`, `KNOWLEDGE.md`, testPoints, status, severity, and run artifacts. |
| `iwc-aigc-test-agent/docs/run-test.md` | Execution flow: parse `TEST.md`, build ctx, load script, execute steps, produce result artifacts and acceptance sheet. |
| `iwc-aigc-test-agent/packages/opencode/src/session/prompt/opentest-orchestrator.txt` | Orchestrator owns planning and coordination, drafts `TEST.md`, delegates exploration/script writing/failure handling, and reports progressively. |
| `iwc-aigc-test-agent/packages/opencode/src/agent/opentest/tester.txt` | Tester role enriches draft tests with live behavior, updates knowledge, and does not write `script.ts`. |
| `iwc-aigc-test-agent/packages/opencode/src/agent/opentest/script-writer.txt` | Script writer reads ctx contract and TEST.md, writes `script.ts`, runs tests, debugs until pass or confirmed real bug. |
| `iwc-aigc-test-agent/packages/opencode/src/agent/opentest/failure-handler.txt` | Failure handler classifies stale script vs real bug from TEST.md, script, and latest result. |
| `packages/opencorvus/src/expert-squad/registry.ts` | Manifest schema, role validation, package ref validation, selector rules, package tool and MCP ref collection. Unknown package roles are rejected. |
| `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` | Active package projection, package tool bundling/execution, selector skill projection, catalog, and prompt composition. |
| `packages/opencorvus/src/expert-squad/payload.ts` | Existing payload source must be updated if the new repository package should be released into empty projects. |
| `packages/opencorvus/src/engine/workflow.ts` | Current workflow IDs are `direct` and `pipeline`; workflow tool names are fixed. Expert squads must not create a second workflow system. |
| `packages/opencorvus/src/agent/tool-pool-contract.ts` | Canonical built-in tool IDs and role base tool surfaces. Scheduler workflow tools require matching agent projections. |
| `packages/plugin/src/tool.ts` | Package tools must export `tool({ description, args, execute })` from `@opencorvus-ai/plugin` and return a string. |

### Repository Search Evidence

| Command | Finding |
| --- | --- |
| `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test` | Existing repository packages are `algorithm`, `backend`, `frontend-automation-debug`, `frontend-innovate`, and `frontend-replica`; package tests cover registry, manager, resolver, routes, and overlay surfaces. |
| `rg -n "ExpertSquadRegistry\|ExpertSquadPackageManager\|PromptProfileResolver\|expert-squads\|expert-squad.jsonc\|prompt_profile.active\|select_expert_squad\|active_skill_projection\|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records` | Expert squad identity, active selection, resolver projection, catalog, payload release, and overlay skill projection are already single-source surfaces. |
| `rg -n "packageTools\|schedulerPackageTools\|workerPackageTools\|ToolDefinition\|must export default ToolDefinition\|packageToolProviderName" packages/opencorvus/src/expert-squad packages/opencorvus/test` | Package tools are compiled with Bun, loaded only through active resolver projection, provider-named by hashed refs, and rejected when the default export is not a plugin ToolDefinition. |
| `rg -n "payloadPackageSources\|payload source\|releasePayloadPackages\|repositoryExpertSquadRoot" packages/opencorvus/src packages/opencorvus/test` | Payload freshness tests compare `payload.ts` file contents against repository `.opencorvus/expert-squads/<id>` packages, and empty-project catalog routes release payloads. |
| `rg -n "ctx.mark_point\|mark_point\|testPoints\|TEST.md\|script.ts\|run_test\|report_test\|OpenTest" C:/Users/chuan/myhexin-local/iwc-aigc-test-agent/docs C:/Users/chuan/myhexin-local/iwc-aigc-test-agent/CLAUDE.md C:/Users/chuan/myhexin-local/iwc-aigc-test-agent/packages/opencode/src/session/prompt C:/Users/chuan/myhexin-local/iwc-aigc-test-agent/packages/opencode/src/agent/opentest C:/Users/chuan/myhexin-local/iwc-aigc-test-agent/packages/opencode/src/tool/test` | The reference functionality centers on test case structure, ctx contract, plan/execute split, run result artifacts, and stale-script vs real-bug failure analysis. |

### Design Boundary

The new testing capability will be integrated as `software-testing`, a package-backed expert squad. It will not add a custom `tester` or `script-writer` role because the current OpenCorvus registry rejects package-defined custom agents. Instead:

- `requirements` owns test requirements, scenario inventory, severity, and testPoint acceptance criteria.
- `architect` owns decomposition into test implementation goals and traceability.
- `build` owns test artifact implementation, execution/debug loop, and command evidence.
- `visual-qa` owns GUI visual/behavioral evidence for UI tests.
- `integrity` owns the final testing evidence review and stale-script vs real-bug classification.
- `fact-check` verifies external facts such as API contracts, versions, or runtime claims when needed.
- `orchestrator` coordinates the process using the package README, selector, skills, package tools, and existing workflow tools.

The initial package tools will be:

- `software-testing/shared/test-artifact-inventory`: inspect the current project or a scoped test root for `TEST.md`, `script.ts`, `.opentest/ctx.d.ts`, knowledge files, result artifacts, and test-related package scripts.
- `software-testing/shared/test-protocol-contract`: produce the structured software-testing context protocol for the selected SUT and test scope, using existing OpenCorvus workflow stage names rather than creating a new workflow engine.

### Validation Results

- `bun test packages/opencorvus/test/expert-squad/registry.test.ts` passed.
- `bun test --timeout 20000 packages/opencorvus/test/expert-squad/package-manager.test.ts` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "software-testing|releases payload package selectors"` passed for the new active package projection and payload selector checks.
- `bun test --timeout 30000 packages/opencorvus/test/server/expert-squad-routes.test.ts` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `git diff --check` passed.
- The stale-role search over `payload.ts`, the `software-testing` package, expert-squad tests, and this record returned no matches for removed mission/explore package-role imports or the retired combined explore/deep-research workflow label.
