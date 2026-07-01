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

### Second Corrective Recall (interactive, map-centric)

User feedback across this revision:

1. "改的成熟一些，不要故意炫技，要用充实内容征服读者" — drop the decorative
   orbital SVG (concentric rings + radial floating agent circles) and replace
   thin labels with dense, code-grounded facts.
2. "专家团呢，我要的是每点击一个组件能展开更多的细节" — expert squads were
   missing, and every component must be clickable to expand more detail.
3. "专家团的作用是让 opencorvus 成为基建平台，用通用，可编排，agent team 并行，
   承载众多的可能的业务，这也是重点" — the platform thesis must come through.
4. "重点是 Agent Team Operating Map 这个图，内容要融入这个图，不是大段的文字" —
   the SVG map is the artifact; content belongs inside the map, not in long
   text sections beneath it.

Revision applied:

- Rebuilt the page around a single content-rich SVG `Agent Team Operating Map`.
  Removed the orbital composition and all long text sections (roster table,
  squad card grid, workflow lanes, A2A quad, axes grid, ledger).
- Embedded the full substance INTO the map: three planes (ingress spine →
  Orchestrator operating layer → evidence base + four extension axes), the
  14-role agent family laid out by function group, the executor/worktree chain,
  the verification loop, and the evidence/handoff handoff surfaces.
- Added the expert squad as a horizontal `PromptProfile overlay` band drawn
  ON TOP of the agent family, visually expressing the platform thesis: the same
  general scheduling spine + parallel agent team carries many businesses by
  swapping a domain prompt layer (not by forking scheduling). Built-ins read
  from `src/agent/prompt-profile.ts::PromptProfile.builtIns`: frontend-replica
  (default), frontend-innovate, backend, algorithm, frontend-automation-debug,
  general.
- Made every component clickable. A vanilla-JS detail drawer (no deps, works
  from `file://`) opens code-level detail for each node, keyed by `data-detail`
  into a `DETAILS` map. Substance lives in the drawer, keeping the page itself
  free of large text blocks. Below the map only a compact metric strip, a
  legend, a clickable guardrail (red-line) chip strip, and the footer remain.
- Platform thesis woven into the masthead lead; metric strip surfaces `6 专家团`.

Verification this revision (Windows, headless Chrome):

- `node --check` on the extracted drawer script: pass.
- Full-page screenshot + cropped plane-02 review: agent family groups, squad
  overlay band, verification loop, and base/axes render without overlap.
- Probe auto-click on the `agent-build` SVG chip confirmed the detail drawer
  opens with title, body, kv table, and source footer.
- Screenshots saved under the job scratch dir (`full.png`, `v2`/`v3`,
  `map1.png`, `plane2.png`, `plane2b.png`, `drawer.png`, `drawer2.png`).

### Expert-squad wiring pipeline (added)

User request: "把不同专家团的 tool / agent / prompt 动态注册的过程画出来".

Grounded in source before drawing:

- `src/orchestrator/tools.ts` — `select_expert_squad` writes ONLY
  `prompt_profile.active` to the root session config overlay via
  `Session.mergeConfigOverlay`; its description states it "does not dispatch
  work, reroute the workflow, change models, change tools, mutate per-agent
  prompt fields, or infer the profile from keywords." The mounted `skill`
  surface is scheduler-only search/load for expert-squad SKILL.md guidance.
- `src/agent/runner.ts:1382` — effective prompt =
  `appendNonExecutorSourceBoundary(PromptProfile.composeAgentPrompt({ agentID,
  base: core, userAppend, config }))`.
- `src/agent/prompt-profile.ts` — `composeAgentPrompt` joins base ⊕
  `overlayFor(agentID)` (= active `profile.agents[agentID]`) ⊕ userAppend; each
  built-in profile overlays a different subset of agent IDs.

So the honest "dynamic registration" picture is: the expert squad is a
PROMPT-only layer. Tools come from the canonical `AgentToolPool` +
`ToolRegistry.tools()`; model, MCP servers, and workflow are independent and
untouched.

Added a second clickable SVG, `专家团装配管线 · Expert Squad Wiring`, as four
stages: ① PromptProfile catalog (+ mounted SKILL.md), ② Orchestrator visible
decision (`skill` → reason → `select_expert_squad`, not keyword routing),
③ single write `prompt_profile.active` to root session overlay, ④ per-agent
session composition split into three arms — PROMPT (squad-driven, highlighted)
vs TOOLS and AGENT/MODEL/MCP/WORKFLOW (unchanged). The overlay arrow connects
ONLY to the PROMPT arm; the other arms show independent sources, visually
proving the squad hot-swaps just the prompt layer. New `DETAILS` drawer entries:
`wiring-catalog`, `wiring-skill-discovery`, `wiring-select`, `wiring-overlay`,
`wiring-prompt-arm`, `wiring-tool-arm`, `wiring-model-arm`. Verified by
`node --check`, a cropped render of the pipeline (no overlap), and a probe
auto-click on `wiring-overlay` opening the drawer.

### Third Corrective Recall (visual breathing room)

User feedback: "这里面的图太挤了，一点都不简约大气，怎么调整？"

Revised acceptance criteria for this pass:

- The first map must read as an executive operating canvas, not as a dense
  inventory of every component.
- Preserve the architecture facts and click-to-expand detail drawer, but move
  secondary facts out of the first visual layer.
- Increase visual hierarchy and whitespace: one main scheduling spine, one
  platform band for expert squads, one grouped agent-team surface, and one
  quiet evidence/extension base.
- Keep the expert-squad platform thesis prominent: same Orchestrator + same
  parallel Agent Team + prompt-profile overlay carries many business domains.
- Keep the dedicated expert-squad wiring SVG because it explains the dynamic
  prompt registration path, but make it more spacious and less label-heavy.
- Re-run static consistency checks, script syntax checks, document tests, and a
  real visual review path. Direct `file://` browser rendering is blocked by the
  in-app browser URL policy, so any browser screenshot must use a user-approved
  safer local preview path instead of direct file navigation.

Hard constraints carried forward:

- No fallback or compatibility story; this is a visual restructuring of the
  same single HTML architecture source.
- Do not add a second diagram source or split content into another current
  architecture file.
- Do not remove clickability for existing architectural components; if a visual
  node is grouped, the underlying component details remain reachable through
  group or representative hotspots.
- Do not introduce new runtime concepts, routes, agents, prompt profiles, or
  tool behavior.
- Do not touch unrelated dirty source files.

Sources re-read before this pass:

| Source | Finding |
| --- | --- |
| `specs/records/2026-06/2026-06-30-agent-team-html-architecture-diagram.md` | Existing Recall, prior CEO-facing correction, interactive map correction, and expert-squad wiring record. |
| `specs/current/architecture/17-agent-team-infrastructure.html` | Current SVG uses `viewBox="0 0 1640 1010"` and packs ingress, 14 role chips, expert squad chips, evidence, base tables, and extension axes into one dense map. |
| `specs/current/architecture/README.md` | Confirms this HTML is the current architecture overview diagram. |
| `specs/records/2026-06/README.md` and `specs/README.md` | Confirm the existing dated record remains the correct Recall location. |
| Browser skill documentation | Confirms browser screenshot workflow, while direct `file://` navigation is blocked by policy in this environment. |

Whole-repository grep evidence:

| Command | Finding |
| --- | --- |
| `rg -n 'map-svg|viewBox|Agent Team Operating Map|Expert Squad Wiring|data-detail="agent-|data-detail="squad-|data-detail="wiring-|data-detail="base-|data-detail="axis-' specs/current/architecture/17-agent-team-infrastructure.html` | The crowded area is the first SVG plus the second wiring SVG; all clickable detail IDs are local to the same HTML. |
| `rg -n '17-agent-team-infrastructure|Agent Team Operating Map|Expert Squad Wiring|PromptProfile overlay|executive visual|Second Corrective Recall|Verification' specs/records/2026-06/2026-06-30-agent-team-html-architecture-diagram.md specs/current/architecture/README.md specs/records/2026-06/README.md` | Only the current HTML and this record/index mention the diagram, so the visual pass should stay scoped to the HTML plus this record. |

Independent agent feedback:

- No new sub-agent was spawned because the user did not ask for parallel
  delegation. This pass reuses prior landed review constraints already recorded
  above and adds local grep plus browser-policy evidence.

## Verification

Passed (latest run, interactive map-centric revision):

```powershell
bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts
# 64 pass, 0 fail, 1060 expect() calls
```

`document-health` does not scan `17-agent-team-infrastructure.html`: its
architecture sweeps filter `.endsWith(".md")` and its targeted assertions use
explicit file lists that exclude the HTML diagram, so the retired-name mentions
in the diagram's guardrail/detail copy (shown only as "已删除 / 退役不复活") are
not flagged.
