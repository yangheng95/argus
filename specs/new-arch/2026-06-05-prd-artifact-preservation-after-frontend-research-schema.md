# PRD Artifact Preservation After Frontend-Research Schema Refactor

## Problem

The TradingView World Economy run at `D:\myhexin-local\demos\tv_economy` shows a schema-boundary regression after the frontend-research collector refactor. The user explicitly requested a detailed Product Requirements Document (PRD) before implementation, but the durable task output contains only:

- `frontend-design/frontend-template.md`
- `frontend-research/<session>/research-bundle.md`
- requirements `REQ-N` rows and decisions
- build reports for the React target

There is no standalone PRD artifact. Requirements registered `REQ-1` for the PRD, but also recorded `three_round_structure: Round 1: PRD extraction complete (frontend-design done)`, which let Architect and Build treat frontend-design plus frontend-research evidence as sufficient instead of assigning a Build-owned PRD document.

## Grep Evidence

| Surface | Call points | Decision |
| --- | --- | --- |
| `frontend_research_brief` | `src/research/prompt-section.ts`, `src/orchestrator/tools.ts`, `src/build/prompt-context.ts`, `src/prompt/core/frontend-research-core.txt`, research tests | Keep as advisory investigation packet input. Do not make frontend-research the PRD writer. |
| Explicit PRD document requests | `src/prompt/core/requirements-core.txt`, `src/prompt/core/architect-core.txt`, `src/prompt/core/build-core.txt`, prompt hygiene tests | Requirements must preserve a PRD artifact requirement when the user asks for one; Architect must assign that artifact to a Build goal. Build already knows how to write PRDs. |
| `PRD/frontend_design` weighting | `requirements-core.txt`, `architect-core.txt`, `build/agent.ts`, prompt tests | Keep weighting, but clarify it is implementation authority only, not proof that a requested PRD file exists. |
| Demo evidence | `.opencorvus/runtime/tasks/tsk_e92e3bbeb001/frontend-research/.../research-bundle.md`, `decision-log.md`, `sessions/.../trace.jsonl` | Confirms the PRD collapsed to outline/coverage data plus implementation reports. |

## Fix

1. Requirements prompt: when the user asks for a PRD/SPEC/report/document artifact, register a requirement for a real persisted artifact. Do not mark it complete because frontend-design/frontend-research evidence exists.
2. Architect prompt: when a REQ acceptance names a PRD/SPEC/report/document artifact, create or preserve a Build goal that writes that artifact from user request, frontend-design, and research evidence before downstream implementation consumes it.
3. Prompt hygiene tests lock both instructions.

No host gate, route bypass, or state machine is added. This is prompt-over-host repair for a role-boundary regression.
