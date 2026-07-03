# Expert Squad Capability Profile

Date: 2026-07-03

Status: design record pending implementation.

Glossary:

- API means Application Programming Interface.
- DB means Database.
- LLM means Large Language Model.
- MCP means Model Context Protocol.
- SDK means Software Development Kit.
- UI means User Interface.

## Recall

User request:

- The user rejected the prompt-only expert-squad design: "我要的是薄general，厚专家团prompt".
- The user then clarified that tool / skill / scheduler-agent availability must change with the active expert squad and must not expose a large pile at once.
- The current request is to design a mature solution and use independent agents to expand the review impact surface.

Acceptance criteria:

- `general` is thin. It must not carry domain-heavy prompts or expose domain workflow dispatch tools by default.
- Expert squads are thick. The active expert squad owns role-scoped prompt overlays and the scheduler capability surface.
- The active expert squad changes:
  - Orchestrator visible tool IDs.
  - Orchestrator visible expert-squad / workflow skills.
  - The scheduler's dispatchable agent roles, derived from visible workflow tools.
  - UI skill-mount and prompt-profile views that describe the effective profile.
- `select_expert_squad` remains the visible write path for profile selection. It must not mutate per-agent prompt fields, session tool overrides, model settings, workflow state, or permissions.
- No fallback, compatibility, hidden message fork, hidden routing, keyword classifier, host-side gate, route-local whitelist, or double source is allowed.
- Same-turn selection must be explicit: a tool set installed for one LLM call cannot gain new tools midway through that call. Selection must schedule a visible continuation wake or otherwise prove the next Orchestrator wake uses the projected capability surface.
- UI cells for unavailable skill mounts must not persistently show plus glyphs. Available but inactive mount cells show the plus only on hover / focus / active combination.

Hard constraints read:

- `AGENTS.md` forbids fallback, compatibility, double source, host-side gates, hidden messages, state-machine routing, unreviewed patches, and worktree creation without user authorization.
- `opencorvus-expert-squad-creator` skill requires this dated record, a `Recall` section, full callpoint search, prompt-profile / skill / Orchestrator / tests inventory, and independent-agent feedback.
- Existing current architecture says tool visibility is owned by `AgentToolPool` / runtime contracts, not prompt text. The new design must move capability ownership into a typed prompt-profile capability projection rather than making prompt prose pretend tools changed.

Sources read:

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-06/2026-06-30-thick-expert-squad-prompts.md`
- `specs/records/2026-06/2026-06-24-orchestrator-expert-squad-skill.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/current/architecture/17-agent-team-infrastructure.html`
- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/src/agent/tool-pool-contract.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/skill/mounts.ts`
- `packages/opencorvus/src/tool/skill.ts`
- `packages/opencorvus/src/server/routes/skill.ts`
- `packages/opencorvus/src/server/routes/config.ts`
- `packages/opencorvus/src/config/prompt-catalog.ts`
- `packages/overlay/src/services/extensions.ts`
- `packages/overlay/src/components/settings/SkillMarketPanel.tsx`
- `packages/overlay/src/styles/surfaces/settings.css`
- `packages/overlay/src/main.tsx`

Repository search evidence:

| Command | Finding |
| --- | --- |
| `rg -n "PromptProfile\|builtIns\|PromptProfileDefinition\|PromptProfileOverlay\|DEFAULT_PROMPT_PROFILE_ID\|composeAgentPrompt\|activePromptProfile\|prompt_profile" packages/opencorvus/src/agent/prompt-profile.ts packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs -S` | `DEFAULT_PROMPT_PROFILE_ID` is `frontend-replica`; schema stores `label`, `description`, `agents` only; overlay state carries only `active`; overlay UI initializes `activePromptProfile` to `frontend-replica`; many tests and SDK snapshots pin `frontend-replica` as default. |
| `rg -n "frontend-replica-expert-squad\|frontend-innovate-expert-squad\|frontend-automation-debug-expert-squad\|builtin-skills\|required_tools\|mounted_agents\|SkillMount\|skill/mounts\|loadSkillMountMatrix" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -S` | Built-in Orchestrator expert-squad skills are mounted only to `orchestrator` and require only `select_expert_squad`; `/skill/mounts` returns a matrix from `mounted_agents`, `required_tools`, permissions, and static agent tool pools. It does not read active profile capability. |
| `rg -n "ORCHESTRATOR_PRIVATE_TOOL_IDS\|createOrchestratorTools\|toolGuard\|setSessionRuntimeContract\|usesExactRuntimeContractTools\|AgentToolPool\|visibleToolIDs\|ToolRegistry\\.tools\|enableMap\|runtime contract\|exact runtime" packages/opencorvus/src packages/opencorvus/test specs -S` | Orchestrator receives a static private tool list in `AgentToolPool`; `orchestrator/agent.ts` creates all Orchestrator tools, wraps them in `toolGuard`, enables every key, and installs that exact tool map into the session runtime contract; `SessionLoop.usesExactRuntimeContractTools` skips registry tools for Orchestrator wake contracts. |
| `rg -n "prompt-only\|only changes? prompt\|does not.*tools\|TOOLS.*不受专家团\|只有 prompt\|does not change tools\|model / workflow\|workflow / tool\|MCP\|no workflow\|do not add a new agent/tool/workflow\|prompt profile.*tool" specs packages/opencorvus/test packages/opencorvus/src/prompt -S` | Current architecture and dated records explicitly state expert squads change prompts only and do not change tools, models, workflow, MCP, or agent availability. These records must be superseded by this new capability-profile design. |
| `rg -n "createOrchestratorTools\|select_expert_squad\|withDecisionEffectMetadata\|ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY\|decisionEffectForToolName\|STATEFUL\|decisionEffect" packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/orchestrator/stateful-tool-names.ts packages/opencorvus/test/orchestrator/tools.test.ts packages/opencorvus/test/agent/agent.test.ts -S` | `createOrchestratorTools` is heavily used by tests. `select_expert_squad` currently writes only `prompt_profile.active`; tool decision metadata wraps all tools after construction. Filtering must happen before metadata wrapping or preserve metadata wrapping after projection. |
| `rg -n "agent-skill-grid\|available\|glyph\|mount-action\|agent-skill-grid-cell\|is-available\|hover\|focus" packages/overlay/src -S` | `SkillMarketPanel` renders matrix cell state in TSX. CSS already hides available plus glyphs by default and shows them on hover / focus / active; if plus signs persist at rest, either the running overlay is stale or active-cell state is too broad. |
| `rg -n "frontend-replica\|DEFAULT_PROMPT_PROFILE_ID\|prompt_profile.*active\|config\\.prompt_profile\|PromptProfile\\.list\|custom profile\|cannot override\|PromptProfileConfigSchema\|PromptProfileImportSchema" packages/opencorvus/test packages/overlay/test packages/opencorvus/src packages/sdk/openapi.json -S` | Default-profile change affects prompt-profile tests, server config tests, overlay fixtures, SDK OpenAPI examples, task/session route tests, and import/custom-profile helpers. |

Independent agents:

- Ohm: runtime/tool-contract review. Returned. Main findings: project Orchestrator tools before `toolGuard` and runtime contract installation; treat `AgentToolPool` as the maximum declared catalog, not the effective Orchestrator surface; propagate projection identity into worker dispatch paths; keep same-turn selection as a visible continuation, not a hidden gate.
- Hilbert: PromptProfile schema/config review. Returned. Main findings: do not make `prompt-profile.ts` resolve session/project effective config; pass already materialized config into profile capability resolution; make `createOrchestratorTools` accept/apply projection internally before decision metadata wrapping; split selector and production skill names; avoid async disk-backed validation inside Zod.
- Dewey: SkillMount/API/overlay review. Returned. Main findings: updating `/skill/mounts` alone is insufficient; `SkillMount.resolve`, `SkillTool`, `SystemPrompt.skills`, Prompt Catalog, overlay cache keys, and browser fixtures all need the same session-scoped projection; selector skills must stay available enough to switch squads.
- Parfit: docs/tests/history review. Returned. Main findings: current architecture records explicitly state prompt-only behavior and must be amended after implementation; the test blast radius includes prompt-profile, Orchestrator tools, exact runtime contracts, skill routes, overlay prompt profile, overlay matrix, SDK/OpenAPI, and docs health.
- Nash: adversarial review. Returned. Main findings: projection must be a real single source, not UI wording; pending worker sessions and retries need `promptProfileID` plus a capability hash; MCP and runtime extra tools can bypass projection unless bound by the same contract; stale UI state must not resubmit an old active profile.

## Current Root Findings

The current system is internally consistent but wrong for the user's requirement.

1. `PromptProfile` is prompt-only by type.
   - `packages/opencorvus/src/agent/prompt-profile.ts` defines each profile as `{ label, description, agents }`.
   - `PromptProfile.composeAgentPrompt()` appends the active profile text to the role prompt.
   - No profile data can express tool, skill, scheduler, or dispatch-agent availability.

2. The project default was thick at the time of this design, not thin.
   - Historical finding: `DEFAULT_PROMPT_PROFILE_ID = "frontend-replica"`.
   - 2026-07-03 update: `2026-07-03-generic-build-evidence-gate-removal.md` changed the default to `general` without implementing the broader capability-projection design.

3. Orchestrator tool availability is installed as a full exact runtime contract before the model call.
   - `orchestrator/agent.ts` calls `createOrchestratorTools(...)`.
   - It passes the full map through `toolGuard(...)`.
   - It builds `enableMap` from every key.
   - It installs `guard.tools` through `SessionPrompt.setSessionRuntimeContract(...)`.
   - `SessionLoop.usesExactRuntimeContractTools("orchestrator", contract)` makes the turn skip the ordinary registry path.
   - Therefore changing `AgentToolPool` or prompt text alone cannot filter Orchestrator tools for exact runtime wakes.

4. `select_expert_squad` cannot change the current LLM call's tool table.
   - The current wake's tools are already fixed in the installed runtime contract.
   - A successful selection can only affect a later wake unless the tool itself visibly schedules a continuation wake.
   - If the general profile exposes only `select_expert_squad` and no workflow dispatch tools, selecting a profile and then stopping must still continue the task. The continuation must be an explicit, visible effect of `select_expert_squad`; relying on stale same-turn tools is impossible.

5. Skill availability is not profile-aware.
   - `SkillMount.resolve()` filters by `mounted_agents`, `required_tools`, permissions, platform, and static `AgentToolPool`.
   - `/skill/mounts` has only `sessionID` and `refresh` query inputs.
   - `SkillTool` lists compatible mounted skills from `SkillMount.resolve()`.
   - This is why Orchestrator can currently see all mounted expert-squad selector skills at once.

6. UI surfaces assume prompt profile and skill matrix are separate.
   - Prompt Catalog reads `/config/prompt-profile`.
   - Skill Market reads `/skill/mounts`.
   - `SkillMarketPanel.refreshSkillMounts()` does not pass the prompt-profile session scope.
   - Historical finding: `packages/overlay/src/main.tsx` initialized `activePromptProfile` to `frontend-replica`. The generic Build gate-removal repair changed this initializer to `general`; the rest of the profile-aware Skill Market work remains separate.

7. Current docs encode the wrong invariant.
   - `17-agent-team-infrastructure.html` says expert squads change prompt only and that tools / agent / model / MCP / workflow remain unchanged.
   - June and early July records repeat the same invariant. These records remain history, but current architecture must be superseded before implementation is accepted.

## Design Decision

Introduce a typed capability profile owned by `PromptProfile`. The expert squad is no longer "prompt profile only"; it becomes:

```text
PromptProfile = role prompt overlays + capability projection
```

This keeps the single existing expert-squad selection source, `prompt_profile.active`, while making the active profile capable of projecting scheduler capabilities. The selection source stays one field; the runtime surfaces become derived projections from that field.

Rejected alternatives:

| Alternative | Rejection reason |
| --- | --- |
| Keep prompt-only profiles and add tool keywords to Orchestrator prompt | Prompt prose cannot remove installed tools. It leaves the full pile visible and depends on instruction compliance. |
| Add host-side keyword classifier before Orchestrator wake | Violates no hidden routing and prompt-over-host invariant. |
| Add route-local `/skill/mounts` filters | Creates a second source beside PromptProfile and lets UI lie about runtime. |
| Store tools in session overlay when selecting a squad | Duplicates `prompt_profile.active` and makes selection state split across overlay paths. |
| Mutate `AgentToolPool.roleAssignments.orchestrator` dynamically | Breaks the canonical static role contract and makes ordinary registry behavior fight exact runtime contracts. |
| Let `select_expert_squad` expose new tools in the same model call | Impossible with a fixed LLM tool table and would hide a runtime discontinuity. |

## Data Model

Add a PromptProfile-owned capability projection.

```ts
type PromptProfileCapabilityProjection = {
  scheduler: {
    tool_ids: string[]
    selector_skill_names: string[]
    production_skill_names: string[]
    include_mcp_tools: boolean
  }
}
```

Implementation notes:

- The field name should be `capability_projection`.
- Every built-in profile must define `capability_projection` explicitly.
- `general` must define a real projection; it must not be an implicit default or fallback.
- Custom profile definitions must not invent tool IDs or skill names in phase 1.
- A custom profile must provide `capability_profile_id` that references a built-in capability profile. Its prompt overlays are custom, but its capability projection is the referenced built-in's projection.
- Built-in profiles may have inline `capability_projection`; custom profiles may have `capability_profile_id`; a custom config that mixes both is invalid.
- Unknown profile IDs, tool IDs, or skill names are hard config errors.
- Legacy custom profiles without `capability_profile_id` are invalid. This project forbids compatibility fallback, so the error must be explicit instead of silently attaching `general` or `frontend-replica`.

Validation source:

- `PromptProfile` owns built-in profile definitions and capability lookup over a materialized config object.
- Callers resolve effective project/session config first; `prompt-profile.ts` must not import session, task, or project services.
- `AgentToolPool.canonicalToolIDs()` plus the full Orchestrator tool factory keys validate tool IDs.
- Built-in skill registry names validate `selector_skill_names` and `production_skill_names`; phase 1 rejects arbitrary custom skill IDs rather than adding async filesystem validation to Zod.
- `AgentRoleContract` derives dispatchable agent roles from projected workflow tool IDs. Do not store a separate `dispatch_agents` list.

The catalog response should include a summary:

```ts
type PromptProfileCatalogProfile = {
  id: string
  label: string
  description?: string
  built_in: boolean
  editable: boolean
  agents: Record<string, string>
  capability_profile_id: string
  capability_projection: PromptProfileCapabilityProjection
  projected_agents: string[]
  projection_hash: string
}
```

`projected_agents` is derived for UI readability. The authoritative field remains `capability_projection.scheduler.tool_ids`.

`projection_hash` is a stable hash of the resolved capability profile. Worker turn descriptors, Orchestrator wake contracts, retry records, and continuation events must record `promptProfileID`, `capabilityProfileID`, and `projectionHash` so a later profile change cannot silently reinterpret already queued work.

## Built-In Capability Profiles

The exact tool lists must be authored in `PromptProfile.builtIns` and pinned by tests. The initial target shape:

| Profile | Scheduler tool posture |
| --- | --- |
| `general` | Minimal selector/control surface. Initial exact allow-list: `select_expert_squad`, `skill`, `question`, `read_context`, `query_failed_goals`, `complete_task`, `fail_task`, `cancel_task`, `retry_task`, `wait`, `inject_operator_message`, `respond_agent_coordination`, and `cancel_subagent`. It must not expose domain workflow dispatch tools such as `build`, `requirements`, `architect`, `frontend_design`, `frontend_research`, `visual_qa`, `integrity`, `deep_research`, `fact_check`, `workload_analysis`, `analyze_intent`, `explore`, `add_goal`, `modify_goal`, `complete_goal`, `delete_goal`, `refine`, `propose_task`, `browser_preview`, or `bash`. Any implementation change to this allow-list must update this record or a successor record and the exact-contract tests. |
| `frontend-replica` | Expose frontend source/reference investigation, intent/requirements/architecture decomposition, workload planning, Build, Visual QA, Integrity, and required lifecycle/control tools. |
| `frontend-innovate` | Expose design-resource research/synthesis, requirements/architecture, Build, Visual QA, Integrity, and required lifecycle/control tools. |
| `frontend-automation-debug` | Expose diagnostics/explore, Build, Visual QA, Integrity, and lifecycle/control tools. Do not expose unrelated webpage-replica design decomposition by default. |
| `backend` | Expose intent, requirements, architecture, workload planning, Build, Integrity, fact/deep research only where backend evidence requires it. Do not expose frontend-only tools. |
| `algorithm` | Expose intent, requirements, architecture, workload planning, Build, Integrity, benchmark/research oriented tools as needed. Do not expose frontend-only tools. |

Selector skills:

- Every built-in expert squad that the Orchestrator can select automatically must have one mounted Orchestrator selector skill.
- `general.scheduler.selector_skill_names` lists selector skills only, not production skills.
- If a built-in profile should be UI-only and not Orchestrator-selectable, that must be explicit in the profile metadata. Do not leave it as an accidental missing skill.
- Existing frontend selector skills stay minimal and keep `required_tools: [select_expert_squad]`.
- The Orchestrator selector surface and production skill surface are separate. `selector_skill_names` stays available where profile switching is allowed; `production_skill_names` changes with the active profile and is the only source for profile-owned production guidance.
- `visible_skill_names` is not stored. It is derived as `selector_skill_names + production_skill_names`.
- Existing tests that expect all expert selector skills to be visible must be rewritten to assert selector-skill visibility deliberately, not accidental exposure of production skills.

## Runtime Projection

Add a projection resolver:

```ts
PromptProfile.effectiveCapability(config): PromptProfileResolvedCapability
PromptProfile.projectOrchestratorTools(tools, capability): Record<string, AITool>
PromptProfile.dispatchableAgents(capability): AgentRoleID[]
```

Orchestrator wake flow changes:

1. Resolve effective config for the task root session before tool construction.
2. Resolve active prompt profile capability from that config.
3. Call `createOrchestratorTools(input, { capability })`, or an equivalent single boundary, so the function builds the canonical raw map and projects it before `withDecisionEffectMetadata` wraps tools.
4. Project the raw map by `capability.scheduler.tool_ids`.
5. Only then apply decision-effect metadata and `toolGuard`.
6. Build `enableMap` from the projected keys.
7. Install only the projected tool map into `SessionPrompt.setSessionRuntimeContract`.
8. Render the Orchestrator system prompt from the same effective config.

This makes the exact runtime contract the proof of effective capability. `SessionLoop.usesExactRuntimeContractTools` can continue to skip the registry because the contract is already projected.

`AgentToolPool.roleAssignments.orchestrator` remains the maximum declared catalog for static registry discovery and validation. It is not the effective Orchestrator tool set once a task/session profile is active. The effective tool set is the projected exact runtime contract.

`include_mcp_tools`:

- For Orchestrator exact runtime, default should be explicit `false` in `general`.
- Expert profiles may opt in only if their projected tools need MCP server tools during the Orchestrator wake.
- This flag must flow to `runtimeContract.includeMcpTools`; do not rely on the current default.

Worker dispatch projection:

- Every Orchestrator workflow dispatch tool must check the active capability before starting a worker session. This includes `build`, `requirements`, `architect`, `frontend_design`, `frontend_research`, `visual_qa`, `integrity`, `fact_check`, `deep_research`, `workload_analysis`, `analyze_intent`, `explore`, and any successor dispatch tool.
- Worker sessions keep their own role-specific exact toolkits after dispatch. The profile projection decides whether the Orchestrator can start that worker; it does not strip the worker's terminal/report tools after a legitimate dispatch.
- `frontend-design/agent.ts`, `visual-qa/agent.ts`, `integrity/team-agent.ts`, `build/agent.ts`, and equivalent runner entries must receive or record the same `promptProfileID`, `capabilityProfileID`, and `projectionHash` in their worker turn descriptor.
- A retry or continuation created under one projection must either bind the original projection identity or fail visibly when the active profile changed. It must not silently reinterpret pending work under a different profile.

## Selection Continuation

`select_expert_squad` must remain a visible model-called tool. Its implementation changes from "write active profile only" to "write active profile and request a visible continuation wake".

Required behavior:

- Validate the profile ID against `PromptProfile`.
- Write only `{ prompt_profile: { active: profile_id } }` to the task root session overlay.
- Append a decision-log row or equivalent visible artifact stating previous profile, next profile, and capability profile ID.
- Include `projectionHash` in that visible row or event.
- Schedule a new task-loop wake with an event note such as:

```text
Expert squad selected: frontend-replica. Reload the active prompt profile and capability projection, then continue scheduling from current task evidence.
```

- The continuation wake must install the projected tool map before the next model call.
- The current turn must not try to dispatch domain workflow tools after selection unless those tools were already projected for the pre-selection profile.
- `select_expert_squad` must not call a private route, hidden scheduler branch, or keyword classifier. The continuation is authorized only by the explicit tool call and its visible tool result / decision log / task event.

This is not a keyword route or hidden branch. It is a direct consequence of an explicit tool call whose tool result is visible. It is required because a single LLM call cannot mutate its own tool table.

Tests must prove:

- General wake has no domain workflow tools.
- General wake can call `skill` and `select_expert_squad`.
- After selecting `frontend-replica`, the next wake contract includes frontend-replica projected tools and excludes unrelated profile tools.
- `select_expert_squad` does not write tools, permissions, models, workflow state, or per-agent prompt fields to session overlay.
- A decision-log row or task event records previous profile, next profile, capability profile ID, and projection hash.

## Skill Projection

`SkillMount` remains the single backend projection for skill matrix and `SkillTool` surfaces.

Changes:

- `SkillMount.resolve()` accepts a resolved capability projection.
- `SkillMount.matrix()` resolves effective config and active capability when `sessionID` is provided.
- `/skill/mounts` remains the only matrix endpoint, but its response includes:
  - `active_profile`
  - `capability_profile_id`
  - `projection_hash`
  - `projected_tool_ids`
  - `projected_agents`
  - `selector_skill_names`
  - `production_skill_names`
  - `projected_skill_names` derived from selector plus production names
- `SkillTool` receives the same projected `SkillMount.resolve()` surface through `SessionLoop.finalizeResolvedToolSkillSurface`.
- The Orchestrator `skill` placeholder is rebound only against profile-visible skills.
- UI must not apply an additional local filter that can disagree with the backend.
- `SystemPrompt.skills` must render from the same projected skill list; static prompt-time skill text must not include unprojected skills.
- Materialized built-in skills must not preserve old `mounted_agents` or `required_tools` in a way that contradicts the built-in capability projection. The registry either derives their active visibility from projection or rejects the conflicting metadata.

Policy:

- `general` exposes selector skills only.
- Active expert profiles expose their own selector skill plus any profile-owned workflow skills.
- Operator-mounted ordinary skills remain discoverable only when their mounted agent is in the projected agent set and required tools are available in the current turn.
- Unprojected agents should not produce plus cells in the active matrix. The UI can still show counts or hidden-by-profile summaries only if they come from `/skill/mounts`.
- The selector skills are not a fallback path. They are profile-owned scheduler skills whose only purpose is squad selection; they must not contain production implementation guidance.

## Overlay/UI Contract

Prompt Catalog and Skill Market must use the same active profile scope:

- Remove the hardcoded `activePromptProfile = "frontend-replica"` initializer; initialize from catalog/config once loaded.
- Make `loadSkillMountMatrix()` use the same session scope as `loadPromptProfileCatalog()`.
- Make `/config/prompt` session-aware, or replace its consumers with a session-effective prompt catalog, so prompt text and capability summaries cannot be fetched from different scopes.
- Invalidate or reload the skill matrix after project/session prompt profile activation.
- Update copy from "expert squads add prompt guidance" to "expert squads add prompt guidance and project scheduler capabilities".
- Extend `AgentSkillMountMatrix` client type with backend capability fields.
- Browser fixtures that stub `/skill/mounts` must include the new fields or use a shared empty matrix helper.
- Task/session UI must prefer projected capability data over raw `/agent` or static role catalogs. Raw catalogs may remain developer/reference views only if they are clearly labeled as maximum declared capability, not active availability.
- UI cache keys must include `sessionID`, `active_profile`, and `projection_hash` for the prompt profile catalog and skill matrix.
- Profile activation UI must not resubmit stale local `activePromptProfile` state after the backend has selected a different root-session profile.

Plus glyph:

- Source CSS already sets available-cell glyph opacity to `0` and only shows it on hover / focus-visible / active combination.
- Keep that behavior and add a browser test that verifies at-rest available cells have hidden glyphs.
- If a persistent plus remains after source update, inspect active-combo state in `SkillMarketPanel` rather than adding a second CSS override.

## Documentation Updates

Current architecture must be changed after code implementation:

- `specs/current/architecture/17-agent-team-infrastructure.html`
  - Replace "prompt only" language.
  - Amend the lines around the existing "Expert Squad only changes prompt" and "TOOLS arm unaffected" claims.
  - Replace "TOOLS arm unaffected" with "PromptProfile capability projection selects scheduler tool surface".
  - Keep model and executor unchanged unless a future design explicitly changes them.
- `specs/current/architecture/08-agent-tool-adapter.md`
  - Add a subsection for Orchestrator exact runtime projection from `PromptProfile.capability_projection`.
  - Keep ordinary agent `AgentToolPool` ownership unchanged.
- `specs/artifacts/opencorvus-single-agent-vs-agent-team.drawio`
  - Supersede the prompt-only diagram if it remains presented as architecture evidence.
- Historical records stay historical but this file supersedes their prompt-only invariant for future work.

Records that must be explicitly superseded or amended in current docs:

- `specs/records/2026-06/2026-06-16-prompt-profile-expert-squad-switching.md`
- `specs/records/2026-06/2026-06-24-orchestrator-expert-squad-skill.md`
- `specs/records/2026-06/2026-06-26-prompt-profile-settings-clarity.md`
- `specs/records/2026-06/2026-06-29-frontend-innovate-expert-squad.md`
- `specs/records/2026-06/2026-06-30-agent-team-html-architecture-diagram.md`
- `specs/records/2026-06/2026-06-30-provider-tool-schema-regex-lookaround.md`
- `specs/records/2026-06/2026-06-30-thick-expert-squad-prompts.md`
- `specs/records/2026-07/2026-07-01-expert-squad-concrete-prompts.md`
- `specs/records/2026-07/2026-07-01-frontend-innovate-design-philosophy.md`
- `specs/records/2026-07/2026-07-02-visual-evidence-bundle-authority-repair.md`
- `specs/records/2026-07/2026-07-02-single-agent-vs-opencorvus-clear-drawio.md`
- `specs/records/2026-07/2026-07-02-agent-team-investment-drawio.md`

`2026-07-01-expert-squad-concrete-prompts.md` remains valid for prompt hygiene and concrete evidence wording. This record supersedes only the interpretation that expert squads are prompt-only.

## Implementation Plan

1. PromptProfile schema
   - Add capability projection schemas.
   - Add built-in-only internal type requiring `capability_projection`.
   - Add custom-profile `capability_profile_id`.
   - Change `DEFAULT_PROMPT_PROFILE_ID` to `general` (implemented by `2026-07-03-generic-build-evidence-gate-removal.md`).
   - Reject custom profiles without explicit capability profile reference.
   - Keep capability resolution over materialized config only; do not import session/project services into `prompt-profile.ts`.
   - Update import/save helpers and OpenAPI examples.

2. Projection resolver
   - Implement `PromptProfile.effectiveCapability`.
   - Implement canonical tool ID validation.
   - Implement skill-name validation.
   - Implement derived projected agents through `AgentRoleContract`.
   - Implement stable projection hashing.

3. Orchestrator runtime
   - Resolve capability before tool installation.
   - Project tool map inside the Orchestrator tool factory boundary before decision metadata wrapping, `toolGuard`, `enableMap`, and runtime contract installation.
   - Set `runtimeContract.includeMcpTools` from the projection.
   - Update `select_expert_squad` output and continuation wake behavior.
   - Replace direct active-profile checks such as `requireFrontendInnovateContract` with resolved capability/profile semantics.
   - Ensure provider schema generation receives only projected tools, including stress tests for regex/lookaround-sensitive schemas.

4. Skill system
   - Make `SkillMount.resolve()` and `SkillMount.matrix()` profile-aware.
   - Extend `/skill/mounts` schema.
   - Rebind `SkillTool` using the projected surface.
   - Render `SystemPrompt.skills` from the projected surface.
   - Add missing selector skills or explicit non-selectable metadata for built-ins without selector skills.
   - Split selector skill and production skill handling.

5. Overlay
   - Update prompt-profile and skill-matrix service types.
   - Remove hardcoded `frontend-replica` active initializer (implemented by `2026-07-03-generic-build-evidence-gate-removal.md`).
   - Share session scope between Prompt Catalog and Skill Market.
   - Make `/config/prompt` or its replacement session-effective.
   - Reload matrix on profile activation.
   - Update prompt-profile copy.
   - Add glyph visibility browser coverage.
   - Treat raw `/agent` catalog data as maximum declared capability, not active availability.

6. Documentation
   - Update current architecture docs after behavior is implemented.
   - Keep this record as the dated design source.
   - Update monthly README index.
   - Update SDK/OpenAPI snapshots and examples because matrix/catalog response fields are required.

## Test Plan

Focused backend tests:

- `bun test packages/opencorvus/test/agent/prompt-profile.test.ts`
  - Default is `general`.
  - Every built-in profile has a valid `capability_projection`.
  - Custom profiles must specify `capability_profile_id`.
  - Prompt overlays remain role-scoped and do not carry tool lists as prose.
  - `projection_hash` changes only when resolved capability changes.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts`
  - `select_expert_squad` writes active profile only and schedules a visible continuation wake.
  - Unknown profile rejects.
  - Tool result wording mentions prompt + capability projection.
  - `requireFrontendInnovateContract` or successor checks are based on resolved profile/capability, not direct metadata peeking.
- `bun test packages/opencorvus/test/agent/agent.test.ts`
  - Orchestrator static role pool remains canonical, but runtime projected contract differs by active profile.
  - General runtime contract excludes domain workflow tools.
  - Provider tool schema generation sees only projected tool IDs.
- `bun test packages/opencorvus/test/agent/runner-tool-scope.test.ts`
  - Exact runtime skill rebinding receives projected available tool names.
- `bun test packages/opencorvus/test/session/extra-tools.test.ts`
  - Exact runtime contracts do not expose all expert-squad selector skills after a profile is active.
  - MCP tools are absent when `include_mcp_tools` is false.
- `bun test packages/opencorvus/test/tool/skill.test.ts`
  - General Orchestrator skill search lists selector skills only.
  - Active frontend-replica search excludes unrelated expert selector skills and non-projected production skills.
- `bun test packages/opencorvus/test/skill/skill.test.ts`
  - Built-in mounted skill metadata cannot contradict profile projection.
- `bun test packages/opencorvus/test/server/skill-routes.test.ts`
  - `/skill/mounts?sessionID=...` returns active profile and projected agents/tools/skills.
- `bun test packages/opencorvus/test/server/config-routes.test.ts`
  - Prompt profile catalog exposes capability projection summaries and default `general`.
- `bun test packages/opencorvus/test/config/prompt-catalog.test.ts`
  - Prompt catalog is session-effective or delegates to a session-effective backend source.

Focused overlay tests:

- `bun test packages/overlay/test/prompt-profile-config.test.ts`
  - Custom profile helpers preserve explicit capability profile references.
- `bun test packages/overlay/test/prompt-profile-task-session-owner.test.ts`
  - Prompt Catalog and Skill Mount Matrix use the same root session scope.
- `bun test packages/overlay/test/extensions-service.test.ts`
  - `loadSkillMountMatrix` accepts and commits capability fields.
- `bun test packages/overlay/test/prompt-catalog-service.test.ts`
  - Prompt profile catalog, prompt catalog, and skill matrix share the same session scope.
- `bun test packages/overlay/test/browser/skill-mount-matrix-browser.test.ts`
  - Available unmounted cells hide plus glyphs at rest and show them on hover/focus/active.
  - Matrix columns/rows reflect projected agents and skills.
- `bun test packages/overlay/test/browser/prompt-profile-panel.test.ts`
  - Activating a profile reloads the skill matrix with the same session scope.

Docs and schema tests:

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `git diff --check`

## Open Risks For Independent Review

1. Same-turn selection continuation must not become a hidden gate. The implementation needs visible decision-log/tool-result evidence and a clear test that the next wake installs projected tools.
2. Custom capability profile references may make old local custom profiles invalid. Because this project forbids compatibility fallback, this is acceptable only if error messages are explicit and tests pin rejection.
3. Backend/algorithm profiles currently do not have mounted selector skills. The implementation must either add them or explicitly mark them not Orchestrator-selectable.
4. Exact runtime contracts may be reused by automatic compaction or live continuation. Tests must prove profile changes install a fresh Orchestrator wake contract before the next decision turn.
5. MCP inclusion must be explicit. Current `SessionLoop` includes MCP unless `includeMcpTools === false`; the general profile must set this false or it still exposes MCP tools.
6. Overlay fixtures are numerous and will silently pass stale payloads if the new matrix schema leaves fields optional. Backend schema should require capability fields; tests should update fixtures intentionally.
7. Direct API clients may keep using raw `/agent` or unsessioned `/config/prompt` data. Those surfaces must be relabeled, session-scoped, or replaced so they cannot claim active availability from a static catalog.
8. Pending worker sessions created before profile selection may exist during rollout. Because fallback compatibility is disallowed, implementation should fail those stale pending descriptors visibly with projection identity mismatch rather than guessing.
