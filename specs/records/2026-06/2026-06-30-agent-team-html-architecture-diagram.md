# 2026-06-30 Agent Team HTML Architecture Diagram

Status: implemented with executive visual revision

## Goal

Create a standalone HTML architecture diagram for OpenCorvus from the Agent Team
infrastructure perspective. The diagram must show the agent family, skill
mounting, MCP (Model Context Protocol), memory, workflow templates, expert
squads, scheduling/control flow, durable A2A (Agent-to-Agent) coordination, and
visible evidence projection without reintroducing retired planner, gateway,
fallback, hidden-message, or fixed-pipeline concepts.

## Recall

### User Request

The user asked: "我需要从Agent Team的基建角度画一个html的opencorvus架构图，设计的概念有agent家族，skill，mcp，memory，workfow，专家团，调度流程等等".

### Acceptance Criteria

- Add one current-architecture HTML diagram under `specs/current/architecture/`.
- The diagram is visually readable as a desktop architecture map and covers:
  agent family, Orchestrator scheduling, direct/pipeline workflow hints, skill
  mount matrix, MCP client/server boundary, memory and decision log, expert
  squad prompt profiles, executor/worktree boundary, A2A coordination, Trace,
  Bus, SSE (Server-Sent Events), and overlay projection.
- The diagram must state acronyms where they appear: MCP, A2A, SSE, DB
  (Database), LLM (Large Language Model), UI (User Interface), API
  (Application Programming Interface).
- Sync `specs/current/architecture/README.md` and `specs/records/2026-06/README.md`.
- Use a real browser/screenshot visual verification path for the HTML page and
  inspect the rendered screenshot.
- Run documentation health tests required for new spec paths:
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  and, because this touches current architecture, also run
  `bun test packages/opencorvus/test/script/document-health.test.ts`.
- Keep changes scoped to new docs/HTML and README index updates. Do not modify
  existing dirty source files.

### Hard Constraints

- No fallback/compatibility wording as an implementation strategy.
- No double source: the diagram summarizes current sources and points to the
  current architecture docs/code contracts.
- Do not document planner, acceptance-review agent, old gateway singleton, old
  goal-pool executor, direct worker steer through task-root messages, hidden
  messages, or fixed host state machines as current runtime paths.
- Orchestrator remains the only task-level scheduler. Sub-agents own scoped
  evidence, not task completion or cross-goal scheduling.
- Skills are mounted through `mounted_agents` and loaded through the visible
  canonical `skill` tool. Skill mounts do not change workflow, routing, MCP
  servers, model, or agent tools.
- Expert squads are prompt profiles selected through visible Orchestrator
  skill loading plus `select_expert_squad`, not host keyword routing.
- MCP is a protocol extension axis; it is not the same as plugin or executor.
- Existing uncommitted changes in the worktree are not part of this task.

### Sources Read

| Source | Use in diagram |
| --- | --- |
| `AGENTS.md` | Execution constraints: no fallback, no hidden gates/messages, visual verification, spec location and Recall requirements. |
| `specs/README.md` | Confirms current architecture belongs in `specs/current/architecture/**` and records in `specs/records/YYYY-MM/**`. |
| `specs/current/architecture/README.md` | Existing current-architecture index to update. |
| `specs/current/architecture/01-agents.md` | Agent family, Task Control Loop, MiniWorkflow hints, Orchestrator tools, deleted planner/acceptance-review facts. |
| `specs/current/architecture/02-data.md` | `engine_*`, session, decision log, memory, Trace, Bus, scheduler, and artifact storage. |
| `specs/current/architecture/03-control.md` | ChannelIngress, ControlMessage, PanelCapability, EngineService, and SSE surface. |
| `specs/current/architecture/04-extensions.md` | Executor, Plugin, MCP, ACP (Agent Client Protocol) boundaries. |
| `specs/current/architecture/05-config.md` | Config, assistant workflow settings, prompt/profile related config scope. |
| `specs/current/architecture/08-agent-tool-adapter.md` | AgentToolPool and canonical tool visibility. |
| `specs/current/architecture/09-verification-evidence.md` | Verification evidence and browser preview evidence as artifact-backed proof. |
| `specs/current/architecture/11-agent-oop-protocol.md` | Current agent contract is data/prompt/session based, not class hierarchy/mailbox. |
| `specs/current/architecture/13-agent-communication-matrix.md` | A2A durable coordination and direct/indirect agent communication topology. |
| `specs/current/architecture/14-agent-runtime-mode.md` | Runtime modes and context strategy. |
| `specs/current/architecture/16-unified-teardown.md` | Conversation-led runtime and disallowed hidden/fallback/state-machine mechanisms. |
| `specs/records/2026-06/2026-06-23-agent-skill-mount-matrix.md` | Skill mount matrix design, `mounted_agents`, canonical SkillTool surface. |
| `specs/records/2026-06/2026-06-24-orchestrator-expert-squad-skill.md` | Orchestrator expert-squad skill loading and `select_expert_squad`. |
| `specs/records/2026-06/2026-06-16-prompt-profile-expert-squad-switching.md` | Expert squads as prompt profiles, not workflow/tool/routing changes. |
| `specs/records/2026-06/2026-06-26-enterprise-a2a-protocol-root-repair.md` | Durable request/response/action protocol and visibility expectations. |
| `specs/records/2026-06/2026-06-27-add-opencorvus-agent-playbook.md` | Native agent single-source wiring checklist and A2A/test obligations. |
| `specs/records/2026-06/2026-06-29-subagent-infrastructure-homogeneity.md` | Role manifest convergence and task-worker infrastructure homogeneity. |
| `specs/records/2026-06/2026-06-29-frontend-innovate-expert-squad.md` | Independent infrastructure and verification explorer feedback on expert-squad selection. |
| `C:/Users/chuan/.codex/plugins/cache/openai-bundled/browser/26.623.61825/skills/control-in-app-browser/SKILL.md` | Browser verification instructions for local HTML screenshot review. |

### Whole-Repository Grep Evidence

| Command | Finding carried forward |
| --- | --- |
| `rg -n "agent\|Agent\|skill\|MCP\|mcp\|memory\|workflow\|调度\|专家\|architecture\|架构" specs packages -g "*.md" -g "*.ts" -g "*.tsx" -g "*.html"` | Current docs/code already cover all requested concepts across architecture chapters, skill routes, MCP, memory, workflow, and expert-squad sources. |
| `rg -n "AgentRoleID\|AgentRoleContract\\.all\|agentOwnedTaskWorkerIDs\|skillMountable\|orchestratorWorkflowToolName\|promptProfileTarget\|controlSurface\|agentCoordinationRedispatchBinding" packages/opencorvus/src/agent/role-contract.ts` | `AgentRoleContract` is the current role fact source for task-worker, prompt profile, skill mountable, workflow tool, and A2A redispatch facts. |
| `rg -n "roleAssignments\|ORCHESTRATOR_PRIVATE_TOOL_IDS\|request_orchestrator_decision\|frontend_design\|frontend_research\|deep_research\|visual_qa\|integrity\|fact_check\|workload_analysis\|build" packages/opencorvus/src/agent/tool-pool-contract.ts` | Agent tool visibility is owned by `AgentToolPool`, including Orchestrator private tools and worker A2A request tool exposure. |
| `rg -n "AgentSkillMount\|mounted_agents\|SkillMount\|skill.mounts\|SkillTool\|SystemPrompt\\.skills\|/skill/mounts" packages/opencorvus/src packages/overlay/src packages/opencorvus/test` | Skill mount projection, route, prompt section, canonical `SkillTool`, and overlay matrix are implemented and tested. |
| `rg -n "frontend-replica\|frontend-innovate\|frontend-automation-debug\|backend\|algorithm\|select_expert_squad\|PromptProfile\\.builtIns\|mounted_agents" packages/opencorvus/src/agent/prompt-profile.ts packages/opencorvus/src/skill/builtin packages/opencorvus/src/orchestrator/tools.ts specs/records/2026-06/2026-06-29-frontend-innovate-expert-squad.md` | Expert squads are prompt profiles with mounted Orchestrator skills and `select_expert_squad`; existing built-ins include frontend-replica, frontend-innovate, backend, algorithm, and frontend-automation-debug. |
| `rg -n "Task Control Loop\|MiniWorkflow\|direct\|pipeline\|requirements\|architect\|visual_qa\|integrity\|engine/workflow\|WorkflowRegistry\|default_workflow\|workflows" specs/current/architecture packages/opencorvus/src/engine/workflow.ts packages/opencorvus/src/config/config.ts` | Workflows are declarative hints (`direct`, `pipeline`) resolved by `WorkflowRegistry`; Orchestrator may still reason and deviate from hints. |
| `rg --files -g "*.html" specs packages .scratch` | No current-architecture HTML diagram exists; adding one does not duplicate an existing current HTML architecture artifact. |

### Independent Agent Feedback

This turn cannot spawn a fresh sub-agent because the available multi-agent tool
explicitly permits spawning only when the user asks for delegation or parallel
agent work. The implementation therefore reuses already-landed independent
feedback from:

- `2026-06-29-frontend-innovate-expert-squad.md`, where the Infrastructure
  explorer required expert squads to remain `PromptProfile` plus mounted
  Orchestrator skill plus `select_expert_squad`, and the Verification explorer
  required visible skill loading plus runtime message-flow evidence instead of
  prompt-only assertions.
- `2026-06-16-prompt-profile-expert-squad-switching.md`, whose Codex review
  notes required a compiler layer, deliberate Orchestrator handling, explicit
  profile targets, and no keyword gate.
- `2026-06-29-subagent-infrastructure-homogeneity.md`, whose implementation
  log records repeated independent/audit repair loops around role-manifest and
  A2A single-source behavior.

## Implementation Plan

1. Re-read this Recall before touching the current architecture HTML/README files.
2. Add `specs/current/architecture/17-agent-team-infrastructure.html` as a
   standalone, readable architecture map.
3. Update `specs/current/architecture/README.md` with the new HTML diagram.
4. Update `specs/records/2026-06/README.md` with this record.
5. Open/render the HTML with a real browser path, capture a screenshot, inspect
   it, and iterate if layout or text overlap is visible.
6. Run docs health tests and a final diff review.

## Non-Goals

- Do not implement new OpenCorvus runtime behavior.
- Do not create a product landing page or marketing page.
- Do not add a second architecture source outside `specs/current/architecture/**`.
- Do not add a new workflow, agent, skill, MCP server, prompt profile, or route.

## Corrective Recall

### User Correction

After the first implementation, the user rejected the result as "一堆 boxes"
and clarified that the HTML diagram must be suitable for a CEO: stable,
restrained, able to show actual architectural scale, and able to communicate
future usage prospects.

### Revised Acceptance Criteria

- Replace the engineering whiteboard-style box map with an executive
  architecture canvas.
- The primary visual should express strategic operating structure: business goal
  ingress, one Orchestrator scheduling spine, the Agent Team capability mesh,
  Skill / MCP / Memory / Workflow fabric, expert squads, evidence-backed
  delivery, and scale outlook.
- The visual language must be sober and restrained, not a pile of equal-weight
  technical boxes.
- Keep factual anchors to current architecture sources so the CEO-facing view is
  still grounded in implementation reality.
- Re-run real-browser screenshot review after the visual revision and inspect
  the rendered output.

## Implementation Log

2026-06-30:

- Added `specs/current/architecture/17-agent-team-infrastructure.html`.
- Updated `specs/current/architecture/README.md` to index the HTML diagram.
- Updated `specs/records/2026-06/README.md` to index this implementation plan.
- The initial full-page screenshot through `file://` was blocked by browser URL
  policy, so the page was rendered through a temporary read-only local HTTP
  server at `127.0.0.1:41771`, then the server was stopped after screenshot
  capture.
- Visual QA screenshots were saved under
  `.scratch/agent-team-architecture/`:
  - `17-agent-team-infrastructure-top.png`
  - `17-agent-team-infrastructure-middle.png`
  - `17-agent-team-infrastructure-bottom.png`
  - `17-agent-team-infrastructure-footer.png`
- Browser layout audit after CSS repair reported:
  - `hasHorizontalScroll: false`
  - `overflowCount: 0`
  - viewport `1280x720`
  - page scroll size `1265x3098`
- Manual screenshot review covered the top control/runtime chain, middle agent
  family and infrastructure rails, lower single-source matrix and durable
  handoff surfaces, and footer guard rails. No text overlap or blank main region
  remained after the CSS repair.
- Replaced the first box-heavy diagram with an executive architecture map after
  user correction. The revised artifact uses a strategic operating canvas,
  scale indicators, an Agent Team capability mesh, a usage-horizon section, and
  a compact single-source ledger.
- Revised visual QA saved browser screenshots under
  `.scratch/agent-team-architecture/`:
  - `17-agent-team-executive-top-v2.png`
  - `17-agent-team-executive-middle-v2.png`
  - `17-agent-team-executive-lower-v2.png`
  - `17-agent-team-executive-bottom-v2.png`
  - `17-agent-team-executive-middle-v3.png`
- Final browser layout audit for the executive revision reported:
  - `hasHorizontalScroll: false`
  - viewport `1280x720`
  - page scroll size `1265x2440`

## Verification

Passed:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
```
