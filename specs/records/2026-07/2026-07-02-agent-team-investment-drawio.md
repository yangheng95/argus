# 2026-07-02 Agent Team Investment Draw.io

Status: implemented

## Goal

Create a mature Draw.io diagram that explains OpenCorvus as a general Agent
Team infrastructure platform and makes the investment case for more use-case
development.

## Recall

### User Request

The user said OpenCorvus is designed as a general agent team infrastructure for
personal and business complex orchestrated workflows, including coding,
testing, research, and daily document work. It supports mainstream large-model
elements, an extensible agent family, skills, MCP (Model Context Protocol),
tools, memory, and a dynamically generated expert-squad skill/tool
configuration matrix. With agent team's long-horizon, autonomous, parallel
capacity, OpenCorvus can carry most agent-workflow tasks and can be adapted like
OpenCode to concrete tasks such as complex project code generation and
automated GUI (Graphical User Interface) testing. The user asked to understand
this and draw a Draw.io diagram that shows all this potential, to persuade
senior leadership to increase investment and develop new use cases.

The user then added: "请你成熟一些，不要生成ai sloppy".

### Acceptance Criteria

- Add a `.drawio` file that opens directly in diagrams.net / Draw.io.
- The diagram must be executive-facing, not an engineering whiteboard or a pile
  of same-weight boxes.
- The diagram must make the platform thesis visible: one general orchestration
  base, extensible model/agent/skill/MCP/tool/memory surfaces, expert-squad
  configuration matrix, autonomous parallel delivery, and many replicable
  business use cases.
- The diagram must cover at least these use-case families: complex code/project
  generation, automated GUI testing, research/analysis, daily document work,
  business process automation, and vertical expert copilots.
- The visual style must be sober, information-rich, readable, and suitable for
  persuading leadership to fund more scenarios.
- Do not introduce false runtime concepts, hidden routing, fallback,
  keyword-routing, fixed host pipeline, or duplicate architecture sources.
- Keep changes scoped to the Draw.io artifact, this record, and the monthly
  record index.
- Validate that the Draw.io XML is well formed, render a visual preview, inspect
  it, and iterate if the result looks crowded or sloppy.

### Hard Constraints

- No fallback or compatibility story as a design claim.
- Orchestrator remains the single task-level scheduler.
- Expert squads are prompt-profile / skill guidance overlays selected through
  visible orchestration, not host keyword routing and not a second workflow
  engine.
- Skills, MCP, tools, memory, models, providers, workflows, and executors remain
  distinct extension axes.
- Existing dirty worktree changes are not part of this task and must not be
  reverted or staged accidentally.

### Sources Read

| Source | Finding carried forward |
| --- | --- |
| `AGENTS.md` | Requires no fallback, no hidden route, Recall before implementation, scoped edits, and visual verification for visual artifacts. |
| `specs/README.md` | Confirms root `specs/` as the only spec/record/artifact tree and `specs/artifacts/**` as the place for task artifacts. |
| `specs/current/architecture/README.md` | Current architecture is already indexed; existing HTML diagram is the living architecture overview. |
| `specs/current/architecture/17-agent-team-infrastructure.html` | Existing architecture map already covers agent family, skill, MCP, memory, workflow, expert squads, evidence, and extension axes, but previous user feedback warned against box-heavy and crowded executive visuals. |
| `specs/records/2026-06/2026-06-30-agent-team-html-architecture-diagram.md` | Prior corrective recalls explicitly require mature executive visual language, platform thesis, click-through detail, and avoiding dense "boxes" or decorative technical theater. |
| `specs/current/architecture/01-agents.md` | Orchestrator is the only task-level decision maker; sub-agents are independent LLM agents with tools; direct/pipeline workflows are hints, not state machines. |
| `specs/current/architecture/04-extensions.md` | Executor, Plugin, MCP, and ACP (Agent Client Protocol) are separate extension axes. |
| `specs/current/architecture/08-agent-tool-adapter.md` | Agent tool visibility is owned by the canonical AgentToolPool and ToolRegistry flow. |
| `specs/current/architecture/13-agent-communication-matrix.md` | Current A2A (Agent-to-Agent) coordination is durable artifact based and visible, not hidden messages or direct child-session replies. |
| `specs/current/architecture/99-principles.md` | Reinforces no fallback, no fixed pipeline, no mechanical retry, no keyword routing, and evidence-driven orchestration. |
| `specs/records/2026-07/README.md` | Monthly record index to update for this task. |

### Whole-Repository Grep Evidence

| Command | Finding carried forward |
| --- | --- |
| `rg -n "agent team\|Agent Team\|expert squad\|专家团\|skill matrix\|配置矩阵\|MCP\|memory\|opencode\|GUI\|workflow\|agent family\|skill" specs packages docs README.md` | The requested concepts already exist across current architecture, records, source, tests, and README; the diagram should synthesize them rather than inventing another runtime model. |
| `rg -n "drawio\|\\.drawio\|diagrams\\.net\|mxfile\|agent-team.*draw\|investment\|投入\|使用场景\|use case\|platform" specs packages docs README.md -g "*.md" -g "*.drawio" -g "*.html" -g "*.svg"` | No existing Draw.io investment artifact exists; the closest source is the current HTML architecture map and its corrective record. |
| `rg --files specs/artifacts` | Existing artifacts are prompt/reference inputs; adding one Draw.io deliverable here avoids making it a second architecture authority. |

### Independent Agent Feedback

No fresh sub-agent was spawned because the available multi-agent tool explicitly
allows spawning only when the user asks for sub-agents, delegation, or parallel
agent work. This task instead carries forward the already-landed independent
and corrective feedback in
`2026-06-30-agent-team-html-architecture-diagram.md`: avoid box-heavy maps,
avoid decorative orbitals, keep the expert-squad platform thesis prominent, and
move detail into a structured information hierarchy rather than a cluttered
first visual layer.

## Implementation Plan

1. Create `specs/artifacts/opencorvus-agent-team-investment-platform.drawio`
   as the Draw.io artifact.
2. Use one central platform spine and four surrounding narrative bands:
   business demand, capability substrate, expert-squad configuration matrix,
   and use-case expansion flywheel.
3. Keep node count restrained; use grouped layers and concise labels instead of
   dense equal-weight boxes.
4. Update `specs/records/2026-07/README.md` with this record.
5. Validate XML, render a local visual preview, inspect the screenshot, revise
   if needed, then run documentation health checks.

## Non-Goals

- Do not change OpenCorvus runtime code.
- Do not create a new current-architecture source of truth.
- Do not add a new workflow, agent, skill, MCP server, executor, provider, or
  route.
- Do not use brand-copy or vague AI marketing claims without tying them to the
  current architecture surfaces.

## Implementation Log

2026-07-02:

- Added `specs/artifacts/opencorvus-agent-team-investment-platform.drawio`.
- Updated `specs/records/2026-07/README.md` with this record.
- Structured the diagram as an executive investment map:
  - demand-side complex workflows;
  - reusable OpenCorvus Agent Team substrate;
  - concrete use-case expansion list;
  - expert-squad dynamic configuration matrix;
  - investment flywheel.
- Revised the diagram after visual review to remove title overlap, reduce
  brittle English wrapping, keep the core node readable, keep the right-side
  use-case list inside its panel, and make the expert-squad matrix dense but
  legible.

## Verification

- XML parse: `[xml](Get-Content -Raw specs/artifacts/opencorvus-agent-team-investment-platform.drawio)` succeeded.
- Draw.io structure audit: 1 diagram, 96 `mxCell` nodes.
- Local Playwright preview from the Draw.io geometry rendered to
  `.scratch/agent-team-investment-drawio/opencorvus-agent-team-investment-platform-v4.png`.
- Visual review of the preview found no title overlap, no obvious text
  collision, and no panel overflow after the final revision.
- Automated preview text-overflow estimate reported `overflowCount: 0`.
- `bun test packages/opencorvus/test/script/document-health.test.ts` passed:
  46 tests, 0 failures.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  first hit the test's own 30000ms scratch-scan timeout on the existing
  `.scratch` tree; rerunning the same file with `--timeout 120000` passed:
  19 tests, 0 failures. The slow test was
  `scratch snapshots do not retain deleted spec trees`, scanning roughly 25k
  existing scratch files; the new task scratch directory contains only PNG
  previews.
