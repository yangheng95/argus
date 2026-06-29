# 2026-06-03 Frontend Research Agent Split

## Problem

Generic `research` currently owns rendered webpage PRD evidence. That makes a
document-research agent responsible for frontend functional and visual page
analysis, while `frontend_design` separately owns implementation-template
materialization. The result is a confused handoff: webpage clone tasks need both
an editable frontend template and a source-backed functional/visual contract,
but those responsibilities are not represented as two sibling workflow inputs.

## Callpoint Inventory

Full-repo grep before the change covered:

- `AgentRoleID`, `AgentRoleContract`, `Agent.get`, prompt catalog, fixed
  read-only agent configuration.
- Orchestrator dispatch tools: `research`, `frontend_design`, workflow tool
  include list, stage tracking, and persisted artifact writes.
- Workflow declaration/projection: `frontend_design`, `requirements`,
  `architect`, `projectTaskSteps`, and prompt workflow ordering tests.
- Engine artifacts: `EngineArtifactKind`, `persistTaskResearchBrief`,
  `findLatestResearchBriefArtifact`.
- Downstream prompt injection: `renderResearchBriefPromptSection`,
  `researchEvidenceIDsForTask`, `RequirementsAgent`, `ArchitectAgent`.
- Tests for agent tool surfaces, role contracts, orchestrator tool
  descriptions, research persistence, and workflow steps.

## Design

- Add a distinct `frontend-research` agent identity and `frontend_research`
  orchestrator tool.
- Persist its terminal output as `frontend_research_brief`, using the existing
  `ResearchBrief` schema and integrity checks. The artifact kind is the single
  source separating generic research from frontend webpage research.
- Keep `research` as generic read-only evidence gathering for external facts,
  source maps, PRD/SPEC/report source material, and current documentation. It
  no longer owns rendered webpage functional/visual PRD contracts.
- `frontend_research` prepares rendered webpage PRD evidence for supplied URLs,
  performs direct read-only source-backed investigation, submits
  `webpage_contract`, and returns an advisory evidence bundle. It does not build
  source, write final PRD markdown, produce REQ-N rows, decompose goals, call
  build, or choose the next route.
- The pipeline declares `frontend_design` and `frontend_research` as sibling
  task-scope inputs before intent/requirements/architect. They are parallel
  recommendations, not host-enforced gates.
- Requirements and architect receive both prompt sections and may cite evidence
  IDs from both artifacts.

## 2026-06-03 Superseded Revision: Build-Delegated Deep Research

This revision was wrong. It inverted the intended pipeline by making `build`
perform webpage research before requirements and architect. It is superseded by
`2026-06-03-frontend-research-direct-investigation-fix.md`.

Additional full-repo grep covered:

- Runtime entrypoints: `FrontendResearchAgent.run`, `runResearchSession`,
  `createResearchOutputTools`, `prepareWebpagePrdEvidence`.
- Build delegation contracts: `BuildAgent.run`, `BuildTarget`,
  `buildUserPrompt`, `build-core.txt`, orchestrator `build` tool wording.
- Static agent surfaces: `Agent.get("frontend-research")`,
  `filterAgentTools`, role descriptions, context-tool tests.
- Prompt tests covering frontend-research depth, orchestrator routing, direct
  read-only investigation boundaries, and role separation.

Corrected design:

- `frontend-research` receives prepared webpage evidence as primary visual and
  runtime evidence.
- It performs direct read-only retrieval for source text, linked pages, metadata,
  and gaps not covered by prepared evidence.
- Its runtime tool surface is read-only retrieval plus `submit_research_brief`.
- It records unresolved subpage or state gaps as `subpage_research_tasks`,
  `open_questions`, or `fidelity_risks`; those are advisory inputs for
  requirements and architect, not direct worker dispatches.
- Build only runs after architect has produced goals.

## Tests

- Agent registry/tool-surface tests cover `frontend-research` as a fixed
  read-only agent.
- Research persistence tests cover `frontend_research_brief` storage, retrieval,
  prompt rendering, evidence ID exposure, and workflow projection.
- Workflow tests pin `frontend_design` + `frontend_research` as sibling initial
  steps and downstream dependencies.
- Role/tool-description tests pin the separation between generic research,
  frontend research, and frontend design.
- Frontend-research tests prove the static frontend-research surface exposes
  direct read-only retrieval and no build delegate tool.
