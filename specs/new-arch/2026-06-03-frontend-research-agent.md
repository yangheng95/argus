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
  delegates deep investigation packets to build, asks the coordinator to submit
  `webpage_contract`, and returns an advisory evidence bundle. It does not build
  source, write final PRD markdown, produce REQ-N rows, decompose goals, or
  choose the next route.
- The pipeline declares `frontend_design` and `frontend_research` as sibling
  task-scope inputs before intent/requirements/architect. They are parallel
  recommendations, not host-enforced gates.
- Requirements and architect receive both prompt sections and may cite evidence
  IDs from both artifacts.

## 2026-06-03 Revision: Build-Delegated Deep Research

User correction: `frontend-research` is no longer the deep investigator. It is
the investigation organizer and task hub for webpage research. The durable
artifact remains `frontend_research_brief`, but the source-backed deep
investigation work is delegated to `build` workers.

Additional full-repo grep covered:

- Runtime entrypoints: `FrontendResearchAgent.run`, `runResearchSession`,
  `createResearchOutputTools`, `prepareWebpagePrdEvidence`.
- Build delegation contracts: `BuildAgent.run`, `BuildTarget`,
  `buildUserPrompt`, `build-core.txt`, orchestrator `build` tool wording.
- Static agent surfaces: `Agent.get("frontend-research")`,
  `filterAgentTools`, role descriptions, context-tool tests.
- Prompt tests covering frontend-research depth, orchestrator routing, build
  request boundaries, and role separation.

Revised design:

- `frontend-research` receives prepared webpage evidence only as scoping
  material. It does not perform direct retrieval, repository search, webfetch,
  shell execution, or code reading.
- Its runtime tool surface is:
  - `delegate_deep_research_to_build` for issuing scoped investigation packets
    to `BuildAgent.run`.
  - `submit_research_brief` for the final `frontend_research_brief`.
- Delegated build investigations are no-change build requests. They must return
  their detailed findings through `report_build_result.summary` and
  `files_changed=[]`; project file mutations are a failed investigation unless
  a later explicit implementation build owns them.
- `frontend-research` may call the delegate tool multiple times for independent
  pages, subpages, or focus areas, then synthesizes the final compact brief and
  bundle from the build worker findings plus prepared evidence identifiers.
- `build` request prompts must accept explicit investigation/report
  deliverables. The previous direct-request instruction that rejected pure
  repository investigation is narrowed to ad-hoc exploration without a concrete
  deliverable, so frontend-research delegated investigations are valid build
  work.

## Tests

- Agent registry/tool-surface tests cover `frontend-research` as a fixed
  read-only agent.
- Research persistence tests cover `frontend_research_brief` storage, retrieval,
  prompt rendering, evidence ID exposure, and workflow projection.
- Workflow tests pin `frontend_design` + `frontend_research` as sibling initial
  steps and downstream dependencies.
- Role/tool-description tests pin the separation between generic research,
  frontend research, and frontend design.
- Frontend-research delegation tests cover the build delegate request shape and
  prove the static frontend-research surface no longer exposes direct retrieval
  tools.
- Build prompt tests cover explicit investigation deliverables in request mode.
