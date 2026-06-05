# 2026-06-05 Deep Research Agent Rename

## Problem

The former generic `research` identity still appears as a live orchestrator tool,
agent role, session kind, prompt, and runtime bundle path after the webpage
investigation split introduced `frontend-research`. This makes the deleted
webpage-research responsibility look revived even though `frontend-research`
owns webpage functional/visual investigation.

## Callpoint Inventory

Full-repo grep covered these surfaces before editing:

| Surface | Action |
| --- | --- |
| Agent role registry | Replace the live generic agent identity `research` with `deep-research`. |
| Orchestrator tools | Replace tool id `research` with `deep_research`; keep `frontend_research` separate. |
| Session kinds and runtime contracts | Replace workflow/session kind `research` with `deep-research`. |
| Prompt catalog/core prompt | Rename the generic prompt to deep research and redefine its boundary as multi-source deep evidence gathering. |
| Runtime runner | Rename `ResearchAgent` to `DeepResearchAgent`; keep shared `ResearchBrief` schema because both deep research and frontend research persist research evidence briefs. |
| Runtime task bundle paths | Store deep research bundles under `deep-research/<session>/...` instead of `research/<session>/...`. |
| Tests | Update role, orchestrator description, session, prompt, and persistence tests to assert the new identity and the absence of the old tool. |
| Docs/specs | Update active specs and prompt references where they describe the live generic agent identity. |

## Design

- `deep_research` is the explicit orchestrator tool for durable multi-source
  evidence gathering: external facts, current documentation, API or industry
  research, source maps, PRD/SPEC/report input material, constraints, document
  outlines, and unresolved questions.
- `frontend_research` remains the dedicated webpage/UI investigation publisher.
- Requirements and architect may use lightweight `websearch` for immediate
  clarification, but deep evidence work belongs to `deep_research`; they should
  consume evidence ids instead of recreating the same investigation.
- Build may use implementation-time retrieval such as `webfetch`, but it should
  not replace missing upstream deep research when the deliverable depends on
  durable external evidence.
- Existing `research_brief` and `frontend_research_brief` artifact kinds remain
  the storage schema. The rename is identity/tool/path level, not a data-schema
  fork.

## Verification

- Static scans should show no live orchestrator tool or session kind named
  `research`.
- Targeted tests should cover agent registry, role descriptions, orchestrator
  tool descriptions, session kinds, runtime contract matching, and research
  bundle persistence paths.
