# 2026-07-02 Single Agent vs OpenCorvus Clear Draw.io

Status: implemented

## Goal

Delete the previous "investment potential" diagram artifact and replace the
provided neon reference image with a clear, editable Draw.io architecture
comparison: traditional single-agent coding assistant versus OpenCorvus
multi-agent orchestration.

## Recall

### User Request

The user asked to delete the previous "投资潜力图". They then provided a
reference image comparing "传统编码助手（单 Agent）" with "opencorvus（多 Agent
编排）" and asked to make the lower image into a clear version, not a direct
pixel-level generated image. The user explicitly required concept validation and
independent agent review.

### Acceptance Criteria

- Delete the previous investment diagram artifact
  `specs/artifacts/opencorvus-agent-team-investment-platform.drawio`.
- Produce a new editable Draw.io artifact, not a raster image upscale or
  pixel-level regeneration of the provided screenshot.
- Preserve the useful conceptual contrast:
  traditional single-agent coding assistant versus OpenCorvus task-level
  Orchestrator plus specialized sub-agents plus executor/evidence layers.
- Correct inaccurate or risky wording from the reference image:
  - no "Delivery gate" / "验收门" gate language;
  - no planner-as-agent or fixed pipeline implication;
  - no claim that Codex / Claude Code are Orchestrator or sub-agent roles;
  - no hidden routing, fallback, or keyword-routing story.
- Show Codex / Claude Code / OpenCorvus as coding executors under Build Agent /
  ExecutorRegistry, not as the whole system.
- Show SQLite / DB (Database) persistence as durable facts: task state,
  artifacts, decision log, coordination requests/responses, and evidence.
- Show Integrity as a review report / evidence producer consumed by
  Orchestrator lifecycle decisions, not as lifecycle authority.
- Visually verify the new Draw.io through a rendered preview screenshot and
  inspect it for clarity, overlap, and sloppiness.
- Record independent-agent concept review in this Recall.

### Hard Constraints

- No fallback/compatibility logic or wording.
- No gate/door mechanism in the architecture narrative.
- Orchestrator is the only task-level scheduler and lifecycle decision owner.
- Sub-agents are agents with their own LLM (Large Language Model) + tools, not
  plain functions.
- Workflows are hints and Orchestrator can reason beyond them; no fixed host
  state machine.
- Existing dirty worktree changes are not part of this task and must not be
  reverted or staged accidentally.

### Sources Read

| Source | Finding carried forward |
| --- | --- |
| `AGENTS.md` | Requires Recall before edits, no fallback, no gate, no careless patches, and visual verification for visual work. |
| `specs/README.md` | Confirms records go under `specs/records/YYYY-MM/**` and task artifacts under `specs/artifacts/**`. |
| `specs/records/2026-07/2026-07-02-agent-team-investment-drawio.md` | Previous investment diagram record and verification; now must be superseded/deleted as a current artifact. |
| `specs/current/architecture/01-agents.md` | Orchestrator is the single task-level decision maker; Build Agent uses `Worktree.create` and `ExecutorRegistry.requireCoding`; old planner and acceptance review agent are deleted. |
| `specs/current/architecture/04-extensions.md` | Executor, Plugin, MCP (Model Context Protocol), and ACP (Agent Client Protocol) are distinct extension axes; `opencorvus`, `codex`, and `claude-code` are executor names. |
| `specs/current/architecture/08-agent-tool-adapter.md` | Tool visibility is owned by canonical AgentToolPool and ToolRegistry, not prompt or permission side channels. |
| `specs/current/architecture/13-agent-communication-matrix.md` | A2A (Agent-to-Agent) coordination uses durable coordination artifacts; Integrity is report evidence, not lifecycle authority. |
| `specs/current/architecture/99-principles.md` | No fixed pipeline, no mechanical retry, no fallback, no gate, no hidden routing. |
| Reference screenshot from `C:/Users/chuan/AppData/Local/Temp/codex-clipboard-66de3a13-a408-4052-b2ff-fe0b28a6cea0.png` | Useful visual intent: single-agent loop versus OpenCorvus orchestration, executor layer, persistence, evidence, worktree isolation. The neon raster style should not be copied. |

### Whole-Repository Grep Evidence

| Command | Finding carried forward |
| --- | --- |
| `rg -n "Delivery\|验收门\|Acceptance\|acceptance review\|Integrity\|integrity\|complete_task\|fail_task\|ExecutorRegistry\|Worktree.create\|SQLite\|decision-log\|agent_coordination" specs/current specs/records/2026-06 specs/records/2026-07 packages/opencorvus/src packages/opencorvus/test -g "*.md" -g "*.ts" -g "*.txt"` | Confirms Integrity is review/report evidence, Orchestrator owns complete/fail lifecycle, Worktree/ExecutorRegistry are the build execution boundary, and SQLite/decision-log/coordination are durable evidence surfaces. |
| `rg -n "agent team\|Agent Team\|expert squad\|专家团\|skill matrix\|配置矩阵\|MCP\|memory\|opencode\|GUI\|workflow\|agent family\|skill" specs packages docs README.md` | Prior task already established the requested platform concepts across current architecture, records, source, tests, and README. |
| `git status --short --branch` | Worktree has many unrelated dirty source/doc changes; this task must stage only the diagram replacement and related records/index lines. |

### Independent Agent Feedback

Independent read-only agent `019f1efb-fca3-7260-b18a-ed0920c3da7f` reviewed
the concept and recommended:

- Keep the left/right contrast, but redraw it as an architecture explanation,
  not a neon "many agents around a brain" poster.
- Traditional coding assistant can be shown as:
  `User -> Coding Assistant -> Tools/Files -> User Review`.
- OpenCorvus should be layered:
  ingress/control, Orchestrator decision layer, Agent Team layer, execution and
  evidence layer, plus platform fabric.
- Keep Build Agent + executor separation: Build is an agent; `opencorvus`,
  `codex`, and `claude-code` are coding executors.
- Change "Delivery 验收门" to evidence-backed Orchestrator lifecycle decision:
  `complete_task` / `fail_task`.
- Avoid "Planner", "Acceptance Agent", "Prosecutor", hard pipeline, mechanical
  retry, and gate wording.
- Draw expert squad / PromptProfile overlay as changing prompt profile only; it
  does not change tools, model, workflow, MCP, or executor.

## Implementation Plan

1. Delete `specs/artifacts/opencorvus-agent-team-investment-platform.drawio`.
2. Update the previous investment diagram record to mark the artifact deleted /
   superseded.
3. Add `specs/artifacts/opencorvus-single-agent-vs-agent-team.drawio`.
4. Update `specs/records/2026-07/README.md` to index this new record and
   adjust the previous investment record line.
5. Render a preview from the Draw.io geometry, inspect it visually, and iterate.
6. Run spec/document health checks and final staged-diff review before commit.

## Non-Goals

- Do not modify OpenCorvus runtime code.
- Do not generate a raster-only replacement image.
- Do not copy the reference screenshot pixel-for-pixel.
- Do not introduce new architecture authority outside the existing
  `specs/current/architecture/**` sources.

## Implementation Log

- Deleted the previous investment-potential Draw.io artifact:
  `specs/artifacts/opencorvus-agent-team-investment-platform.drawio`.
- Added the replacement editable Draw.io artifact:
  `specs/artifacts/opencorvus-single-agent-vs-agent-team.drawio`.
- Marked
  `specs/records/2026-07/2026-07-02-agent-team-investment-drawio.md` as
  deleted / superseded.
- Updated `specs/records/2026-07/README.md` to index this record and retain the
  superseded record as history.

## Verification

- Independent agent review completed before drawing; its concept corrections
  are recorded in the Recall section above.
- Rendered and inspected preview screenshot:
  `.scratch/single-agent-vs-opencorvus-drawio/opencorvus-single-agent-vs-agent-team-v5.png`.
- Final preview geometry check:
  `xml=ok`, `pageWidth=1760`, `pageHeight=1168`, `cells=50`,
  `overflowCount=0`.
