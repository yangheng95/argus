# Final System Prompt Audit (2026-06-23)

## Scope

Audit the prompts that actually enter agent system messages:

- Primary/chat agents: agent prompt plus runtime environment/session context.
- Stage agents: core prompt composed through `runAgentSession`, prompt profile,
  prompt append, non-executor boundary, task context, and terminal contract.
- Orchestrator: static `orchestrator-core.txt` plus dynamic `buildSystemParts`
  context.

## Findings To Repair

| Surface | Problem | Repair |
| --- | --- | --- |
| `frontend-design-core.txt` | Still says frontend_design may acquire missing webpage evidence and names retired "acceptance" as a downstream implement/verify role. | Align with frontend_research first for missing Page Skeleton Blueprint and replace retired acceptance wording with visual_qa/integrity. |
| `general.txt` / `explore.txt` | URL visual-clone guidance sends callers directly to `frontend_design`, skipping current `frontend_research` page-skeleton path. | Tell callers to use frontend_research first when a live webpage clone lacks a source-backed Page Skeleton Blueprint, then frontend_design. |
| `intent-analysis-core.txt` | Responsibility boundary says Frontend Design owns webpage evidence. | Split responsibilities: frontend_research owns page investigation/blueprint; frontend_design owns template/materialization from prepared evidence. |
| `build-core.txt` | Upstream overlay list still names "acceptance review" beside integrity review. | Replace with visual QA/integrity review evidence. |
| `orchestrator/agent.ts` dynamic system context | `buildSystemParts` renders "Acceptance Trajectory" and "acceptance-agent feedback" into the final system prompt. | Rename prompt-visible dynamic context to iteration/review terminology while keeping DB function names unchanged. |
| `coding.txt` / `session/prompt/system.txt` | Interactive system prompts open with hyperbolic "best coding agent on the planet" identity text; `coding.txt` then immediately repeats the concrete coding-agent identity. | Use one concise, objective identity statement per final prompt. |

## Acceptance

- No final system prompt text routes live visual clone URLs directly to only
  `frontend_design`.
- No final system prompt text names retired `acceptance` as an implementation,
  verification, or final-review agent.
- Orchestrator dynamic system context no longer emits prompt-visible
  `Acceptance Trajectory` or `acceptance-agent feedback` headings.
- Interactive coding/system prompts do not contain hyperbolic self-description
  or duplicate identity openings.
- Static tests guard these strings.
